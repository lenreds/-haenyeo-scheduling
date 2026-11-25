// Today at a Glance: Replace and Add to tonight (glance-staff, 2026-11-25).
// Pure functions, so the rules below are checked by npm test without the app.
//
// Both are DAY-OF changes: dated schedule_overrides rows, the same save the
// Tip Sheet's "+ Add staff" / remove use (App's applyDayOfChange). Who works a
// date is decided in one place (App's staffWorkingOn): a dated row wins over
// the week's Set Schedule cell, so the Tip Sheet, Glance and the Calendar all
// follow it, and the Tip Sheet slot comes from the shift's role (SV_ = Server,
// BR_ = Busser/Runner…), exactly as for a Set Schedule edit. The planned week
// on Set Schedule is left as built (a marker on the cell says what changed).
//
// What went wrong before (Akira for Daniel, 2026-11-25): Replace listed the
// shifts of the REPLACEMENT's first role on the Staff tab, so Akira (first
// role Busser/Runner) went on as Busser/Runner. Now the replacement takes the
// replaced person's exact shift code, and nothing is ever guessed.

import { roleFromCode, normalizeShiftCode } from "./shiftCodes.js";
import { isFrozen } from "./tipRules.js";

// The roles Add to tonight offers: the floor roles with a Tip Sheet slot.
// Training is left out (owner, 2026-11-25): it shows on Glance but isn't
// tipped. Nothing is pre-picked: the role is always chosen by hand.
export const GLANCE_ADD_ROLES = ["Servers", "Busser/Runner", "Expo", "Host", "Bar"];

// Off by the option, as everywhere else in the app: empty, OFF, the legacy
// bare RO, and any option marked "Counts as off".
const ALWAYS_OFF = new Set(["", "OFF", "RO"]);

// ---- Replace -------------------------------------------------------------
// The shift the replacement takes over: the replaced person's own code, an
// old-style code (OPENER, CLOSER…) first made whole with THEIR role, never the
// replacement's. null when there's nothing to take over — a coverage gap, or a
// shift with no floor role (a manager on FM) — and the dialog then asks for
// the role and shift instead.
export function replacementShift(entry) {
  if (!entry || !entry.code || entry.code === "GAP") return null;
  const code = normalizeShiftCode(entry.code, entry.role);
  const role = roleFromCode(code);
  if (!role || role === "Training" || ALWAYS_OFF.has(code)) return null;
  return { code, role };
}

// ---- Shift choices -------------------------------------------------------
// A role's shifts as offered: current ones only — not "Counts as off", not
// retired — and only codes that really are that role's.
export function shiftChoices(roleOptions, role) {
  if (!role) return [];
  return ((roleOptions || {})[role] || []).filter(
    (o) => o && !o.retired && !o.isOff && !ALWAYS_OFF.has(o.code || "") && roleFromCode(o.code) === role
  );
}

// ---- Who's offered -------------------------------------------------------
// Today at a Glance is Front of House: active FOH staff only — not BOH,
// Kitchen or Management. With a role known, the people marked for it on the
// Staff tab come first (the dialog draws a divider), the rest after; each
// group A–Z.
export function isFohStaff(s) {
  return !!s && !!s.name && s.active !== false && (s.section || "FOH") === "FOH";
}
export function staffChoices({ staff, rolesByName = {}, role = null, exclude = [] }) {
  const skip = new Set(exclude);
  const seen = new Set();
  const people = [];
  (staff || []).forEach((s) => {
    if (!isFohStaff(s) || skip.has(s.name) || seen.has(s.name)) return;
    seen.add(s.name);
    people.push(s);
  });
  people.sort((a, b) => a.name.localeCompare(b.name));
  if (!role) return { marked: [], others: people.map((s) => s.name) };
  const rolesOf = (s) => (rolesByName[s.name] && rolesByName[s.name].length ? rolesByName[s.name] : [s.role]);
  const marked = people.filter((s) => rolesOf(s).includes(role)).map((s) => s.name);
  const markedSet = new Set(marked);
  return { marked, others: people.map((s) => s.name).filter((n) => !markedSet.has(n)) };
}

// ---- Warnings ------------------------------------------------------------
// What to tell the manager about the person picked, for the date:
//   working  — already on that day ({ code }): one person has one shift a day,
//              so saving MOVES them, leaving their own shift uncovered;
//   timeoff  — approved time off: a Rail approval's dated off (source "rail")
//              or an approved Request Off with no dated row (source "request");
//   removed  — taken off earlier with Remove only: adding them back clears it.
// working and timeoff need "Add anyway" ticked (needsAck); removed is only
// information. Same order of precedence as who-works (dayTypeFor).
export function staffWarnings({ name, working = [], override = null, railOff = false }) {
  const out = [];
  if (!name) return out;
  const on = working.find((w) => w.name === name);
  if (on) out.push({ kind: "working", code: on.code });
  if (override?.type === "OFF" && override.railId) out.push({ kind: "timeoff", source: "rail" });
  else if (!override?.type && railOff) out.push({ kind: "timeoff", source: "request" });
  else if (override?.type === "OFF") out.push({ kind: "removed" });
  return out;
}
export function needsAck(warnings) {
  return (warnings || []).some((w) => w.kind === "working" || w.kind === "timeoff");
}

// ---- The change itself ---------------------------------------------------
// What Replace / Add will save, or why it can't yet.
//   mode "replace": entry = the Glance row being replaced. Its shift is taken
//     over exactly; only when there's none to take over (replacementShift is
//     null) do role and shift have to be picked.
//   mode "add": role and shift always picked.
// -> { ok: true, name, role, code } | { ok: false, error }
export function planGlanceChange({ mode, entry = null, name, role = "", shift = "", roleOptions }) {
  if (!name) return { ok: false, error: "Pick the person." };
  if (mode === "replace") {
    if (entry && name === entry.name) return { ok: false, error: `${name} is the person being replaced.` };
    const takes = replacementShift(entry);
    if (takes) return { ok: true, name, role: takes.role, code: takes.code };
  } else if (mode !== "add") {
    return { ok: false, error: "Unknown change." };
  }
  if (!role) return { ok: false, error: "Pick the role." };
  if (!GLANCE_ADD_ROLES.includes(role)) return { ok: false, error: `${role} can't be added here.` };
  if (!shift) return { ok: false, error: "Pick the shift." };
  if (!shiftChoices(roleOptions, role).some((o) => o.code === shift)) {
    return { ok: false, error: "That shift isn't one of this role's current shifts." };
  }
  return { ok: true, name, role, code: shift };
}

// The dated rows a day-of change writes, as the app's overrides map holds
// them ("name|YYYY-MM-DD" -> { type, swap, railId }):
//   removeName -> OFF (taken off for the day);
//   addName    -> the shift. It replaces whatever dated row they had — a
//                 Remove only "off" included, so someone removed earlier comes
//                 back on. A Rail link on that row is kept (the request stays
//                 approved, as Set Schedule's "Override" keeps it).
export function dayOfEntries({ dateIso, removeName = null, addName = null, addCode = null, prev = {} }) {
  const out = [];
  if (removeName) out.push({ name: removeName, key: `${removeName}|${dateIso}`, type: "OFF", swap: false, railId: null });
  if (addName) {
    const before = prev[`${addName}|${dateIso}`];
    out.push({ name: addName, key: `${addName}|${dateIso}`, type: addCode, swap: !!removeName, railId: before?.railId ?? null });
  }
  return out;
}
export function withEntries(overrides, entries) {
  const next = { ...(overrides || {}) };
  entries.forEach((e) => { next[e.key] = { type: e.type, swap: e.swap, railId: e.railId }; });
  return next;
}

// How one person's day reads — App's staffWorkingOn calls this for everyone:
// a dated row wins; otherwise an approved Request Off means off; otherwise
// the week's own Set Schedule cell (or the template).
export function dayTypeFor({ override = null, railOff = false, planned }) {
  return override?.type || (railOff ? "OFF" : planned);
}

// ---- That date's Tip Sheet -----------------------------------------------
// A sent, locked or finalized sheet is the record of what was paid.
//   open    — not frozen: the change shows on it, like a Set Schedule edit.
//   pinned  — frozen with its roster saved: it keeps the names it was sent
//             with, so the change can be made and the sheet doesn't move.
//   refuse  — frozen before rosters were saved with sheets: it still follows
//             the schedule, so the change would alter it. Not allowed.
export function tipSheetGuard(row) {
  if (!row || !isFrozen({ sent: row.sent, locked: row.locked, finalized: row.finalized })) return { state: "open" };
  const how = row.finalized ? "finalized" : row.locked ? "locked" : "sent";
  const snap = row.roster_snapshot;
  const pinned = !!snap && typeof snap === "object" && Object.keys(snap).length > 0;
  return { state: pinned ? "pinned" : "refuse", how };
}
