// Saved schedules (migration 0028): the rules for applying one to a week,
// kept apart from the UI so they can be tested on their own.
//
// A saved schedule stores cells BY PERSON (staff id), never by roster row.
// Applying it works out, for each of its cells, what would happen to the week
// on screen, and nothing is written until the manager has seen that and
// confirmed:
//   fill     the cell holds nothing at all (no stored value of any kind)
//   replace  the cell holds something else — INCLUDING a stored Off: a day
//            someone was set off is a decision, listed as "Off -> 4pm-FC",
//            never counted as blank
//   skip     never written, always listed by name and day:
//              - approved time off (no way through — not a tick, not a confirm)
//              - the person isn't on that grid's roster now (left, moved section)
//              - the shift is retired, or no longer exists
//              - they're already working in another section that day
// Cells that already match are left alone and not listed.

export const OFF = "OFF";

// Which grids each saved-schedule section covers (null = the FOH grid).
export const SECTION_GROUPS = { foh: [null], bohkitchen: ["boh", "kitchen"], management: ["management"] };

// cells:   the saved schedule's [{ staff_id, name, group_key, weekday, code }]
// roster:  who is on this section's grid(s) this week:
//          [{ staffId, name, groupKey (null = FOH), slotIndex (null = FOH) }]
// current(entry, weekday)        -> { code, stored }  stored: false = nothing at all
// timeOff(entry, weekday)        -> true when that day is approved time off
// optionStatus(entry, code)      -> "ok" | "retired" | "unknown"
// crossBlock(entry, weekday)     -> label of another section they work that day, or null
// groupLabel(groupKey)           -> "Kitchen" etc. (for "not on the Kitchen roster")
// -> { fill: [w], replace: [w], skip: [{ name, weekday|null, reason }], unchanged }
//    where each w = { entry, name, weekday, before, after } is a write to make.
export function planApply({ cells, roster, current, timeOff, optionStatus, crossBlock = () => null, groupLabel = (g) => g || "Front of House" }) {
  const fill = [];
  const replace = [];
  const skip = [];
  let unchanged = 0;

  const byPerson = new Map();
  (cells || []).forEach((c) => {
    const key = `${c.staff_id}|${c.group_key ?? ""}`;
    if (!byPerson.has(key)) byPerson.set(key, []);
    byPerson.get(key).push(c);
  });

  for (const personCells of byPerson.values()) {
    const first = personCells[0];
    const groupKey = first.group_key ?? null;
    const entry = roster.find((r) => r.staffId === first.staff_id && (r.groupKey ?? null) === groupKey);
    if (!entry) {
      // One line per person, not seven. Only worth saying if the saved schedule
      // had them working at all — someone saved as Off all week changes nothing.
      if (personCells.some((c) => c.code !== OFF)) {
        skip.push({ name: first.name, weekday: null, reason: `not on the ${groupLabel(groupKey)} roster now` });
      }
      continue;
    }
    for (const c of [...personCells].sort((a, b) => a.weekday - b.weekday)) {
      const cur = current(entry, c.weekday) || { code: OFF, stored: false };
      if (cur.code === c.code) { unchanged++; continue; }
      const w = { entry, name: entry.name, weekday: c.weekday, before: cur.code, after: c.code };
      if (timeOff(entry, c.weekday)) { skip.push({ name: entry.name, weekday: c.weekday, reason: "approved time off" }); continue; }
      if (c.code !== OFF) {
        const status = optionStatus(entry, c.code);
        if (status === "retired") { skip.push({ name: entry.name, weekday: c.weekday, reason: "that shift is retired", code: c.code }); continue; }
        if (status !== "ok") { skip.push({ name: entry.name, weekday: c.weekday, reason: "that shift no longer exists", code: c.code }); continue; }
        const other = crossBlock(entry, c.weekday);
        if (other) { skip.push({ name: entry.name, weekday: c.weekday, reason: `already working in ${other} that day`, code: c.code }); continue; }
      }
      if (!cur.stored && cur.code === OFF) fill.push(w);
      else replace.push(w);
    }
  }
  return { fill, replace, skip, unchanged };
}

// The changes an apply recorded that no longer hold what it wrote — edited
// since. Undo refuses if this isn't empty, rather than reverting a later change.
// currentCode(change) -> what that cell holds now.
export function undoConflicts(changes, currentCode) {
  return (changes || []).filter((c) => currentCode(c) !== c.after);
}
