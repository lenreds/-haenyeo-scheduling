// node --test src/lib   (npm test)
import test from "node:test";
import assert from "node:assert/strict";
import {
  formatTime, hoursBetween, normalizeTimeEntry, parsePickerTime, parseTimeInput, roundToQuarter, settledTime,
} from "./tipTimes.js";
import { ackEntry, tipSheetProblems, zeroesAllAcked } from "./tipGuard.js";

// The historic record. These are the formats on the live sheet; their meaning
// must never move, or sent sheets reopen with different HRS.
test("parseTimeInput: live formats keep their historic meaning", () => {
  assert.equal(parseTimeInput("4pm"), 16 * 60);
  assert.equal(parseTimeInput("6:15"), 18 * 60 + 15);
  assert.equal(parseTimeInput("9:15pm"), 21 * 60 + 15);
  assert.equal(parseTimeInput("10:30pm"), 22 * 60 + 30);
  assert.equal(parseTimeInput("9pm"), 21 * 60);
  assert.equal(hoursBetween("4pm", "9:15pm"), 5.25);
  assert.equal(hoursBetween("6:15", "10:30pm"), 4.25);
});

test("parseTimeInput: its known guesses are pinned too (frozen, not fixed)", () => {
  assert.equal(parseTimeInput("1"), 13 * 60); // bare 1 = 1pm
  assert.equal(parseTimeInput("12:30"), 12 * 60 + 30); // noon
  assert.equal(parseTimeInput("5:75"), 18 * 60 + 15);
  assert.equal(parseTimeInput("545"), null);
  assert.equal(parseTimeInput(""), null);
  assert.equal(hoursBetween("5pm", "1"), 20); // the midnight-wrap bug the guard catches
  assert.equal(hoursBetween("4pm", ""), 0);
});

// Every value the picker can write — every minute of the day, so every chip
// any ladder can generate in either panel, midnight crossings included —
// reads back through the frozen parser as exactly the minute intended.
test("round trip: parseTimeInput(formatTime(m)) === m for all 1440 minutes", () => {
  for (let m = 0; m < 1440; m++) {
    assert.equal(parseTimeInput(formatTime(m)), m, `${m} -> "${formatTime(m)}"`);
  }
});

test("round trip: quarter-hour chips walking across midnight", () => {
  // 11:30 PM forward to 12:15 AM, as the TIME OUT ladder pages.
  const walk = [23 * 60 + 30, 23 * 60 + 45, 0, 15];
  assert.deepEqual(walk.map(formatTime), ["11:30 PM", "11:45 PM", "12:00 AM", "12:15 AM"]);
  walk.forEach((m) => assert.equal(parseTimeInput(formatTime(m)), m));
  assert.equal(hoursBetween("5:00 PM", "12:15 AM"), 7.25);
});

test("round trip: typed text -> stored text -> paid minute, both fields", () => {
  const typed = ["5:45", "545", "5 45", "5:45pm", "5:45 PM", "17:45", "4:15", "12", "12:30", "1", "1:15",
    "3:59", "4", "11:45", "1230", "100", "0:30", "1am", "12am", "12pm", "10:30pm", "9pm", "6:15", "4pm"];
  for (const field of ["in", "out"]) {
    for (const t of typed) {
      const intended = parsePickerTime(t, field);
      assert.notEqual(intended, null, `${field} "${t}" should parse`);
      assert.equal(parseTimeInput(normalizeTimeEntry(t, field)), intended, `${field} "${t}"`);
    }
  }
});

test("picker parser: TIME IN assumes evening", () => {
  assert.equal(normalizeTimeEntry("4:15", "in"), "4:15 PM");
  assert.equal(normalizeTimeEntry("545", "in"), "5:45 PM");
  assert.equal(normalizeTimeEntry("5 45", "in"), "5:45 PM");
  assert.equal(normalizeTimeEntry("1", "in"), "1:00 PM");
  assert.equal(normalizeTimeEntry("12:30", "in"), "12:30 PM");
  assert.equal(normalizeTimeEntry("4:15am", "in"), "4:15 AM"); // typed am/pm wins
});

test("picker parser: TIME OUT reads 12:00–3:59 as after midnight", () => {
  assert.equal(normalizeTimeEntry("12", "out"), "12:00 AM");
  assert.equal(normalizeTimeEntry("12:30", "out"), "12:30 AM");
  assert.equal(normalizeTimeEntry("1", "out"), "1:00 AM");
  assert.equal(normalizeTimeEntry("3:59", "out"), "3:59 AM");
  assert.equal(normalizeTimeEntry("4", "out"), "4:00 PM");
  assert.equal(normalizeTimeEntry("10:30", "out"), "10:30 PM");
  assert.equal(normalizeTimeEntry("12:30pm", "out"), "12:30 PM");
  assert.equal(hoursBetween("5:00 PM", normalizeTimeEntry("1", "out")), 8);
});

test("picker parser: TIME IN normalising never changes what is paid", () => {
  // For anything both parsers read, TIME IN's stored form pays the same minute
  // the old text did — so normalising on blur moves no money.
  const samples = [];
  for (let h = 0; h <= 23; h++) for (const mm of ["", ":00", ":07", ":15", ":45"]) {
    samples.push(`${h}${mm}`, `${h}${mm}pm`, `${h}${mm} am`);
  }
  for (const t of samples) {
    const old = parseTimeInput(t);
    const now = parsePickerTime(t, "in");
    if (old == null || now == null) continue;
    assert.equal(roundToQuarter(parseTimeInput(normalizeTimeEntry(t, "in"))), roundToQuarter(old), t);
  }
});

test("picker parser: rejects what it would have to guess", () => {
  for (const t of ["5:75", "13pm", "0am", "24", "5.45", "5:5", "noon", "", "  ", "5:45x"]) {
    assert.equal(parsePickerTime(t, "in"), null, t);
    assert.equal(normalizeTimeEntry(t, "out"), null, t);
  }
});

const slot = (id, name, pts, hours, final) => ({ id, name, pts, hours, final });

test("guard: Bernie with no time out is a hard block", () => {
  const { blocks, zeroes } = tipSheetProblems(
    [slot("bar1", "Bernie", 0.85, 0, 0), slot("bar2", "", null, 0, null)],
    { bar1: { in: "4pm", out: "" } }
  );
  assert.deepEqual(blocks.map((b) => b.message), ["Bernie has no time out — tip is $0.00."]);
  assert.equal(zeroes.length, 0);
});

test("guard: missing, unreadable and over-14-hour times block; empty slots and 0-pt host don't", () => {
  const times = {
    s1: { in: "", out: "" }, s2: { in: "545", out: "10pm" }, s3: { in: "5pm", out: "5:75" },
    s4: { in: "5pm", out: "1" }, host: { in: "", out: "" },
  };
  const { blocks } = tipSheetProblems([
    slot("s1", "Ana", 1, 0, 0), slot("s2", "Bo", 1, 0, 0), slot("s3", "Cy", 1, 1.25, 40),
    slot("s4", "Di", 1, hoursBetween("5pm", "1"), 300), slot("host", "Ed", 0, 0, 0), slot("s5", "", null, 0, null),
  ], times);
  assert.deepEqual(blocks.map((b) => b.name), ["Ana", "Bo", "Cy", "Di"]);
  assert.match(blocks[3].message, /20\.00 hours/);
});

test("guard: exactly 14 hours passes, over 14 blocks", () => {
  const ok = tipSheetProblems([slot("a", "A", 1, 14, 100)], { a: { in: "10:00 AM", out: "12:00 AM" } });
  assert.equal(ok.blocks.length, 0);
  const bad = tipSheetProblems([slot("a", "A", 1, 14.25, 100)], { a: { in: "10:00 AM", out: "12:15 AM" } });
  assert.equal(bad.blocks.length, 1);
});

test("guard: $0.00 for another reason needs a recorded tick", () => {
  const { blocks, zeroes } = tipSheetProblems([slot("s1", "Fay", 1, 0, 0), slot("s2", "Gus", 1, 5, 0.004)],
    { s1: { in: "5:00 PM", out: "5:00 PM" }, s2: { in: "5:00 PM", out: "10:00 PM" } });
  assert.equal(blocks.length, 0);
  assert.deepEqual(zeroes.map((z) => z.name), ["Fay", "Gus"]); // 0.4¢ truncates to $0.00
  assert.equal(zeroesAllAcked(zeroes, []), false);
  const acks = zeroes.map((z) => ackEntry(z, { action: "lock", by: "m@x", at: "2026-10-09T00:00:00Z" }));
  assert.equal(zeroesAllAcked(zeroes, acks), true);
  assert.deepEqual(Object.keys(acks[0]).sort(), ["action", "at", "by", "name", "reason", "slot", "tip"]);
});

// ---- The invariant: anything the old parser silently zeroes is either rescued
// by the blur cleanup or named by the guard as unreadable. Never neither.
// Stronger, and what makes it hold on sent sheets too (where the cleanup never
// runs): the guard alone names every one of them, rescue or not.

function guardBlocksFor(text, field) {
  const t = field === "in" ? { in: text, out: "10:00 PM" } : { in: "5:00 PM", out: text };
  const p = slot("s1", "Pat", 1, hoursBetween(t.in, t.out), 0);
  return tipSheetProblems([p], { s1: t }).blocks.length > 0;
}

// Seeded, so a failure names the same input every run.
function corpus() {
  const out = new Set(["", " ", "545", "5 45", "5.45", "5:5", "noon", "midnight", "5:45x", "5;45", "5-45", "5h45",
    "17.30", "5:45p", "5p", "５:45", "5:45 p.m.", "5 pm.", "05:45", "1745", "17 45", "0545", "5:455", "123:45"]);
  const alpha = "0159: .apm";
  const walk = (s) => { out.add(s); if (s.length < 4) for (const c of alpha) walk(s + c); };
  walk("");
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const wide = "0123456789: .apmAPMx-;";
  for (let i = 0; i < 20000; i++) {
    let s = ""; const n = 1 + Math.floor(rnd() * 7);
    for (let j = 0; j < n; j++) s += wide[Math.floor(rnd() * wide.length)];
    out.add(s);
  }
  return [...out];
}

test("invariant: every input the old parser zeroes is rescued or named — never neither", () => {
  let zeroed = 0;
  for (const field of ["in", "out"]) {
    for (const x of corpus()) {
      if (parseTimeInput(x) != null) continue;
      zeroed++;
      const rescued = settledTime(x, field, false);
      const rescuedReads = rescued != null && parseTimeInput(rescued) != null;
      const named = guardBlocksFor(x, field);
      assert.ok(rescuedReads || named, `${field} "${x}" falls through: zeroed, not rescued, not named`);
      // Stronger: the guard names it even if it was never rescued (sent sheet).
      assert.ok(named, `${field} "${x}" is zeroed but the guard calls it readable`);
    }
  }
  assert.ok(zeroed > 10000, `corpus too thin (${zeroed})`);
});

test("invariant: where each input from the report lands", () => {
  const land = (x, f) => {
    if (parseTimeInput(x) != null) return "reads";
    const r = settledTime(x, f, false);
    return r && parseTimeInput(r) != null ? `rescued -> ${r}` : guardBlocksFor(x, f) ? "guard: unreadable" : "GAP";
  };
  assert.equal(land("545", "in"), "rescued -> 5:45 PM");
  assert.equal(land("5 45", "in"), "rescued -> 5:45 PM");
  assert.equal(land("5.45", "in"), "guard: unreadable");
  assert.equal(land("5:5", "in"), "guard: unreadable");
  assert.equal(land("noon", "in"), "guard: unreadable");
  assert.equal(land("", "out"), "guard: unreadable"); // reported as "no time out"
  assert.equal(land("1230", "out"), "rescued -> 12:30 AM");
});

test("invariant: anything the guard passes, the old parser reads (no silent zero behind a pass)", () => {
  for (const field of ["in", "out"]) {
    for (const x of corpus()) {
      if (guardBlocksFor(x, field)) continue;
      assert.notEqual(parseTimeInput(x), null, `${field} "${x}" passes the guard but pays 0 HRS`);
    }
  }
});

test("blur cleanup never touches a sent / locked sheet", () => {
  assert.equal(settledTime("1", "out", true), null);
  assert.equal(settledTime("545", "in", true), null);
  assert.equal(settledTime("1", "out", false), "1:00 AM");
  assert.equal(settledTime("5:00 PM", "in", false), null); // already clean: no rewrite
  assert.equal(settledTime("", "in", false), null);
  assert.equal(settledTime("5.45", "in", false), null); // unreadable: left as typed
});
