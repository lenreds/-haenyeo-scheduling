// Front of House only: each recipient's own shifts, in plain text, for the top
// of their schedule email — "Your week: Mon 4pm-FC, Wed 5pm-CL." Pure.
//
// A wrong line is worse than no line. A recipient gets a line only when they
// can be matched for certain in EVERY week of the email:
//   - by staff id (never by name): exactly one row in that week carries it;
//   - that row's name appears on no other row (shifts are looked up by name
//     on the page, so a shared name could mean someone else's shifts);
//   - the row has 7 shifts and the week has 7 day headers.
// Anything else -> null, and that person gets the plain email + PDFs. No
// fuzzy matching, no stripping name suffixes.
//
// weeks: FOH week payloads ({ weekLabel, dayHeaders: ["Mon 10/26", …],
// rows: [{ id, name, shifts: [7] }] }). Off days ("Off") are left out.
export function personalLinesFor(weeks, staffId) {
  const list = Array.isArray(weeks) ? weeks : [];
  if (!list.length || staffId == null || staffId === "") return null;
  const id = String(staffId);
  const lines = [];
  for (const w of list) {
    const rows = Array.isArray(w?.rows) ? w.rows : [];
    const mine = rows.filter((r) => r?.id != null && String(r.id) === id);
    if (mine.length !== 1) return null;
    const row = mine[0];
    if (rows.filter((r) => r?.name === row.name).length !== 1) return null;
    const heads = Array.isArray(w.dayHeaders) ? w.dayHeaders : [];
    if (!Array.isArray(row.shifts) || row.shifts.length !== 7 || heads.length !== 7) return null;
    const worked = row.shifts
      .map((s, i) => {
        const label = String(s ?? "").trim();
        return label && label !== "Off" ? `${String(heads[i]).split(" ")[0]} ${label}` : null;
      })
      .filter(Boolean);
    const text = worked.length ? worked.join(", ") : "off all week";
    lines.push(list.length === 1 ? `Your week: ${text}.` : `Your week of ${w.weekLabel}: ${text}.`);
  }
  return lines;
}

// The sender's check on the above: how many of this send's FOH recipients got a
// personal line. audience: [{ id, name, section }] — staff recipients only.
// Returns { matched, total, unmatched: [names], line: "Personal lines: N of M staff (managers: plain)." }.
// Managers get the FOH email but are never counted (their days are on the
// Manager On row, not a grid row), and the line says so.
export function personalLineReport(weeks, audience) {
  const foh = (audience || []).filter((r) => r?.id != null && String(r.section || "").toLowerCase() === "foh");
  const unmatched = foh.filter((r) => !personalLinesFor(weeks, r.id)).map((r) => r.name);
  const matched = foh.length - unmatched.length;
  return { matched, total: foh.length, unmatched, line: `Personal lines: ${matched} of ${foh.length} staff (managers: plain).` };
}
