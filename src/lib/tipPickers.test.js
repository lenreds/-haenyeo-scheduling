// npm test
import test from "node:test";
import assert from "node:assert/strict";
import { parseTimeInput, parsePickerTime, formatTime, hoursBetween } from "./tipTimes.js";
import {
  cashCheck, cashChips, cashPageFor, centsToStored, parseCents, scheduleDelta,
  scheduledStartMins, signedDiff, timeChips, timeLadderCenter,
} from "./tipPickers.js";

const labels = (chips) => chips.map((c) => c.label);

test("time: SV_5SC centres on 5:00 PM — 4:30 4:45 5:00 5:15 5:30", () => {
  const sched = scheduledStartMins("SV_5SC");
  assert.equal(sched, 17 * 60);
  const c = timeLadderCenter({ field: "in", current: null, scheduled: sched });
  assert.deepEqual(labels(timeChips(c)), ["4:30 PM", "4:45 PM", "5:00 PM", "5:15 PM", "5:30 PM"]);
  assert.equal(scheduledStartMins("HOST_4"), 16 * 60);
  assert.equal(scheduledStartMins("BAR_6CL"), 18 * 60);
  assert.equal(scheduledStartMins("7pm"), null);
  assert.equal(scheduledStartMins(""), null);
});

test("time: ‹ › slide the window 15 minutes", () => {
  assert.deepEqual(labels(timeChips(17 * 60, 4)), ["5:30 PM", "5:45 PM", "6:00 PM", "6:15 PM", "6:30 PM"]);
  assert.deepEqual(labels(timeChips(17 * 60, -1)), ["4:15 PM", "4:30 PM", "4:45 PM", "5:00 PM", "5:15 PM"]);
});

test("time: TIME OUT ladder crosses midnight forward from 11:30", () => {
  const c = timeLadderCenter({ field: "out", current: parseTimeInput("11:30 PM"), scheduled: null });
  assert.deepEqual(labels(timeChips(c, 2)), ["11:30 PM", "11:45 PM", "12:00 AM", "12:15 AM", "12:30 AM"]);
  assert.equal(hoursBetween("5:00 PM", timeChips(c, 2)[3].value), 7.25);
});

test("time: TIME OUT centres on the value, else the 9:00 PM placeholder", () => {
  assert.equal(timeLadderCenter({ field: "out", current: null, scheduled: null }), 21 * 60);
  assert.equal(timeLadderCenter({ field: "out", current: parseTimeInput("10:30pm"), scheduled: null }), 22 * 60 + 30);
  assert.equal(timeLadderCenter({ field: "in", current: null, scheduled: null }), 16 * 60);
});

test("time: TIME IN keeps the scheduled chip in view unless the value is >30 min off", () => {
  const s = 17 * 60;
  assert.equal(timeLadderCenter({ field: "in", current: s + 30, scheduled: s }), s);
  assert.equal(timeLadderCenter({ field: "in", current: s + 60, scheduled: s }), s + 60);
});

// Every chip either panel can show, at every window position across two days
// of paging, is written as text the frozen parser pays as exactly that minute.
test("round trip: every chip in both panels pays the minute it shows", () => {
  const centers = new Set([16 * 60, 21 * 60]);
  for (let h = 1; h <= 12; h++) centers.add(scheduledStartMins(`SV_${h}`));
  for (const center of centers) {
    for (let off = -96; off <= 96; off++) {
      for (const chip of timeChips(center, off)) {
        assert.equal(parseTimeInput(chip.value), chip.mins, `"${chip.value}"`);
        assert.equal(chip.label, chip.value);
      }
    }
  }
});

test("time: the type field — 5:45, 545, 5 45 all mean 5:45 PM; 4:15 never 4am", () => {
  for (const t of ["5:45", "545", "5 45"]) assert.equal(formatTime(parsePickerTime(t, "in")), "5:45 PM");
  assert.equal(formatTime(parsePickerTime("4:15", "in")), "4:15 PM");
  assert.equal(formatTime(parsePickerTime("1215", "out")), "12:15 AM");
});

test("time: delta vs schedule, on the paid (quarter-rounded) value", () => {
  const s = 17 * 60;
  assert.equal(scheduleDelta("5:15 PM", s), "+15 min vs schedule");
  assert.equal(scheduleDelta("4:45 PM", s), "−15 min vs schedule");
  assert.equal(scheduleDelta("6:15 PM", s), "+1 hr 15 min vs schedule");
  assert.equal(scheduleDelta("5:00 PM", s), "on schedule");
  assert.equal(scheduleDelta("5:07 PM", s), "on schedule"); // pays as 5:00
  assert.equal(scheduleDelta("", s), null);
  assert.equal(scheduleDelta("5:00 PM", null), null);
  assert.equal(signedDiff(15, 23 * 60 + 45), 30);
});

test("cash: chip pages match the brief for every row", () => {
  const rows = [
    [100, ["100", "200", "300", "400", "500"], ["600", "700", "800", "900", "1000"]],
    [50, ["50", "100", "150", "200", "250"], ["300", "350", "400", "450", "500"]],
    [20, ["20", "40", "60", "80", "100"], ["120", "140", "160", "180", "200"]],
    [10, ["10", "20", "30", "40", "50"], ["60", "70", "80", "90", "100"]],
    [5, ["5", "10", "15", "20", "25"], ["30", "35", "40", "45", "50"]],
    [1, ["1", "2", "3", "4", "5"], ["6", "7", "8", "9", "10"]],
    [0.25, [".25", ".50", ".75", "1.00", "1.25"], ["1.50", "1.75", "2.00", "2.25", "2.50"]],
    [0.1, [".10", ".20", ".30", ".40", ".50"], [".60", ".70", ".80", ".90", "1.00"]],
    [0.05, [".05", ".10", ".15", ".20", ".25"], [".30", ".35", ".40", ".45", ".50"]],
  ];
  for (const [d, p0, p1] of rows) {
    assert.deepEqual(labels(cashChips(d, 0)), p0, `$${d} page 0`);
    assert.deepEqual(labels(cashChips(d, 1)), p1, `$${d} page 1`);
  }
  // Saturday's $160 in twenties: one › and one chip.
  assert.equal(cashChips(20, 1)[2].value, "160");
});

test("cash: every chip on the first 40 pages is stored as text that parseFloat reads to the cent", () => {
  for (const d of [100, 50, 20, 10, 5, 1, 0.25, 0.1, 0.05]) {
    for (let p = 0; p < 40; p++) {
      for (const chip of cashChips(d, p)) {
        assert.equal(Math.round(parseFloat(chip.value) * 100), chip.cents, chip.value);
        assert.equal(parseCents(chip.value), chip.cents, chip.value);
        assert.equal(chip.cents % Math.round(d * 100), 0);
      }
    }
  }
});

test("cash: parseCents is exact and strict", () => {
  assert.equal(parseCents("420"), 42000);
  assert.equal(parseCents(".75"), 75);
  assert.equal(parseCents("0.1"), 10);
  assert.equal(parseCents("1.5"), 150);
  assert.equal(parseCents("$20"), 2000);
  assert.equal(parseCents("4.355"), null);
  assert.equal(parseCents("abc"), null);
  assert.equal(parseCents("."), null);
  assert.equal(parseCents(""), null);
  assert.equal(centsToStored(16000), "160");
  assert.equal(centsToStored(75), "0.75");
});

test("cash: a figure that isn't a multiple is named, never blocked or corrected", () => {
  assert.equal(cashCheck(20, "420", "$20"), null);
  assert.match(cashCheck(20, "425", "$20").message, /\$425\.00 isn't a multiple of \$20 — nearest are \$420\.00 and \$440\.00/);
  assert.match(cashCheck(0.25, "1.10", "25¢").message, /\$1\.10 isn't a multiple of 25¢/);
  assert.equal(cashCheck(0.05, "0.35", "5¢"), null);
  assert.equal(cashCheck(0.1, "0.30", "10¢"), null); // 0.1 + 0.2 float noise can't bite: cents from text
  assert.equal(cashCheck(1, "", "$1"), null);
  assert.equal(cashCheck(1, "x", "$1").kind, "invalid");
});

test("cash: the panel opens on the page holding the stored chip", () => {
  assert.equal(cashPageFor(20, "160"), 1);
  assert.equal(cashPageFor(20, "100"), 0);
  assert.equal(cashPageFor(20, "425"), 0);
  assert.equal(cashPageFor(0.25, "2.50"), 1);
  assert.equal(cashPageFor(100, ""), 0);
});

import { pickerMayOpen } from "./tipPickers.js";
import { isFrozen } from "./tipRules.js";

// The flags as the app writes them (confirmSendTipSheet / toggleTipLock).
const SEND = { sent: true, finalized: true, locked: true };
const unlock = (f) => ({ ...f, locked: false, finalized: false }); // sent stays on

test("panels: closed while locked or finalized, open on an unlocked sheet", () => {
  assert.equal(pickerMayOpen({ locked: false, finalized: false }), true);
  assert.equal(pickerMayOpen({ locked: true, finalized: false }), false);
  assert.equal(pickerMayOpen({ locked: false, finalized: true }), false);
  assert.equal(pickerMayOpen({ locked: false, finalized: false, hasPerson: false }), false);
});

test("panels: a sent sheet, unlocked, opens a time panel and takes a new value", () => {
  assert.equal(pickerMayOpen(SEND), false); // as emailed: no way in
  const reopened = unlock(SEND);
  assert.equal(reopened.sent, true);
  assert.equal(isFrozen(reopened), true); // still "frozen" for the pay rules...
  assert.equal(pickerMayOpen(reopened), true); // ...but the lock is what guards input
  // The value the panel writes for Bernie's missing TIME OUT is paid as typed.
  const out = formatTime(parsePickerTime("1030", "out"));
  assert.equal(out, "10:30 PM");
  assert.equal(hoursBetween("4pm", out), 6.5);
  // Re-locking closes the panels again.
  assert.equal(pickerMayOpen({ ...reopened, locked: true }), false);
});
