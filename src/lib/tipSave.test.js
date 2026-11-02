import { test } from "node:test";
import assert from "node:assert/strict";
import { diffTipRow, applyTipChanges, withoutConflicts, sameValue, describeConflicts } from "./tipSave.js";

const base = {
  date: "2026-11-02", rev: 4, covers: 80, floor_cash: 100, locked: false, finalized: false,
  time_entries: { server1: { in: "4:00 PM", out: "" } }, opening_counts: { 20: "40" },
  slot_overrides: {}, payouts: [{ id: "p1", desc: "ice", amount: "12.50" }], roster_snapshot: null,
};

test("only what changed, down to one clock time", () => {
  const payload = { ...base, covers: 84, time_entries: { server1: { in: "4:00 PM", out: "11:15 PM" }, bar1: { in: "5:00 PM", out: "" } } };
  assert.deepEqual(diffTipRow(base, payload), [
    { path: ["covers"], before: 80, after: 84 },
    { path: ["time_entries", "bar1"], before: null, after: { in: "5:00 PM", out: "" } },
    { path: ["time_entries", "server1", "out"], before: "", after: "11:15 PM" },
  ]);
});

test("nothing changed: no changes; 100 = 100.00; date and rev never sent", () => {
  assert.deepEqual(diffTipRow(base, { ...base, floor_cash: 100.0, date: "x", rev: 9 }), []);
});

test("a whole entry removed is one change, not an empty {} left behind", () => {
  const b = { ...base, slot_overrides: { server1: { name: "Ana", pts: 1 } } };
  const d = diffTipRow(b, { ...b, slot_overrides: {} });
  assert.deepEqual(d, [{ path: ["slot_overrides", "server1"], before: { name: "Ana", pts: 1 }, after: null }]);
  assert.deepEqual(applyTipChanges(b, d).slot_overrides, {});
});

test("no row yet: everything set is a change against null", () => {
  const d = diffTipRow(null, { date: "2026-11-02", covers: 80, opening_counts: {}, calc_version: 3 });
  assert.deepEqual(d, [{ path: ["covers"], before: null, after: 80 }, { path: ["calc_version"], before: null, after: 3 }]);
});

test("a locked or finalized sheet sends only lock / send state, never figures", () => {
  const locked = { ...base, locked: true };
  const d = diffTipRow(locked, { ...locked, covers: 99, locked: false, locked_at: null, roster_snapshot: null });
  assert.deepEqual(d.map((c) => c.path[0]), ["locked"]);
  const fin = { ...base, finalized: true };
  assert.deepEqual(diffTipRow(fin, { ...fin, time_entries: {} }), []);
});

test("payouts compared whole; array order matters", () => {
  const p2 = [...base.payouts, { id: "p2", desc: "", amount: "" }];
  assert.deepEqual(diffTipRow(base, { ...base, payouts: p2 }), [{ path: ["payouts"], before: base.payouts, after: p2 }]);
});

test("apply, and drop the clashing ones", () => {
  const changes = [
    { path: ["covers"], before: 80, after: 84 },
    { path: ["time_entries", "server1", "out"], before: "", after: "11:15 PM" },
    { path: ["time_entries", "server1", "in"], before: "4:00 PM", after: null },
  ];
  const r = applyTipChanges(base, changes);
  assert.equal(r.covers, 84);
  assert.deepEqual(r.time_entries.server1, { out: "11:15 PM" });
  assert.equal(base.covers, 80, "base untouched");
  assert.deepEqual(withoutConflicts(changes, [{ path: ["time_entries", "server1"] }]), [changes[0]]);
  assert.deepEqual(withoutConflicts(changes, [{ path: ["covers"] }]).length, 2);
});

test("sameValue and the clash wording", () => {
  assert.ok(sameValue(undefined, null));
  assert.ok(!sameValue(0, null));
  assert.ok(!sameValue("", null));
  assert.equal(
    describeConflicts([{ path: ["covers"] }, { path: ["time_entries", "server1", "out"] }, { path: ["time_entries", "server1", "in"] }], { server1: "Ana" }),
    "Covers, Ana's clock out, Ana's clock in"
  );
});
