// The Tip Sheet's arithmetic, by calculation METHOD. A sheet is paid under one
// method and keeps it for good: the arithmetic a sheet was paid with is part of
// its record, not a detail of the code (same discipline as the frozen clock
// parser in tipTimes.js). tip_sheets.calc_version (migration 0025) names the
// method; a row without one is method 1.
//
// Code that opens a sheet stamped with a method it doesn't implement must not
// show figures for it — calcTips returns null and the Tip Sheet refuses
// (reload). Never guess, never fall back to another method.
import { BAR_TIP_OUT_RATE, truncCents } from "./tipRules.js";

// Methods this build implements, and the one a brand-new sheet gets.
export const TIP_CALC_VERSIONS = [1, 2, 3];
export const CURRENT_TIP_CALC_VERSION = 3;

// The method a stored row was paid under. No column (pre-0025) or no value =
// method 1. Anything else is returned as stored, known or not.
export function rowCalcVersion(row) {
  const v = row?.calc_version;
  return v == null ? 1 : Number(v);
}

export function tipCalcSupported(version) {
  return TIP_CALC_VERSIONS.includes(version);
}

// input: { displaySlots: [{ id, role, name, pts, hours, … }], floorPool,
//          barPool, barTipOutCharged }
// -> every figure the sheet prints, or null for a method this build lacks.
export function calcTips(version, input) {
  if (version === 1) return calcTipsV1(input);
  if (version === 2) return calcTipsV2(input);
  if (version === 3) return calcTipsV3(input);
  return null;
}

// The method a sheet gets: a stored row keeps its own; a date with NO saved
// row gets the current method — but only when the calc_version column is
// known to exist, so it can be stored. Otherwise method 1, even for a new
// sheet: a sheet must never show figures it would reopen without.
// loaded: false when the load failed (-> null, blocked).
export function sheetCalcVersion({ loaded, row, columnPresent }) {
  if (!loaded) return null;
  if (row) return rowCalcVersion(row);
  return columnPresent ? CURRENT_TIP_CALC_VERSION : 1;
}

// ---- METHOD 1 — FROZEN ------------------------------------------------------
// Moved VERBATIM from src/App.jsx at c96ec05 (the inline block after the
// closing-sum rules). Truncates once, at display time (money() in App.jsx);
// every step here carries the full figure. Every sheet saved before migration
// 0025 was paid with this. DO NOT EDIT — not to fix, tidy or "improve" it.
// A different method is a new function and a new version number.
export function calcTipsV1({ displaySlots, floorPool, barPool, barTipOutCharged }) {
  const barTipOutTotal = barTipOutCharged ? barPool * BAR_TIP_OUT_RATE : 0;

  const totalPoints = displaySlots.reduce((s, p) => s + (p.pts || 0), 0);
  const perPoint = totalPoints > 0 ? floorPool / totalPoints : 0;
  const withRaw = displaySlots.map((p) => ({ ...p, raw: (p.pts || 0) * perPoint }));

  const bussers = withRaw.filter((p) => p.role === "Busser/Runner" && p.name);
  const expoSlot = withRaw.find((p) => p.role.startsWith("Expo") && p.name);
  const barTipOutRecipients = bussers.length + (expoSlot ? 1 : 0);
  const barShareEach = barTipOutRecipients > 0 ? barTipOutTotal / barTipOutRecipients : 0;

  const servers = withRaw.filter((p) => p.role === "Servers" && p.name);
  const serverPoolSum = servers.reduce((s, p) => s + p.raw, 0);
  const serverHoursSum = servers.reduce((s, p) => s + p.hours, 0);
  const serverRate = serverHoursSum > 0 ? serverPoolSum / serverHoursSum : 0;

  const bussersPoolSum = bussers.reduce((s, p) => s + p.raw + barShareEach, 0);
  const bussersHoursSum = bussers.reduce((s, p) => s + p.hours, 0);
  const bussersRate = bussersHoursSum > 0 ? bussersPoolSum / bussersHoursSum : 0;

  const barStaff = withRaw.filter((p) => p.role === "Bar" && p.name);
  const barPoolSum = barStaff.reduce((s, p) => s + p.raw, 0) + barPool - barTipOutTotal;
  const barHoursSum = barStaff.reduce((s, p) => s + p.hours, 0);
  const barRate = barHoursSum > 0 ? barPoolSum / barHoursSum : 0;

  const finalSlots = withRaw.map((p) => {
    if (!p.name) return { ...p, barShare: null, final: null };
    if (p.role === "Servers") return { ...p, barShare: 0, final: serverRate * p.hours };
    if (p.role === "Busser/Runner") return { ...p, barShare: barShareEach, final: bussersRate * p.hours };
    if (p.role === "Bar") return { ...p, barShare: 0, final: barRate * p.hours };
    if (p.role.startsWith("Expo")) return { ...p, barShare: barShareEach, final: p.raw + barShareEach };
    return { ...p, barShare: 0, final: p.raw }; // Host — flat, only earns if covers > 80
  });
  const totalDistributed = finalSlots.reduce((s, p) => s + (p.final || 0), 0);
  // Floor check: only money that ORIGINATED from the floor pool. Busser/Runner
  // and Expo bar-tip-out slices are subtracted (that money came from bar), and
  // bartenders count only their floor-pool point share — bar's own cash/CC tips
  // never enter this calculation. Should equal floor cash + CC within ~10¢.
  const floorCheckTotal = finalSlots.reduce((s, p) => {
    if (!p.name) return s;
    if (p.role === "Bar") return s + (p.raw || 0);
    return s + ((p.final || 0) - (p.barShare || 0));
  }, 0);
  const floorCheckMatches = Math.abs(floorCheckTotal - floorPool) < 0.1;

  return {
    version: 1,
    barTipOutTotal, totalPoints, perPoint, withRaw,
    barTipOutRecipients, barShareEach,
    serverRate, bussersRate, barRate,
    finalSlots, totalDistributed, floorCheckTotal, floorCheckMatches,
  };
}

// ---- METHOD 2 — FROZEN ------------------------------------------------------
// Shipped in deploy B (c368ebd, unchanged through 21dff67). Sheets created from
// 27 Oct 2026 until method 3 shipped were paid with this — possibly only the
// 27 Oct sheet. DO NOT EDIT — not to fix, tidy or "improve" it. A different
// method is a new function and a new version number (method 3 is the fix for
// the cents this shaves off equal groups).
//
// Owner, 2026-10-26: "a sheet whose own printed numbers add up". Every printed
// figure truncates to the cent, and every step is computed from the PRINTED
// (truncated) figure above it, so anyone holding the paper sheet can reproduce
// it with a calculator:
//   1. $ / POINT        = trunc(floor pool ÷ total points)
//   2. AMT BY PT        = trunc(points × printed $ / POINT)
//   3. Bar Tip-Out      = trunc(bar pool × 10%)
//      Each Recipient   = trunc(printed Bar Tip-Out ÷ recipients)
//   4. each role's pool = sum of its printed AMT BY PT (+ printed shares for
//      Busser/Runners; + bar pool − printed Bar Tip-Out for Bar)
//      $ / HR           = trunc(that pool ÷ the role's hours)
//   5. FINAL TIP        = trunc(hours × printed $ / HR); Expo = printed AMT BY
//      PT + printed share; Host = printed AMT BY PT
// Truncating never rounds up, so whatever is left over stays with the house —
// printed as "Left behind" on every method-2 sheet, $0.00 included.
// All money is carried in whole cents inside, so sums can't pick up float noise.
export function calcTipsV2({ displaySlots, floorPool, barPool, barTipOutCharged }) {
  const c = (dollars) => truncCents(dollars); // dollars -> whole cents, truncated
  const $ = (cents) => cents / 100;
  const floorPoolC = c(floorPool);
  const barPoolC = c(barPool);

  const barTipOutC = barTipOutCharged ? c($(barPoolC) * BAR_TIP_OUT_RATE) : 0;

  const totalPoints = displaySlots.reduce((s, p) => s + (p.pts || 0), 0);
  const perPointC = totalPoints > 0 ? c($(floorPoolC) / totalPoints) : 0;
  const withRawC = displaySlots.map((p) => ({ ...p, rawC: c((p.pts || 0) * $(perPointC)) }));

  const bussers = withRawC.filter((p) => p.role === "Busser/Runner" && p.name);
  const expoSlot = withRawC.find((p) => p.role.startsWith("Expo") && p.name);
  const barTipOutRecipients = bussers.length + (expoSlot ? 1 : 0);
  const barShareC = barTipOutRecipients > 0 ? c($(barTipOutC) / barTipOutRecipients) : 0;

  const rateC = (poolC, hours) => (hours > 0 ? c($(poolC) / hours) : 0);
  const servers = withRawC.filter((p) => p.role === "Servers" && p.name);
  const serverHoursSum = servers.reduce((s, p) => s + p.hours, 0);
  const serverRateC = rateC(servers.reduce((s, p) => s + p.rawC, 0), serverHoursSum);

  const bussersHoursSum = bussers.reduce((s, p) => s + p.hours, 0);
  const bussersRateC = rateC(bussers.reduce((s, p) => s + p.rawC + barShareC, 0), bussersHoursSum);

  const barStaff = withRawC.filter((p) => p.role === "Bar" && p.name);
  const barHoursSum = barStaff.reduce((s, p) => s + p.hours, 0);
  const barRateC = rateC(barStaff.reduce((s, p) => s + p.rawC, 0) + barPoolC - barTipOutC, barHoursSum);

  const finalSlots = withRawC.map(({ rawC, ...p }) => {
    const raw = $(rawC);
    if (!p.name) return { ...p, raw, barShare: null, final: null };
    if (p.role === "Servers") return { ...p, raw, barShare: 0, final: $(c(p.hours * $(serverRateC))) };
    if (p.role === "Busser/Runner") return { ...p, raw, barShare: $(barShareC), final: $(c(p.hours * $(bussersRateC))) };
    if (p.role === "Bar") return { ...p, raw, barShare: 0, final: $(c(p.hours * $(barRateC))) };
    if (p.role.startsWith("Expo")) return { ...p, raw, barShare: $(barShareC), final: $(rawC + barShareC) };
    return { ...p, raw, barShare: 0, final: raw }; // Host — flat, only earns if covers > 80
  });
  const totalDistributedC = finalSlots.reduce((s, p) => s + (p.final == null ? 0 : c(p.final)), 0);

  // Floor check — same money as method 1 (what ORIGINATED in the floor pool:
  // finals minus bar-tip-out shares; bartenders' AMT BY PT only).
  const floorCheckTotalC = finalSlots.reduce((s, p) => {
    if (!p.name) return s;
    if (p.role === "Bar") return s + c(p.raw || 0);
    return s + c(p.final || 0) - c(p.barShare || 0);
  }, 0);
  const leftBehindC = floorPoolC - floorCheckTotalC;
  // What truncation alone can leave behind, at most, in whole cents: under 1¢
  // per point at $/POINT, per filled slot at AMT BY PT, per hour at each $/HR
  // (servers, bussers), per hourly-paid person at FINAL TIP. Passes when the
  // total is at or under the pool and within that — anything more is a real
  // error, not truncation.
  const filled = withRawC.filter((p) => p.name).length;
  const leftBehindBoundC =
    Math.ceil(totalPoints) + filled + Math.ceil(serverHoursSum + bussersHoursSum) + servers.length + bussers.length;
  const floorCheckMatches = leftBehindC >= 0 && leftBehindC <= leftBehindBoundC;

  return {
    version: 2,
    barTipOutTotal: $(barTipOutC), totalPoints, perPoint: $(perPointC),
    withRaw: finalSlots.map(({ barShare, final, ...p }) => p),
    barTipOutRecipients, barShareEach: $(barShareC),
    serverRate: $(serverRateC), bussersRate: $(bussersRateC), barRate: $(barRateC),
    finalSlots, totalDistributed: $(totalDistributedC),
    floorCheckTotal: $(floorCheckTotalC), floorCheckMatches,
    leftBehind: $(leftBehindC), leftBehindBound: $(leftBehindBoundC),
  };
}

// ---- METHOD 3 ---------------------------------------------------------------
// Owner, 2026-10-28: method 2, except the $/HR step is skipped for an hourly
// group (Servers, Busser/Runners, Bar) where it can't do anything. When every
// member of the group has the same PTS and the same HRS, pool ÷ hours × hours
// can't move money between them; it can only shave cents off everyone (27 Oct:
// AMT BY PT 338.99, FINAL 338.95). So for such a group:
//   Servers         FINAL TIP = printed AMT BY PT
//   Busser/Runners  FINAL TIP = printed AMT BY PT + printed share
//   Bar             FINAL TIP = printed AMT BY PT
//                               + trunc((bar pool − printed Bar Tip-Out) ÷ bartenders)
// (each = trunc(group pool ÷ people in it); a sole bartender gets the whole bar
// pool). A group with any difference — a swing's points, or unequal hours —
// is paid exactly as method 2. HRS and PTS are both printed, so the sheet
// shows which applies. Everything else, and $/HR as printed, is method 2's.
export function calcTipsV3({ displaySlots, floorPool, barPool, barTipOutCharged }) {
  const c = (dollars) => truncCents(dollars); // dollars -> whole cents, truncated
  const $ = (cents) => cents / 100;
  const floorPoolC = c(floorPool);
  const barPoolC = c(barPool);

  const barTipOutC = barTipOutCharged ? c($(barPoolC) * BAR_TIP_OUT_RATE) : 0;

  const totalPoints = displaySlots.reduce((s, p) => s + (p.pts || 0), 0);
  const perPointC = totalPoints > 0 ? c($(floorPoolC) / totalPoints) : 0;
  const withRawC = displaySlots.map((p) => ({ ...p, rawC: c((p.pts || 0) * $(perPointC)) }));

  const bussers = withRawC.filter((p) => p.role === "Busser/Runner" && p.name);
  const expoSlot = withRawC.find((p) => p.role.startsWith("Expo") && p.name);
  const barTipOutRecipients = bussers.length + (expoSlot ? 1 : 0);
  const barShareC = barTipOutRecipients > 0 ? c($(barTipOutC) / barTipOutRecipients) : 0;

  const rateC = (poolC, hours) => (hours > 0 ? c($(poolC) / hours) : 0);
  const servers = withRawC.filter((p) => p.role === "Servers" && p.name);
  const serverHoursSum = servers.reduce((s, p) => s + p.hours, 0);
  const serverRateC = rateC(servers.reduce((s, p) => s + p.rawC, 0), serverHoursSum);

  const bussersHoursSum = bussers.reduce((s, p) => s + p.hours, 0);
  const bussersRateC = rateC(bussers.reduce((s, p) => s + p.rawC + barShareC, 0), bussersHoursSum);

  const barStaff = withRawC.filter((p) => p.role === "Bar" && p.name);
  const barHoursSum = barStaff.reduce((s, p) => s + p.hours, 0);
  const barOwnC = barPoolC - barTipOutC; // the bar's own tips, after the tip-out
  const barRateC = rateC(barStaff.reduce((s, p) => s + p.rawC, 0) + barOwnC, barHoursSum);

  // Same PTS and same HRS for everyone in the group (one person counts).
  const uniform = (ps) => ps.length > 0 && ps.every((p) => p.pts === ps[0].pts && p.hours === ps[0].hours);
  const uniformGroups = { servers: uniform(servers), bussers: uniform(bussers), bar: uniform(barStaff) };
  const barOwnEachC = barStaff.length > 0 ? c($(barOwnC) / barStaff.length) : 0;

  const finalSlots = withRawC.map(({ rawC, ...p }) => {
    const raw = $(rawC);
    if (!p.name) return { ...p, raw, barShare: null, final: null };
    if (p.role === "Servers") {
      return { ...p, raw, barShare: 0, final: uniformGroups.servers ? raw : $(c(p.hours * $(serverRateC))) };
    }
    if (p.role === "Busser/Runner") {
      return { ...p, raw, barShare: $(barShareC), final: uniformGroups.bussers ? $(rawC + barShareC) : $(c(p.hours * $(bussersRateC))) };
    }
    if (p.role === "Bar") {
      return { ...p, raw, barShare: 0, final: uniformGroups.bar ? $(rawC + barOwnEachC) : $(c(p.hours * $(barRateC))) };
    }
    if (p.role.startsWith("Expo")) return { ...p, raw, barShare: $(barShareC), final: $(rawC + barShareC) };
    return { ...p, raw, barShare: 0, final: raw }; // Host — flat, only earns if covers > 80
  });
  const totalDistributedC = finalSlots.reduce((s, p) => s + (p.final == null ? 0 : c(p.final)), 0);

  // Floor check — as method 2. A uniform group truncates less than method 2
  // would, so method 2's bound on what truncation can leave still holds.
  const floorCheckTotalC = finalSlots.reduce((s, p) => {
    if (!p.name) return s;
    if (p.role === "Bar") return s + c(p.raw || 0);
    return s + c(p.final || 0) - c(p.barShare || 0);
  }, 0);
  const leftBehindC = floorPoolC - floorCheckTotalC;
  const filled = withRawC.filter((p) => p.name).length;
  const leftBehindBoundC =
    Math.ceil(totalPoints) + filled + Math.ceil(serverHoursSum + bussersHoursSum) + servers.length + bussers.length;
  const floorCheckMatches = leftBehindC >= 0 && leftBehindC <= leftBehindBoundC;

  return {
    version: 3,
    barTipOutTotal: $(barTipOutC), totalPoints, perPoint: $(perPointC),
    withRaw: finalSlots.map(({ barShare, final, ...p }) => p),
    barTipOutRecipients, barShareEach: $(barShareC),
    serverRate: $(serverRateC), bussersRate: $(bussersRateC), barRate: $(barRateC),
    uniformGroups,
    finalSlots, totalDistributed: $(totalDistributedC),
    floorCheckTotal: $(floorCheckTotalC), floorCheckMatches,
    leftBehind: $(leftBehindC), leftBehindBound: $(leftBehindBoundC),
  };
}
