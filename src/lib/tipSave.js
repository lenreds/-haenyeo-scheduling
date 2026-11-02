// Tip Sheet saves, field by field (migration 0030).
//
// The sheet used to be saved by writing the whole row from this device's copy,
// so whichever device saved last replaced what the other had written. Now a
// save is the list of fields that differ from the row as this device last had
// it from the database ("base"), each with the value it had then. The database
// writes them only if every one still holds that value (save_tip_sheet).
//
// How deep a change goes — must match tip_sheet_path_depth() in 0030:
// 1 = whole column, 2 = one key of a map, 3 = one field inside that key
// (a clock time's in / out). So two devices entering different people's times,
// or one person's IN on the phone and OUT on the desktop, never clash.
export const TIP_SAVE_DEPTH = {
  time_entries: 3, slot_overrides: 3,
  opening_counts: 2, closing_counts: 2,
  floor_cash: 1, floor_credit: 1, bar_cash: 1, bar_credit: 1, covers: 1, cash_sales: 1,
  closing_sum: 1, payouts: 1, bar_tip_out: 1, bar_tip_out_auto: 1, closing_sum_auto: 1,
  expo_as_busser: 1, calc_version: 1,
  sent: 1, sent_at: 1, finalized: 1, finalized_at: 1, locked: 1, locked_at: 1,
  roster_snapshot: 1, zero_tip_acks: 1,
};

// What a locked or finalized sheet may still change: its own lock / send state
// (migration 0029 refuses anything else).
export const TIP_STATUS_COLUMNS = new Set([
  "sent", "sent_at", "finalized", "finalized_at", "locked", "locked_at", "roster_snapshot", "zero_tip_acks",
]);

export function rowIsFrozen(row) {
  return !!(row && (row.locked || row.finalized));
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Same value as the database sees it: undefined = null, 100 = 100.00, and
// objects / arrays compared by content.
export function sameValue(a, b) {
  if (a === undefined) a = null;
  if (b === undefined) b = null;
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => sameValue(a[k], b[k]));
}

// payload: the sheet as on screen (tipPayload()). base: the row as last read
// from / written to the database, or null when the date has no row yet.
// A frozen base keeps only lock / send changes: nothing on a locked sheet's
// figures is ever sent (and the database would refuse it).
export function diffTipRow(base, payload) {
  const out = [];
  const walk = (path, b, a, depthLeft) => {
    // Descend only where both sides have the entry: an entry added or removed
    // whole is one change at its own level (removing it field by field would
    // leave an empty {} behind — and an empty Custom Schedule entry still
    // reads as Custom Schedule on). Top-level columns always descend.
    const both = isObj(a) && isObj(b);
    const topMap = path.length === 1 && (isObj(a) || a == null) && (isObj(b) || b == null);
    if (depthLeft > 1 && (both || topMap)) {
      const keys = new Set([...Object.keys(b || {}), ...Object.keys(a || {})]);
      [...keys].sort().forEach((k) => walk([...path, k], b?.[k], a?.[k], depthLeft - 1));
      return;
    }
    if (!sameValue(b, a)) out.push({ path, before: b ?? null, after: a ?? null });
  };
  Object.keys(payload).forEach((col) => {
    const depth = TIP_SAVE_DEPTH[col];
    if (!depth) return; // date, and anything the database doesn't take this way
    walk([col], base ? base[col] : null, payload[col], depth);
  });
  return rowIsFrozen(base) ? out.filter((c) => TIP_STATUS_COLUMNS.has(c.path[0])) : out;
}

// A copy of row with the changes applied (what the database does on success).
export function applyTipChanges(row, changes) {
  const next = JSON.parse(JSON.stringify(row || {}));
  changes.forEach(({ path, after }) => {
    if (path.length === 1) { next[path[0]] = after; return; }
    let o = next;
    for (let i = 0; i < path.length - 1; i++) {
      if (!isObj(o[path[i]])) o[path[i]] = {};
      o = o[path[i]];
    }
    if (after === null) delete o[path[path.length - 1]];
    else o[path[path.length - 1]] = after;
  });
  return next;
}

const startsWith = (path, prefix) => prefix.every((p, i) => path[i] === p);
// The changes a refused save can still make: everything not on a clashing field.
export function withoutConflicts(changes, conflicts) {
  return changes.filter((c) => !conflicts.some((k) => startsWith(c.path, k.path) || startsWith(k.path, c.path)));
}

// "Covers", "Ana's clock times" … for telling the manager what another device
// changed. slotNames: slot id -> person on it.
const FIELD_LABEL = {
  floor_cash: "Floor Cash Tips", floor_credit: "Floor CC Tips", bar_cash: "Bar Cash Tips", bar_credit: "Bar CC Tips",
  covers: "Covers", cash_sales: "Cash Sales", closing_sum: "Closing Sum", payouts: "Payouts",
  opening_counts: "Opening Bank", closing_counts: "Closing Count", time_entries: "clock times",
  slot_overrides: "Custom Schedule", bar_tip_out: "bar tip-out", bar_tip_out_auto: "bar tip-out",
  closing_sum_auto: "Closing Sum", expo_as_busser: "Expo as Busser/Runner",
  locked: "the lock", locked_at: "the lock", finalized: "finalized", finalized_at: "finalized",
  sent: "sent", sent_at: "sent", roster_snapshot: "the pinned roster", zero_tip_acks: "$0.00 checks", calc_version: "calculation method",
};
export function describeConflicts(conflicts, slotNames = {}) {
  const labels = conflicts.map(({ path }) => {
    if (path[0] === "time_entries" && path[1]) return `${slotNames[path[1]] || path[1]}'s clock ${path[2] === "out" ? "out" : path[2] === "in" ? "in" : "times"}`;
    return FIELD_LABEL[path[0]] || path[0];
  });
  return [...new Set(labels)].join(", ");
}
