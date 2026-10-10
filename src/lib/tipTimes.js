// Tip Sheet clock times. Two parsers live here, on purpose.
//
// parseTimeInput is the historic record. A sent sheet recalculates HRS from the
// text stored in time_entries every time it opens, so this function decides
// what every past sheet paid. It is frozen: changing it changes old payouts.
// It is lenient and guesses (bare "1" is 1pm, "5:75" is 6:15pm, unreadable
// text is silently null -> 0 HRS).
//
// parsePickerTime is the strict parser for new input. It knows which field it
// is reading — in TIME OUT a bare 12:00–3:59 is after midnight — and
// formatTime writes the result back as text parseTimeInput reads the same way
// ("12:15 AM", never a bare "12:15"). The round-trip test holds the two
// together: what the manager confirms is what gets paid.

// payroll rounding: round any clock punch to the nearest 15 minutes,
// with the classic 7/8-minute cutoff (<=7 rounds down, >=8 rounds up)
export function parseTimeInput(str) {
  if (!str) return null;
  const m = str.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = m[3];
  if (meridiem === "pm" && hour !== 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (!meridiem && hour >= 1 && hour <= 11) hour += 12; // no am/pm typed — assume PM (dinner shift default)
  return hour * 60 + minute;
}
export function roundToQuarter(mins) {
  if (mins == null) return null;
  const rem = mins % 15;
  return rem <= 7 ? mins - rem : mins + (15 - rem);
}
export function hoursBetween(inStr, outStr) {
  const inM = roundToQuarter(parseTimeInput(inStr));
  let outM = roundToQuarter(parseTimeInput(outStr));
  if (inM == null || outM == null) return 0;
  if (outM < inM) outM += 24 * 60; // shift crosses midnight
  return (outM - inM) / 60;
}

// Nobody here works this long; more than this is a mistyped time.
export const MAX_SHIFT_HOURS = 14;

// Minutes after midnight (0–1439) from typed text, or null if it isn't a clear
// time. Accepts 5:45, 545, 5 45, 17:45, with or without am/pm. A typed am/pm
// always wins. Without one: TIME IN assumes evening (4:15 = 4:15 PM, bare 12 =
// noon); TIME OUT reads 12:00–3:59 as after midnight and 4–11 as evening.
export function parsePickerTime(text, field) {
  const s = String(text ?? "").trim().toLowerCase();
  const m = s.match(/^(\d{1,2})(?:[:\s]?(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = m[3];
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  } else if (hour >= 13 || hour === 0) {
    // 24-hour clock, taken as typed
  } else if (field === "out" && (hour === 12 || hour <= 3)) {
    if (hour === 12) hour = 0; // 12:xx -> after midnight
  } else if (hour !== 12) {
    hour += 12;
  }
  return hour * 60 + minute;
}

// Minutes after midnight -> "5:45 PM" / "12:15 AM". Always carries AM/PM, so
// parseTimeInput can't read it any other way.
export function formatTime(mins) {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${h24 < 12 ? "AM" : "PM"}`;
}

// Typed text -> the unambiguous stored form, or null if it isn't a clear time
// (then it's left as typed and the Lock / Send guard names it).
export function normalizeTimeEntry(text, field) {
  const mins = parsePickerTime(text, field);
  return mins == null ? null : formatTime(mins);
}

// TEST-ONLY — not wired into the app. It was the leave-a-cell cleanup while
// time cells were typeable; the cells are tap-only now and the panel is the
// only writer, so nothing rewrites stored text behind the manager. Kept
// because the invariant tests use it to define "rescued" (see tipTimes.test.js).
// The text to store when a time cell is left, or null to leave it alone.
// `frozen` = sent, locked or finalized: the stored text of a sheet that went
// out is never rewritten, even when both forms would pay the same.
export function settledTime(typed, field, frozen) {
  if (frozen || !typed) return null;
  const clean = normalizeTimeEntry(typed, field);
  return clean && clean !== typed ? clean : null;
}
