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

// ---- Bank count wheel ----
import { wheelRows, wheelIndexFor, wheelCaption, wheelMoney, WHEEL_MAX_COUNT } from "./tipPickers.js";

const DENOM_LIST = [100, 50, 20, 10, 5, 1, 0.25, 0.1, 0.05];

test("wheel: 0 to 100 of the denomination, stored exactly as the chips stored it", () => {
  for (const d of DENOM_LIST) {
    const rows = wheelRows(d, "");
    assert.equal(rows.length, WHEEL_MAX_COUNT + 1, `${d}`);
    rows.forEach((r, k) => {
      assert.equal(r.cents, k * Math.round(d * 100));
      assert.equal(r.value, centsToStored(r.cents));
      assert.equal(Math.round(parseFloat(r.value) * 100), r.cents, `${d} x ${k} reads back to the cent`);
    });
  }
  // A wheel save is the same text the old chips saved.
  assert.equal(wheelRows(20, "")[8].value, cashChips(20, 1)[2].value);
  assert.equal(wheelRows(0.25, "")[3].value, cashChips(0.25, 0)[2].value);
});

test("wheel: labels as the brief writes them", () => {
  assert.deepEqual(wheelRows(20, "").slice(0, 4).map((r) => r.label), ["$0", "$20", "$40", "$60"]);
  assert.deepEqual(wheelRows(0.25, "").slice(0, 3).map((r) => r.label), ["$0.00", "$0.25", "$0.50"]);
  assert.equal(wheelRows(100, "")[100].label, "$10,000");
  assert.equal(wheelRows(0.05, "")[100].label, "$5.00");
  assert.equal(wheelMoney(2050, 2000), "$20.50");
});

test("wheel: a stored amount that is not a whole multiple shows as entered, in order, unchanged", () => {
  const rows = wheelRows(20, "21");
  const i = wheelIndexFor(rows, "21");
  assert.equal(rows.length, WHEEL_MAX_COUNT + 2);
  assert.equal(rows[i].asIs, true);
  assert.equal(rows[i].value, "21"); // the stored text itself, not centsToStored
  assert.equal(rows[i].label, "$21");
  assert.equal(rows[i - 1].cents, 2000);
  assert.equal(rows[i + 1].cents, 4000);
  assert.match(wheelCaption(20, rows[i], "$20"), /\$21 isn.t a whole number of \$20 bills/);
  // Coins: 1.10 in quarters sits between 1.00 and 1.25.
  const q = wheelRows(0.25, "1.10");
  const qi = wheelIndexFor(q, "1.10");
  assert.deepEqual([q[qi - 1].cents, q[qi].cents, q[qi + 1].cents], [100, 110, 125]);
  assert.equal(q[qi].value, "1.10");
});

test("wheel: more than 100 goes at the end, text that is not an amount at the start", () => {
  const over = wheelRows(20, "2500");
  assert.equal(over[over.length - 1].asIs, true);
  assert.equal(wheelIndexFor(over, "2500"), over.length - 1);
  assert.equal(wheelCaption(20, over[over.length - 1], "$20"), "125 × $20 bills");
  const bad = wheelRows(5, "abc");
  assert.equal(bad[0].asIs, true);
  assert.equal(wheelIndexFor(bad, "abc"), 0);
  assert.match(wheelCaption(5, bad[0], "$5"), /not an amount/);
});

test("wheel: opens on the stored row; a clean multiple adds no extra row", () => {
  for (const [d, text, k] of [[20, "40", 2], [20, "40.00", 2], [0.25, "0.50", 2], [0.1, "0.30", 3], [100, "", 0], [1, "100", 100], [0.05, "0", 0]]) {
    const rows = wheelRows(d, text);
    assert.equal(rows.length, WHEEL_MAX_COUNT + 1, `${d} ${text}`);
    assert.equal(wheelIndexFor(rows, text), k, `${d} ${text}`);
  }
});

test("wheel: count line", () => {
  const r = wheelRows(20, "");
  assert.equal(wheelCaption(20, r[2], "$20"), "2 × $20 bills");
  assert.equal(wheelCaption(20, r[1], "$20"), "1 × $20 bill");
  assert.equal(wheelCaption(1, wheelRows(1, "")[0], "$1"), "0 × $1 bills");
  assert.equal(wheelCaption(0.25, wheelRows(0.25, "")[3], "25¢"), "3 × 25¢ coins");
  assert.equal(wheelCaption(0.05, wheelRows(0.05, "")[1], "5¢"), "1 × 5¢ coin");
});

// ---- Clock wheel (Clock In / Clock Out) ----
import { clockRows, clockStoredIndex, clockOpenIndex, clockCaption, CLOCK_FIRST, CLOCK_LAST } from "./tipPickers.js";
import { normalizeTimeEntry } from "./tipTimes.js";

test("clock wheel: 3:00 PM to 2:00 AM in 15-minute steps", () => {
  const rows = clockRows("");
  assert.equal(rows.length, (CLOCK_LAST - CLOCK_FIRST) / 15 + 1);
  assert.equal(rows.length, 45);
  assert.deepEqual(rows.slice(0, 3).map((r) => r.label), ["3:00 PM", "3:15 PM", "3:30 PM"]);
  assert.deepEqual(rows.slice(34, 38).map((r) => r.label), ["11:30 PM", "11:45 PM", "12:00 AM", "12:15 AM"]);
  assert.equal(rows[rows.length - 1].label, "2:00 AM");
  rows.forEach((r) => assert.equal(r.asIs, false));
});

test("clock wheel: every row stores the text the typed field stores, and pays the minute shown", () => {
  for (const r of clockRows("")) {
    assert.equal(parseTimeInput(r.value), r.mins, r.label);
    // Typed as the bare clock ("10:45", "12:30", "1:15") it stores the same
    // text: in TIME OUT from 4:00 PM on (typed there, 3:00–3:59 means after
    // midnight, so a 3 PM finish needs the wheel or "pm"), and in TIME IN for
    // every PM row.
    const bare = r.label.replace(/ (AM|PM)$/, "");
    if (r.mins >= 16 * 60 || r.mins < 15 * 60) assert.equal(normalizeTimeEntry(bare, "out"), r.value, `out "${bare}"`);
    else assert.equal(normalizeTimeEntry(bare, "out"), formatTime(r.mins - 12 * 60), `out "${bare}" is after midnight`);
    if (r.mins >= 12 * 60) assert.equal(normalizeTimeEntry(bare, "in"), r.value, `in "${bare}"`);
    // Typed with its am/pm, either field stores the same text.
    for (const field of ["in", "out"]) assert.equal(normalizeTimeEntry(r.label, field), r.value, `${field} "${r.label}"`);
  }
});

test("clock wheel: after midnight counts across midnight exactly as typed times do", () => {
  const rows = clockRows("");
  const at = (label) => rows.find((r) => r.label === label).value;
  for (const [inT, outLabel, typedOut, hrs] of [
    ["5:00 PM", "12:00 AM", "12", 7],
    ["5:00 PM", "12:30 AM", "1230", 7.5],
    ["4:30 PM", "1:15 AM", "1:15", 8.75],
    ["6:00 PM", "2:00 AM", "2", 8],
    ["11:45 PM", "12:15 AM", "12:15", 0.5],
  ]) {
    const wheel = at(outLabel);
    const typed = normalizeTimeEntry(typedOut, "out");
    assert.equal(wheel, typed, `${outLabel} vs typed "${typedOut}"`);
    assert.equal(hoursBetween(inT, wheel), hrs, `${inT} -> ${outLabel}`);
    assert.equal(hoursBetween(inT, wheel), hoursBetween(inT, typed));
  }
});

test("clock wheel: a stored time off the list shows as it is, in order, unchanged", () => {
  // Off the 15-minute steps: between its neighbours.
  let rows = clockRows("5:07 PM");
  let i = clockStoredIndex(rows, "5:07 PM");
  assert.equal(rows.length, 46);
  assert.equal(rows[i].asIs, true);
  assert.equal(rows[i].value, "5:07 PM");
  assert.deepEqual([rows[i - 1].label, rows[i + 1].label], ["5:00 PM", "5:15 PM"]);
  assert.equal(clockCaption({ field: "in", row: rows[i], scheduled: 17 * 60 }), "Paid as 5:00 PM · On schedule");
  // Before 3:00 PM: first. After 2:00 AM: last. Not a time at all: first.
  rows = clockRows("2:45 PM");
  assert.equal(clockStoredIndex(rows, "2:45 PM"), 0);
  assert.equal(rows[0].value, "2:45 PM");
  rows = clockRows("2:30 AM");
  assert.equal(clockStoredIndex(rows, "2:30 AM"), rows.length - 1);
  rows = clockRows("12:50 AM");
  i = clockStoredIndex(rows, "12:50 AM");
  assert.deepEqual([rows[i - 1].label, rows[i + 1].label], ["12:45 AM", "1:00 AM"]);
  rows = clockRows("abc");
  assert.equal(clockStoredIndex(rows, "abc"), 0);
  assert.match(clockCaption({ field: "out", row: rows[0] }), /isn't a time/);
  // The stored text is kept exactly, spaces and all.
  rows = clockRows(" 5:07pm ");
  assert.equal(rows[clockStoredIndex(rows, " 5:07pm ")].value, " 5:07pm ");
});

test("clock wheel: a stored time on the list adds no row and opens on it", () => {
  for (const [text, label] of [["5:00 PM", "5:00 PM"], ["5pm", "5:00 PM"], ["6:15", "6:15 PM"], ["12:30 AM", "12:30 AM"], ["2:00 AM", "2:00 AM"], ["3:00 PM", "3:00 PM"]]) {
    const rows = clockRows(text);
    assert.equal(rows.length, 45, text);
    const i = clockStoredIndex(rows, text);
    assert.equal(rows[i].label, label, text);
    assert.equal(clockOpenIndex(rows, text, { field: "in", scheduled: 18 * 60 }), i, text);
  }
  assert.equal(clockStoredIndex(clockRows(""), ""), -1);
});

test("clock wheel: empty TIME IN opens on the scheduled start, empty TIME OUT on now to the nearest 15", () => {
  const rows = clockRows("");
  const open = (o) => rows[clockOpenIndex(rows, "", o)].label;
  assert.equal(open({ field: "in", scheduled: scheduledStartMins("SV_5SC") }), "5:00 PM");
  assert.equal(open({ field: "in", scheduled: scheduledStartMins("HOST_4") }), "4:00 PM");
  assert.equal(open({ field: "in", scheduled: null }), "3:00 PM");
  assert.equal(open({ field: "in", scheduled: scheduledStartMins("SV_12") }), "3:00 PM"); // noon: not on the list
  assert.equal(open({ field: "out", nowMins: 22 * 60 + 7 }), "10:00 PM");
  assert.equal(open({ field: "out", nowMins: 22 * 60 + 8 }), "10:15 PM");
  assert.equal(open({ field: "out", nowMins: 23 * 60 + 53 }), "12:00 AM");
  assert.equal(open({ field: "out", nowMins: 60 + 40 }), "1:45 AM");
  assert.equal(open({ field: "out", nowMins: 2 * 60 + 10 }), "3:00 PM"); // 2:15 AM: past the list
  assert.equal(open({ field: "out", nowMins: 11 * 60 }), "3:00 PM"); // morning: before the list
  // A stored time always wins.
  const r2 = clockRows("9:30 PM");
  assert.equal(r2[clockOpenIndex(r2, "9:30 PM", { field: "out", nowMins: 22 * 60 })].label, "9:30 PM");
});

test("clock wheel: line under the wheel", () => {
  const rows = clockRows("");
  const row = (label) => rows.find((r) => r.label === label);
  assert.equal(clockCaption({ field: "in", row: row("5:00 PM"), scheduled: 17 * 60 }), "On schedule");
  assert.equal(clockCaption({ field: "in", row: row("5:15 PM"), scheduled: 17 * 60 }), "+15 min vs schedule");
  assert.equal(clockCaption({ field: "in", row: row("5:15 PM"), scheduled: null }), "");
  assert.equal(clockCaption({ field: "out", row: row("12:30 AM"), inText: "5:00 PM" }), "7.50 hrs");
  assert.equal(clockCaption({ field: "out", row: row("10:00 PM"), inText: "4pm" }), "6.00 hrs");
  assert.equal(clockCaption({ field: "out", row: row("10:00 PM"), inText: "" }), "");
});
