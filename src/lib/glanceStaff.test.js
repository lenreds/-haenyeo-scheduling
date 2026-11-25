// npm test
import test from "node:test";
import assert from "node:assert/strict";
import {
  GLANCE_ADD_ROLES, dayOfEntries, dayTypeFor, needsAck, planGlanceChange, replacementShift,
  shiftChoices, staffChoices, staffWarnings, tipSheetGuard, withEntries,
} from "./glanceStaff.js";
import { roleFromCode } from "./shiftCodes.js";

const OPTIONS = {
  Servers: [
    { code: "SV_4FC", label: "4pm-FC" },
    { code: "SV_6CL", label: "6pm-CL" },
    { code: "SV_RO", label: "RO", isOff: true },
    { code: "SV_OLD", label: "Old", retired: true },
  ],
  "Busser/Runner": [{ code: "BR_5CL", label: "5pm-CL" }, { code: "BR_6CL", label: "6pm-CL" }],
  Expo: [{ code: "EXPO_5", label: "Expo 5pm" }],
  Host: [{ code: "HOST_4", label: "Host 4pm" }],
  Bar: [{ code: "BAR_6CL", label: "6pm-CL" }],
  Training: [{ code: "TRAIN_5", label: "Training 5pm" }],
};
const DANIEL = { name: "Daniel", role: "Servers", code: "SV_6CL" };

// ---- Replace keeps the replaced person's role and shift --------------------

test("replace: Akira takes over Daniel's exact Server 6pm-CL, never his own first role", () => {
  const plan = planGlanceChange({ mode: "replace", entry: DANIEL, name: "Akira", roleOptions: OPTIONS });
  assert.deepEqual(plan, { ok: true, name: "Akira", role: "Servers", code: "SV_6CL" });
  assert.equal(roleFromCode(plan.code), "Servers");
});

test("replace: a role or shift left over in the form can't change what is taken over", () => {
  const plan = planGlanceChange({ mode: "replace", entry: DANIEL, name: "Akira", role: "Busser/Runner", shift: "BR_6CL", roleOptions: OPTIONS });
  assert.equal(plan.code, "SV_6CL");
  assert.equal(plan.role, "Servers");
});

test("replace: an old-style code is made whole with the REPLACED person's role", () => {
  assert.deepEqual(replacementShift({ name: "Daniel", role: "Servers", code: "CLOSER" }), { code: "SV_6CL", role: "Servers" });
  assert.deepEqual(replacementShift({ name: "Ana", role: "Bar", code: "CLOSER" }), { code: "BAR_6CL", role: "Bar" });
  const plan = planGlanceChange({ mode: "replace", entry: { name: "Daniel", role: "Servers", code: "CLOSER" }, name: "Akira", roleOptions: OPTIONS });
  assert.equal(plan.code, "SV_6CL"); // not BR_6CL, whatever Akira's own roles are
});

test("replace: each floor role keeps its own code", () => {
  for (const [role, code] of [["Busser/Runner", "BR_5CL"], ["Expo", "EXPO_5"], ["Host", "HOST_4"], ["Bar", "BAR_6CL"]]) {
    const plan = planGlanceChange({ mode: "replace", entry: { name: "X", role, code }, name: "Y", roleOptions: OPTIONS });
    assert.deepEqual([plan.role, plan.code], [role, code]);
  }
});

test("replace: a coverage gap has no shift to take over, so role and shift are picked (nothing pre-filled)", () => {
  const gap = { name: "Open server", role: "Servers", code: "GAP" };
  assert.equal(replacementShift(gap), null);
  assert.deepEqual(planGlanceChange({ mode: "replace", entry: gap, name: "Akira", roleOptions: OPTIONS }), { ok: false, error: "Pick the role." });
  assert.deepEqual(planGlanceChange({ mode: "replace", entry: gap, name: "Akira", role: "Servers", roleOptions: OPTIONS }), { ok: false, error: "Pick the shift." });
  assert.deepEqual(
    planGlanceChange({ mode: "replace", entry: gap, name: "Akira", role: "Servers", shift: "SV_6CL", roleOptions: OPTIONS }),
    { ok: true, name: "Akira", role: "Servers", code: "SV_6CL" }
  );
});

test("replace: a shift with no floor role (a manager on FM) isn't taken over either", () => {
  assert.equal(replacementShift({ name: "Mgr", role: "Management", code: "FM" }), null);
});

test("replace: picking the person being replaced is refused", () => {
  assert.equal(planGlanceChange({ mode: "replace", entry: DANIEL, name: "Daniel", roleOptions: OPTIONS }).ok, false);
});

// ---- Add to tonight: person, role and shift, all picked ---------------------

test("add: needs the person, then the role (no default), then the shift", () => {
  assert.deepEqual(planGlanceChange({ mode: "add", name: "", roleOptions: OPTIONS }), { ok: false, error: "Pick the person." });
  assert.deepEqual(planGlanceChange({ mode: "add", name: "Akira", roleOptions: OPTIONS }), { ok: false, error: "Pick the role." });
  assert.deepEqual(planGlanceChange({ mode: "add", name: "Akira", role: "Servers", roleOptions: OPTIONS }), { ok: false, error: "Pick the shift." });
  assert.deepEqual(
    planGlanceChange({ mode: "add", name: "Akira", role: "Servers", shift: "SV_6CL", roleOptions: OPTIONS }),
    { ok: true, name: "Akira", role: "Servers", code: "SV_6CL" }
  );
});

test("add: the shift must be one of that role's current shifts", () => {
  const add = (role, shift) => planGlanceChange({ mode: "add", name: "Akira", role, shift, roleOptions: OPTIONS }).ok;
  assert.equal(add("Servers", "BR_6CL"), false); // another role's shift
  assert.equal(add("Servers", "SV_RO"), false); // counts as off
  assert.equal(add("Servers", "SV_OLD"), false); // retired
  assert.equal(add("Servers", "SV_NOPE"), false); // not an option at all
  assert.equal(add("Busser/Runner", "BR_6CL"), true);
});

test("add: Training is not offered", () => {
  assert.ok(!GLANCE_ADD_ROLES.includes("Training"));
  assert.equal(planGlanceChange({ mode: "add", name: "Akira", role: "Training", shift: "TRAIN_5", roleOptions: OPTIONS }).ok, false);
});

test("shift choices: current, not off, not retired, the role's own codes only", () => {
  assert.deepEqual(shiftChoices(OPTIONS, "Servers").map((o) => o.code), ["SV_4FC", "SV_6CL"]);
  assert.deepEqual(shiftChoices({ Servers: [{ code: "BR_6CL", label: "stray" }, { code: "OFF", label: "Off" }] }, "Servers"), []);
  assert.deepEqual(shiftChoices(OPTIONS, ""), []);
});

// ---- Who's offered --------------------------------------------------------

const STAFF = [
  { name: "Daniel", role: "Servers", section: "FOH" },
  { name: "Akira", role: "Busser/Runner", section: "FOH" },
  { name: "Ivy", role: "Servers" }, // no section stored = FOH
  { name: "Bo", role: "Bar", section: "FOH" },
  { name: "Old Hand", role: "Servers", section: "FOH", active: false },
  { name: "Chef", role: "Kitchen", section: "BOHKITCHEN" },
  { name: "Dish", role: "BOH", section: "BOH" },
  { name: "Gm", role: "Management", section: "MANAGEMENT" },
];
const ROLES_BY_NAME = { Akira: ["Busser/Runner", "Servers"], Daniel: ["Servers"], Bo: ["Bar"] };

test("pickers: active Front of House only — no BOH, Kitchen, Management or inactive staff", () => {
  const { marked, others } = staffChoices({ staff: STAFF, rolesByName: ROLES_BY_NAME });
  assert.deepEqual(marked, []);
  assert.deepEqual(others, ["Akira", "Bo", "Daniel", "Ivy"]);
});

test("pickers: people marked for the role on the Staff tab first, then the rest; the replaced person left out", () => {
  const r = staffChoices({ staff: STAFF, rolesByName: ROLES_BY_NAME, role: "Servers", exclude: ["Daniel"] });
  assert.deepEqual(r.marked, ["Akira", "Ivy"]); // Akira lists Servers among his roles; Ivy falls back to her staff role
  assert.deepEqual(r.others, ["Bo"]);
});

// ---- Warnings -------------------------------------------------------------

test("warnings: already working that day (saving moves them) needs Add anyway", () => {
  const w = staffWarnings({ name: "Akira", working: [{ name: "Akira", code: "BR_5CL" }] });
  assert.deepEqual(w, [{ kind: "working", code: "BR_5CL" }]);
  assert.equal(needsAck(w), true);
});

test("warnings: approved time off — a Rail approval's dated off, or an approved Request Off", () => {
  const rail = staffWarnings({ name: "Akira", override: { type: "OFF", railId: "r1" } });
  assert.deepEqual(rail, [{ kind: "timeoff", source: "rail" }]);
  assert.equal(needsAck(rail), true);
  const req = staffWarnings({ name: "Akira", railOff: true });
  assert.deepEqual(req, [{ kind: "timeoff", source: "request" }]);
  assert.equal(needsAck(req), true);
  // A dated row other than off wins over a Request Off, as on the schedule.
  assert.deepEqual(staffWarnings({ name: "Akira", override: { type: "SV_6CL" }, railOff: true }), []);
});

test("warnings: removed earlier with Remove only is information, not a block", () => {
  const w = staffWarnings({ name: "Akira", override: { type: "OFF", railId: null } });
  assert.deepEqual(w, [{ kind: "removed" }]);
  assert.equal(needsAck(w), false);
  assert.deepEqual(staffWarnings({ name: "Akira" }), []);
});

// ---- Remove, then add back ------------------------------------------------

const DATE = "2026-11-25";
const PLANNED = { Daniel: "SV_6CL", Akira: "BR_5CL" };
const dayOf = (overrides, name) => dayTypeFor({ override: overrides[`${name}|${DATE}`], planned: PLANNED[name] || "OFF" });

test("replace, Remove only, then Add back: the person shows again on that exact shift", () => {
  let ov = {};
  // Replace Daniel with Akira: Daniel off, Akira on Daniel's Server 6pm-CL.
  const replace = planGlanceChange({ mode: "replace", entry: { name: "Daniel", role: "Servers", code: dayOf(ov, "Daniel") }, name: "Akira", roleOptions: OPTIONS });
  ov = withEntries(ov, dayOfEntries({ dateIso: DATE, removeName: "Daniel", addName: replace.name, addCode: replace.code, prev: ov }));
  assert.equal(dayOf(ov, "Daniel"), "OFF");
  assert.equal(dayOf(ov, "Akira"), "SV_6CL");
  assert.equal(roleFromCode(dayOf(ov, "Akira")), "Servers");

  // Remove only Akira: off for the day.
  ov = withEntries(ov, dayOfEntries({ dateIso: DATE, removeName: "Akira", prev: ov }));
  assert.equal(dayOf(ov, "Akira"), "OFF");
  assert.deepEqual(staffWarnings({ name: "Akira", override: ov[`Akira|${DATE}`] }), [{ kind: "removed" }]);

  // Add to tonight: Akira, Server, 6pm-CL — the removed mark is replaced.
  const add = planGlanceChange({ mode: "add", name: "Akira", role: "Servers", shift: "SV_6CL", roleOptions: OPTIONS });
  ov = withEntries(ov, dayOfEntries({ dateIso: DATE, addName: add.name, addCode: add.code, prev: ov }));
  assert.equal(dayOf(ov, "Akira"), "SV_6CL");
  assert.equal(roleFromCode(dayOf(ov, "Akira")), "Servers");
  assert.deepEqual(ov[`Akira|${DATE}`], { type: "SV_6CL", swap: false, railId: null });
  // Still one dated row per person and date; Daniel stays off.
  assert.deepEqual(Object.keys(ov).sort(), [`Akira|${DATE}`, `Daniel|${DATE}`]);
  assert.equal(dayOf(ov, "Daniel"), "OFF");
});

test("add over approved time off keeps the Rail link (as Set Schedule's Override does) and puts them on", () => {
  const prev = { [`Akira|${DATE}`]: { type: "OFF", swap: false, railId: "r1" } };
  const ov = withEntries(prev, dayOfEntries({ dateIso: DATE, addName: "Akira", addCode: "SV_4FC", prev }));
  assert.deepEqual(ov[`Akira|${DATE}`], { type: "SV_4FC", swap: false, railId: "r1" });
  assert.equal(dayOf(ov, "Akira"), "SV_4FC");
});

test("who-works precedence is unchanged: dated row, then approved Request Off, then the planned cell", () => {
  // The rule staffWorkingOn had inline: type = ov?.type || planned; if no ov.type and Request Off -> OFF.
  const old = ({ override, railOff, planned }) => { let t = override?.type || planned; if (!override?.type && railOff) t = "OFF"; return t; };
  for (const override of [null, { type: "SV_6CL" }, { type: "OFF" }, { type: "GAP" }, { type: undefined }]) {
    for (const railOff of [false, true]) {
      for (const planned of ["BR_5CL", "OFF", "GAP"]) {
        assert.equal(dayTypeFor({ override, railOff, planned }), old({ override, railOff, planned }), JSON.stringify({ override, railOff, planned }));
      }
    }
  }
});

// ---- That date's Tip Sheet -------------------------------------------------

test("tip sheet: open sheets follow the change; frozen ones with a saved roster stay put; older frozen ones refuse", () => {
  assert.deepEqual(tipSheetGuard(null), { state: "open" });
  assert.deepEqual(tipSheetGuard({ sent: false, locked: false, finalized: false }), { state: "open" });
  const snap = { s1: { name: "Daniel", pts: 1 } };
  assert.deepEqual(tipSheetGuard({ sent: true, roster_snapshot: snap }), { state: "pinned", how: "sent" });
  assert.deepEqual(tipSheetGuard({ locked: true, roster_snapshot: snap }), { state: "pinned", how: "locked" });
  assert.deepEqual(tipSheetGuard({ finalized: true, roster_snapshot: snap }), { state: "pinned", how: "finalized" });
  assert.deepEqual(tipSheetGuard({ sent: true, roster_snapshot: null }), { state: "refuse", how: "sent" });
  assert.deepEqual(tipSheetGuard({ locked: true, roster_snapshot: {} }), { state: "refuse", how: "locked" });
});
