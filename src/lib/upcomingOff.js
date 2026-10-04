// Rail "Upcoming Time Off": approved Request Off and Time Off in the next N
// days. "Already decided, don't forget" — pending requests never appear here,
// they live in Pending Decisions.
//
// Which days count:
//  - REQUEST OFF: the approved date(s) on the request, minus any day a manager
//    has since put that person back on a shift (an override that isn't off).
//  - TIME OFF: the Off days its approval actually wrote to the schedule
//    (overrides linked by rail_request_id). A partial approval keeps the full
//    requested range on the request itself, so the request text can't be
//    trusted — the linked overrides are what was approved. If an approval wrote
//    nothing (the write failed, e.g. before migration 0021), the requested range
//    is shown flagged notOnSchedule rather than silently dropped.

const DAY_MS = 86400000;
const toDate = (isoStr) => new Date(`${isoStr}T00:00:00`);
const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function addDaysIso(isoStr, n) {
  const d = toDate(isoStr);
  d.setDate(d.getDate() + n);
  return toIso(d);
}

// Sorted ISO dates -> runs of consecutive days: [[start, end], ...].
export function dateRuns(dates) {
  const sorted = [...new Set(dates)].sort();
  const runs = [];
  sorted.forEach((d) => {
    const last = runs[runs.length - 1];
    if (last && Math.round((toDate(d) - toDate(last[1])) / DAY_MS) === 1) last[1] = d;
    else runs.push([d, d]);
  });
  return runs;
}

// [["2026-10-12","2026-10-18"]] -> "Oct 12 – 18"; across months "Oct 30 – Nov 2".
export function formatRuns(runs) {
  const md = (isoStr, withMonth = true) => toDate(isoStr).toLocaleDateString("en-US", withMonth ? { month: "short", day: "numeric" } : { day: "numeric" });
  return runs.map(([a, b]) => {
    if (a === b) return md(a);
    const sameMonth = a.slice(0, 7) === b.slice(0, 7);
    return `${md(a)} – ${md(b, !sameMonth)}`;
  }).join(", ");
}

// resolved: [{ id, name, type, dates, status }]
// overrides: { "Name|YYYY-MM-DD": { type, railId } }
// parseDates(str) -> ISO[]; timeOffRange(str) -> ISO[]; isOff(code) -> bool
export function upcomingTimeOff({ resolved, overrides, todayIso, days = 30, parseDates, timeOffRange, isOff }) {
  const endIso = addDaysIso(todayIso, days - 1); // today + the next 29 = 30 days
  const inWindow = (d) => d >= todayIso && d <= endIso;
  const linkedOff = {}; // request id -> ISO[] its approval wrote as off
  Object.entries(overrides || {}).forEach(([key, ov]) => {
    if (!ov?.railId || !isOff(ov.type || "OFF")) return;
    (linkedOff[ov.railId] = linkedOff[ov.railId] || []).push(key.slice(key.lastIndexOf("|") + 1));
  });
  const rows = [];
  (resolved || []).forEach((r) => {
    if (r.status !== "approved") return;
    let dates;
    let notOnSchedule = false;
    if (r.type === "REQUEST OFF") {
      dates = parseDates(r.dates).filter((d) => {
        const ov = overrides?.[`${r.name}|${d}`];
        return !(ov && ov.type && !isOff(ov.type)); // put back on a shift since
      });
    } else if (r.type === "TIME OFF") {
      dates = linkedOff[r.id] || [];
      if (!dates.length) { dates = timeOffRange(r.dates); notOnSchedule = dates.length > 0; }
    } else return;
    if (!dates.some(inWindow)) return;
    const runs = dateRuns(dates).filter(([a, b]) => b >= todayIso && a <= endIso);
    rows.push({
      id: r.id,
      name: r.name,
      type: r.type,
      runs,
      label: formatRuns(runs),
      sortKey: dates.filter(inWindow).sort()[0],
      notOnSchedule,
    });
  });
  return rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.name.localeCompare(b.name));
}
