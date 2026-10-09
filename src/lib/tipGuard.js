// What stops Lock and Send. Run on the slots exactly as the sheet shows them
// (finalSlots), so it checks the numbers that would be emailed.
//
// blocks  — no override, always fixable in seconds: a missing or unreadable
//           TIME IN / TIME OUT, or a shift over MAX_SHIFT_HOURS (the midnight
//           wrap: TIME OUT "1" after a 5pm start reads as 20 hours).
// zeroes  — someone carrying points whose final tip is $0.00 for any other
//           reason. Legitimate causes exist (sent home at the top of the
//           shift, a no-show still on the roster), so each name is ticked as
//           checked before Lock or Send, and the tick is recorded.
//
// Only people carrying points count: an empty slot, or the Host at 0 points
// under 80 covers, isn't owed anything.

import { MAX_SHIFT_HOURS, parsePickerTime, parseTimeInput } from "./tipTimes.js";
import { truncCents } from "./tipRules.js";

function readable(text, field) {
  return parseTimeInput(text) != null && parsePickerTime(text, field) != null;
}

export function tipSheetProblems(slots, times) {
  const blocks = [];
  const zeroes = [];
  slots.forEach((p) => {
    if (!p.name || !(p.pts > 0)) return;
    const t = times[p.id] || {};
    const tin = String(t.in ?? "").trim();
    const tout = String(t.out ?? "").trim();
    const base = { slotId: p.id, name: p.name };
    if (!tin && !tout) {
      blocks.push({ ...base, message: `${p.name} has no time in or time out — tip is $0.00.` });
    } else if (!tin) {
      blocks.push({ ...base, message: `${p.name} has no time in — tip is $0.00.` });
    } else if (!tout) {
      blocks.push({ ...base, message: `${p.name} has no time out — tip is $0.00.` });
    } else if (!readable(tin, "in")) {
      blocks.push({ ...base, message: `${p.name}'s time in "${tin}" isn't a time the sheet can read.` });
    } else if (!readable(tout, "out")) {
      blocks.push({ ...base, message: `${p.name}'s time out "${tout}" isn't a time the sheet can read.` });
    } else if (p.hours > MAX_SHIFT_HOURS) {
      blocks.push({ ...base, message: `${p.name} shows ${p.hours.toFixed(2)} hours (${tin} to ${tout}) — over ${MAX_SHIFT_HOURS}, check the time out.` });
    } else if (truncCents(p.final) === 0) {
      const why = p.hours === 0 ? ` (${tin} to ${tout} is 0.00 hours)` : "";
      zeroes.push({ ...base, message: `${p.name}'s tip is $0.00${why}.` });
    }
  });
  return { blocks, zeroes };
}

// Every $0.00 name has a tick for this action.
export function zeroesAllAcked(zeroes, acks) {
  return zeroes.every((z) => acks.some((a) => a.slot === z.slotId && a.name === z.name));
}

// The stored record of a tick: who, when, for which action, and what the sheet
// said. Kept with the sheet (tip_sheets.zero_tip_acks), never shown on it.
export function ackEntry(zero, { action, by, at }) {
  return { slot: zero.slotId, name: zero.name, tip: "0.00", reason: zero.message, action, by: by || null, at };
}
