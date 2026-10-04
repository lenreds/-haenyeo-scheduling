// Tip Sheet rules that are decided per date: the Expo slot running as a third
// Busser/Runner, the automatic bar tip-out, and Closing Sum filling itself from
// the cash count. Pure functions so they can be checked without the app.
//
// The rule every one of these obeys: a sheet that is sent, locked or finalized
// ("frozen") is the record of what was paid. It shows the values stored on its
// row and never re-runs an automatic rule, so a sheet emailed last week opens
// with the numbers it was emailed with, whatever rules exist now.

export const BAR_TIP_OUT_THRESHOLD = 60; // dollars; charged only when strictly over
export const BAR_TIP_OUT_RATE = 0.1;
export const EXPO_AS_BUSSER_PTS = 0.6;

// Dollars -> whole cents, truncated (never rounded up). The epsilon absorbs
// float noise like 0.1 + 0.2 = 0.30000000000000004 or 0.29 * 100 = 28.999…,
// so a typed 60.00 is exactly 6000 cents.
export function truncCents(n) {
  return Math.floor((Number(n) || 0) * 100 + 1e-6);
}

export function isFrozen({ sent, locked, finalized }) {
  return !!(sent || locked || finalized);
}

// Expo slot -> third Busser/Runner. Same slot id, so whoever was scheduled on
// Expo keeps the slot, and their clock times and any Custom Schedule entry
// follow them. Only the role, label and points change.
export function applyExpoMode(slots, expoAsBusser) {
  if (!expoAsBusser) return slots;
  return slots.map((s) => (s.id === "expo"
    ? { ...s, role: "Busser/Runner", label: "Busser/Runner (3rd, no Expo)", defaultPts: EXPO_AS_BUSSER_PTS }
    : s));
}

// Bar tips = BAR CASH TIPS + BAR CC TIPS. Strictly over $60.00, in cents.
export function barTipOutAutoOn(barPool) {
  return truncCents(barPool) > BAR_TIP_OUT_THRESHOLD * 100;
}

// mode: "auto" (follows the $60 rule), "manual" (set by hand), or "legacy" (a
// sheet frozen before the rule existed: whatever it recorded stands).
export function barTipOutEffective({ mode, storedOn, barPool, frozen }) {
  if (frozen || mode !== "auto") return storedOn;
  return barTipOutAutoOn(barPool);
}

// What the sheet says about the tip-out, so it always shows which it is.
export function barTipOutReason({ mode, storedOn, barPool, frozen, money }) {
  const bar = `$${money(barPool)}`;
  const line = `$${money(BAR_TIP_OUT_THRESHOLD)}`;
  const autoOn = barTipOutAutoOn(barPool);
  if (mode === "legacy") return "set by hand, before the automatic rule";
  if (mode === "manual") return `set by hand — auto would be ${autoOn ? "on" : "off"} (bar tips ${bar})`;
  if (frozen && autoOn !== storedOn) return `auto when recorded: ${storedOn ? "on" : "off"} — kept as recorded (the rule would now say ${autoOn ? "on" : "off"})`;
  return autoOn ? `auto: bar tips ${bar} over ${line}` : `auto: bar tips ${bar}, not over ${line}`;
}

// Closing Sum. `auto` = nothing typed, so it follows the Closing column total.
// Frozen: the stored figure exactly as recorded (blank stays blank).
export function closingSumEffective({ auto, typed, countTotal, frozen }) {
  if (frozen || !auto) return parseFloat(typed) || 0;
  return truncCents(countTotal) / 100;
}

// Typed figure vs the count, in cents. null when they agree or nothing typed.
export function closingSumDiffCents({ auto, typed, countTotal, frozen }) {
  if (!frozen && auto) return null;
  if (typed === "" || typed == null) return frozen && truncCents(countTotal) !== 0 ? -truncCents(countTotal) : null;
  const d = truncCents(parseFloat(typed)) - truncCents(countTotal);
  return d === 0 ? null : d;
}

// Read the rule state for a date from its tip_sheets row (null = no row yet).
// Older rows have no auto flags (null): an unfrozen one with the tip-out off
// keeps that as a by-hand choice; a frozen one is "legacy" and stands as is.
export function rulesFromRow(row) {
  if (!row) {
    return { expoAsBusser: false, barMode: "auto", barStoredOn: true, closingAuto: true };
  }
  const frozen = isFrozen(row);
  const storedOn = row.bar_tip_out !== false;
  let barMode;
  if (row.bar_tip_out_auto === true) barMode = "auto";
  else if (row.bar_tip_out_auto === false) barMode = "manual";
  else if (frozen) barMode = "legacy";
  else barMode = storedOn ? "auto" : "manual";
  const closingAuto = row.closing_sum_auto === true
    || (row.closing_sum_auto == null && (row.closing_sum === null || row.closing_sum === undefined));
  return { expoAsBusser: row.expo_as_busser === true, barMode, barStoredOn: storedOn, closingAuto };
}

// Columns written for these rules. Effective values are always stored, so a
// sheet that freezes later already holds what it showed.
export function rulesPayload({ expoAsBusser, barMode, barOn, closingAuto, closingSum }) {
  return {
    expo_as_busser: !!expoAsBusser,
    bar_tip_out: !!barOn,
    bar_tip_out_auto: barMode === "auto" ? true : barMode === "manual" ? false : null,
    closing_sum: closingSum,
    closing_sum_auto: !!closingAuto,
  };
}
