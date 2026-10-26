// The Tip Sheet's arithmetic, by calculation METHOD. A sheet is paid under one
// method and keeps it for good: the arithmetic a sheet was paid with is part of
// its record, not a detail of the code (same discipline as the frozen clock
// parser in tipTimes.js). tip_sheets.calc_version (migration 0025) names the
// method; a row without one is method 1.
//
// Code that opens a sheet stamped with a method it doesn't implement must not
// show figures for it — calcTips returns null and the Tip Sheet refuses
// (reload). Never guess, never fall back to another method.
import { BAR_TIP_OUT_RATE } from "./tipRules.js";

// Methods this build implements.
export const TIP_CALC_VERSIONS = [1];

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
  return null;
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
