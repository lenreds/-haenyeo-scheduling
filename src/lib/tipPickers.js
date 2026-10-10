// What the Tip Sheet's tap panels offer. Pure, so the chips can be tested
// against what the sheet pays (see tipPickers.test.js).
//
// Time panel: five quarter-hour chips. Every value it writes goes through
// formatTime ("5:45 PM", "12:15 AM"), which the frozen parseTimeInput reads
// back as exactly the minute shown.
// Cash panel: five chips that are multiples of the row's denomination. All
// arithmetic is whole cents; nothing here touches the sheet's totals.

import { formatTime, parseTimeInput, roundToQuarter } from "./tipTimes.js";

const DAY = 1440;
const wrap = (m) => ((m % DAY) + DAY) % DAY;

// ---- Time --------------------------------------------------------------

// Scheduled start (minutes after midnight) from a shift code: SV_5SC -> 17:00,
// HOST_4 -> 16:00. Dinner service, so 1–11 is PM and 12 is noon. null when the
// code carries no start hour (a manager-added "7pm", no code at all).
export function scheduledStartMins(code) {
  const m = String(code || "").match(/_(\d{1,2})/);
  if (!m) return null;
  const h = Number(m[1]);
  if (h < 1 || h > 12) return null;
  return (h === 12 ? 12 : h + 12) * 60;
}

const PLACEHOLDER = { in: 16 * 60, out: 21 * 60 }; // the cells' "4:00 PM" / "9:00 PM"

// Where the five chips centre when the panel opens.
// TIME IN: the scheduled start, so the dashed chip is in view — unless the
// current value is more than 30 min away, then the current value (so the
// filled chip is in view). No schedule: the current value, else 4:00 PM.
// TIME OUT: the current value, else the 9:00 PM placeholder.
export function timeLadderCenter({ field, current, scheduled }) {
  const cur = current == null ? null : roundToQuarter(current);
  if (field === "in" && scheduled != null) {
    if (cur == null) return scheduled;
    const d = Math.abs(signedDiff(cur, scheduled));
    return d <= 30 ? scheduled : wrap(cur);
  }
  return cur != null ? wrap(cur) : PLACEHOLDER[field];
}

// Five chips around `center`, shifted by `offset` quarter-hours (‹ / ›).
// Crosses midnight: 11:30 PM, 11:45 PM, 12:00 AM, 12:15 AM...
export function timeChips(center, offset = 0) {
  const c = center + offset * 15;
  return [-30, -15, 0, 15, 30].map((d) => {
    const mins = wrap(c + d);
    return { mins, label: formatTime(mins), value: formatTime(mins) };
  });
}

// Minutes from b to a, in -720..719 (so 12:15 AM vs 11:45 PM is +30).
export function signedDiff(a, b) {
  return wrap(a - b + 720) - 720;
}

// "+15 min vs schedule", "−1 hr 15 min vs schedule", "on schedule".
// Compared on the quarter-rounded value — the one HRS is paid on.
export function scheduleDelta(currentText, scheduled) {
  if (scheduled == null) return null;
  const cur = roundToQuarter(parseTimeInput(currentText));
  if (cur == null) return null;
  const d = signedDiff(cur, scheduled);
  if (d === 0) return "on schedule";
  const a = Math.abs(d);
  const h = Math.floor(a / 60);
  const m = a % 60;
  const amount = [h ? `${h} hr` : "", m ? `${m} min` : ""].filter(Boolean).join(" ");
  return `${d > 0 ? "+" : "−"}${amount} vs schedule`;
}

// The minute a stored time pays on, for marking the filled chip. Read with
// the frozen parser, so the panel shows what the sheet actually pays.
export function paidMinute(text) {
  return parseTimeInput(text);
}

// ---- Cash --------------------------------------------------------------

// Denomination in whole cents: 100 -> 10000, 0.25 -> 25.
export function denomCents(denom) {
  return Math.round(Number(denom) * 100);
}

// Typed dollars -> whole cents, from the text (no float). "420" -> 42000,
// ".75" -> 75, "1.5" -> 150. null for anything that isn't an amount, or has
// more than two decimals. "" -> null.
export function parseCents(text) {
  const s = String(text ?? "").trim().replace(/^\$/, "");
  const m = s.match(/^(\d*)(?:\.(\d{0,2}))?$/);
  if (!m || (m[1] === "" && (m[2] === undefined || m[2] === ""))) return null;
  return Number(m[1] || 0) * 100 + Number((m[2] || "").padEnd(2, "0"));
}

// Cents -> the text stored in the cell: whole dollars plain ("160"),
// otherwise two decimals ("0.75", "1.25"). parseFloat reads it exactly.
export function centsToStored(c) {
  return c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2);
}

// Chip label as the brief writes it: bill rows in whole dollars (100 200),
// coin rows in cents (.25 .50 1.00 1.25).
export function cashChipLabel(c, d) {
  if (d >= 100) return String(c / 100);
  if (c < 100) return `.${String(c).padStart(2, "0")}`;
  return (c / 100).toFixed(2);
}

// Page p of five chips: multiples (5p+1 .. 5p+5) × the denomination.
export function cashChips(denom, page = 0) {
  const d = denomCents(denom);
  return [1, 2, 3, 4, 5].map((k) => {
    const c = (page * 5 + k) * d;
    return { cents: c, label: cashChipLabel(c, d), value: centsToStored(c) };
  });
}

// The page that shows the stored amount, when it's a chip; else page 0.
export function cashPageFor(denom, storedText) {
  const c = parseCents(storedText);
  const d = denomCents(denom);
  if (!c || c % d !== 0) return 0;
  return Math.floor((c / d - 1) / 5);
}

// What the panel says about a typed figure. Never blocks or corrects it.
// null = nothing to say (blank, or a clean multiple).
export function cashCheck(denom, text, denomLabel) {
  if (String(text ?? "").trim() === "") return null;
  const c = parseCents(text);
  if (c == null) return { kind: "invalid", message: "Not an amount — numbers only, up to 2 decimals." };
  const d = denomCents(denom);
  if (c % d === 0) return null;
  const lo = Math.floor(c / d) * d;
  const hi = lo + d;
  const fmt = (x) => `$${(x / 100).toFixed(2)}`;
  return {
    kind: "multiple",
    message: `${fmt(c)} isn't a multiple of ${denomLabel} — nearest are ${fmt(lo)} and ${fmt(hi)}.`,
  };
}

// ---- When a panel may open ---------------------------------------------

// The lock is what protects a sheet, not the fact that it was once emailed.
// Unlock clears locked + finalized but leaves sent on, and a sent-then-
// unlocked sheet must be correctable (fix the time, re-lock, re-send) — the
// cells are tap-only, so if this refused on `sent` there'd be no way in.
// Same test as the sheet's .tip-locked style. Empty slot: nobody to time.
export function pickerMayOpen({ locked, finalized, hasPerson = true }) {
  return !locked && !finalized && !!hasPerson;
}
