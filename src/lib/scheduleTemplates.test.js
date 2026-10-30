import { test } from "node:test";
import assert from "node:assert/strict";
import { planApply, undoConflicts, OFF } from "./scheduleTemplates.js";

// FOH: Ana (s1), Ben (s2); Cal (s3) left. weekday 1 = Monday.
const roster = [
  { staffId: "s1", name: "Ana", groupKey: null, slotIndex: null },
  { staffId: "s2", name: "Ben", groupKey: null, slotIndex: null },
];
const cell = (staff_id, name, weekday, code, group_key = null) => ({ staff_id, name, group_key, weekday, code });
const week = {
  "s1|1": { code: OFF, stored: true },      // Ana Mon: a stored Off
  "s1|2": { code: "SV_5CL", stored: true },  // Ana Tue: already 5pm
  "s1|3": { code: "SV_4FC", stored: true },  // Ana Wed: matches
  "s2|1": { code: OFF, stored: false },      // Ben Mon: nothing stored at all
  "s2|4": { code: "SV_6CL", stored: true },  // Ben Thu: time off day
};
const base = {
  roster,
  current: (e, wd) => week[`${e.staffId}|${wd}`] || { code: OFF, stored: false },
  timeOff: (e, wd) => e.staffId === "s2" && wd === 4,
  optionStatus: (e, code) => (code === "SV_OLD" ? "retired" : code === "SV_GONE" ? "unknown" : "ok"),
};

test("stored Off is Replacing, never Filling; nothing stored is Filling; matches are left alone", () => {
  const r = planApply({ ...base, cells: [
    cell("s1", "Ana", 1, "SV_4FC"), cell("s1", "Ana", 2, "SV_6CL"), cell("s1", "Ana", 3, "SV_4FC"), cell("s2", "Ben", 1, "SV_4FC"),
  ] });
  assert.deepEqual(r.replace.map((w) => `${w.name} ${w.weekday} ${w.before}->${w.after}`), ["Ana 1 OFF->SV_4FC", "Ana 2 SV_5CL->SV_6CL"]);
  assert.deepEqual(r.fill.map((w) => `${w.name} ${w.weekday} ${w.after}`), ["Ben 1 SV_4FC"]);
  assert.equal(r.unchanged, 1);
  assert.deepEqual(r.skip, []);
});

test("approved time off is never written — not even Off over a shift", () => {
  const r = planApply({ ...base, cells: [cell("s2", "Ben", 4, "SV_4FC")] });
  assert.deepEqual(r.skip, [{ name: "Ben", weekday: 4, reason: "approved time off" }]);
  const r2 = planApply({ ...base, cells: [cell("s2", "Ben", 4, OFF)] });
  assert.equal(r2.replace.length + r2.fill.length, 0);
  assert.equal(r2.skip[0].reason, "approved time off");
});

test("someone no longer on the roster: one line, named from the saved schedule", () => {
  const r = planApply({ ...base, cells: [cell("s3", "Cal", 1, "SV_4FC"), cell("s3", "Cal", 2, "SV_4FC"), cell("s3", "Cal", 3, OFF)] });
  assert.deepEqual(r.skip, [{ name: "Cal", weekday: null, reason: "not on the Front of House roster now" }]);
  // Saved as Off all week: nothing to say.
  assert.deepEqual(planApply({ ...base, cells: [cell("s3", "Cal", 1, OFF)] }).skip, []);
});

test("retired and deleted shifts are skipped and named", () => {
  const r = planApply({ ...base, cells: [cell("s1", "Ana", 5, "SV_OLD"), cell("s1", "Ana", 6, "SV_GONE")] });
  assert.deepEqual(r.skip.map((s) => `${s.name} ${s.weekday} ${s.reason}`), ["Ana 5 that shift is retired", "Ana 6 that shift no longer exists"]);
});

test("moved section / other grid: matched by person AND grid; cross-section days skipped", () => {
  const groups = [
    { staffId: "k1", name: "Freddy", groupKey: "kitchen", slotIndex: 2 },
    { staffId: "j1", name: "Jon", groupKey: "kitchen", slotIndex: 5 },
  ];
  const r = planApply({
    roster: groups,
    current: () => ({ code: OFF, stored: true }),
    timeOff: () => false,
    optionStatus: () => "ok",
    crossBlock: (e, wd) => (e.name === "Jon" && wd === 1 ? "Management" : null),
    groupLabel: (g) => ({ boh: "BOH", kitchen: "Kitchen" }[g]),
    cells: [
      cell("k1", "Freddy", 1, "BOH_DISHES", "boh"),      // Freddy now only on Kitchen -> not on BOH
      cell("k1", "Freddy", 2, "KITCHEN_HOT", "kitchen"),
      cell("j1", "Jon", 1, "KITCHEN_HOT", "kitchen"),    // Jon is FM in Management that day
    ],
  });
  assert.deepEqual(r.skip.map((s) => `${s.name} ${s.weekday} ${s.reason}`), ["Freddy null not on the BOH roster now", "Jon 1 already working in Management that day"]);
  assert.deepEqual(r.replace.map((w) => `${w.name} ${w.entry.slotIndex} ${w.after}`), ["Freddy 2 KITCHEN_HOT"]);
});

test("undo refuses cells edited since the apply", () => {
  const changes = [{ staff_id: "s1", weekday: 1, before: OFF, after: "SV_4FC" }, { staff_id: "s1", weekday: 2, before: "SV_5CL", after: "SV_6CL" }];
  const now = { 1: "SV_4FC", 2: OFF };
  assert.deepEqual(undoConflicts(changes, (c) => now[c.weekday]).map((c) => c.weekday), [2]);
  assert.deepEqual(undoConflicts(changes, (c) => c.after), []);
});
