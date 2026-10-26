// Method 1 must stay exactly what every sheet before migration 0025 was paid
// with. REFERENCE below is the arithmetic copied verbatim from src/App.jsx at
// c96ec05 (before it moved to tipMath.js). Every figure the sheet prints must
// match it to the last bit — not "within a cent" — on synthetic sheets that
// exercise each rule, and on thousands of random ones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { calcTips, calcTipsV1, rowCalcVersion, tipCalcSupported, TIP_CALC_VERSIONS } from "./tipMath.js";
import { BAR_TIP_OUT_RATE, applyExpoMode } from "./tipRules.js";

// ---- c96ec05 src/App.jsx, verbatim (inputs passed in instead of closed over).
function REFERENCE({ displaySlots, floorPool, barPool, barTipOutCharged }) {
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
  const floorCheckTotal = finalSlots.reduce((s, p) => {
    if (!p.name) return s;
    if (p.role === "Bar") return s + (p.raw || 0);
    return s + ((p.final || 0) - (p.barShare || 0));
  }, 0);
  const floorCheckMatches = Math.abs(floorCheckTotal - floorPool) < 0.1;
  return { barTipOutTotal, totalPoints, perPoint, withRaw, barTipOutRecipients, barShareEach, serverRate, bussersRate, barRate, finalSlots, totalDistributed, floorCheckTotal, floorCheckMatches };
}

// The slot table (App.jsx SLOTS at c96ec05).
const SLOTS = [
  { id: "server1", role: "Servers", defaultPts: 1 },
  { id: "server2", role: "Servers", defaultPts: 1 },
  { id: "server3", role: "Servers", defaultPts: 0.55 },
  { id: "busser1", role: "Busser/Runner", defaultPts: 0.6 },
  { id: "busser2", role: "Busser/Runner", defaultPts: 0.6 },
  { id: "expo", role: "Expo (Fri–Sun)", defaultPts: 0.3 },
  { id: "host", role: "Host", defaultPts: 0.1 },
  { id: "bar1", role: "Bar", defaultPts: 0.85 },
  { id: "bar2", role: "Bar", defaultPts: 0.3 },
];

// Every printed figure, compared exactly (Object.is, so -0 / NaN count too).
function assertSameFigures(got, want, label) {
  for (const k of ["barTipOutTotal", "totalPoints", "perPoint", "barTipOutRecipients", "barShareEach", "serverRate", "bussersRate", "barRate", "totalDistributed", "floorCheckTotal", "floorCheckMatches"]) {
    assert.ok(Object.is(got[k], want[k]), `${label}: ${k} ${got[k]} !== ${want[k]}`);
  }
  assert.equal(got.finalSlots.length, want.finalSlots.length, `${label}: slot count`);
  got.finalSlots.forEach((p, i) => {
    const w = want.finalSlots[i];
    for (const k of ["id", "role", "name", "pts", "hours", "raw", "barShare", "final"]) {
      assert.ok(Object.is(p[k], w[k]), `${label}: slot ${w.id} ${k} ${p[k]} !== ${w[k]}`);
    }
  });
}

function sheet({ filled = SLOTS.map((s) => s.id), hours = {}, covers = 100, expoAsBusser = false, pts = {} } = {}) {
  const slots = applyExpoMode(SLOTS.map((s) => ({ ...s })), expoAsBusser);
  return slots.map((s) => {
    const name = filled.includes(s.id) ? `P-${s.id}` : "";
    let p = null;
    if (name) p = pts[s.id] ?? (s.role === "Host" ? (covers > 80 ? s.defaultPts : 0) : s.defaultPts);
    return { ...s, name, pts: p, hours: name ? (hours[s.id] ?? 6.25) : 0 };
  });
}

const CASES = {
  "full night, bar tip-out on": { displaySlots: sheet(), floorPool: 4671.85, barPool: 812.4, barTipOutCharged: true },
  "bar tip-out off": { displaySlots: sheet(), floorPool: 4671.85, barPool: 812.4, barTipOutCharged: false },
  "expo as 3rd busser": { displaySlots: sheet({ expoAsBusser: true }), floorPool: 3990.13, barPool: 640.07, barTipOutCharged: true },
  "host under 80 covers (0 points)": { displaySlots: sheet({ covers: 60 }), floorPool: 2210.5, barPool: 301.1, barTipOutCharged: true },
  "no expo, one busser": { displaySlots: sheet({ filled: ["server1", "server2", "busser1", "bar1"] }), floorPool: 1500.03, barPool: 55.55, barTipOutCharged: false },
  "nobody on bar": { displaySlots: sheet({ filled: ["server1", "server2", "server3", "busser1"] }), floorPool: 1999.99, barPool: 0, barTipOutCharged: true },
  "empty sheet": { displaySlots: sheet({ filled: [] }), floorPool: 0, barPool: 0, barTipOutCharged: true },
  "zero hours on a filled slot": { displaySlots: sheet({ hours: { server1: 0, bar2: 0 } }), floorPool: 3100.17, barPool: 400.4, barTipOutCharged: true },
  "custom points": { displaySlots: sheet({ pts: { server3: 1, bar2: 0.55, host: 0.2 } }), floorPool: 3600, barPool: 512.39, barTipOutCharged: true },
  "4.35-style float noise": { displaySlots: sheet({ hours: { server1: 4.35, server2: 7.15, busser1: 3.05 } }), floorPool: 1234.35, barPool: 99.95, barTipOutCharged: true },
};

test("method 1 = c96ec05 arithmetic, every rule", () => {
  for (const [label, input] of Object.entries(CASES)) {
    assertSameFigures(calcTipsV1(input), REFERENCE(input), label);
    assertSameFigures(calcTips(1, input), REFERENCE(input), `${label} via calcTips(1)`);
  }
});

test("method 1 = c96ec05 arithmetic, 5000 random sheets", () => {
  let seed = 20261026;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const cents = (max) => Math.floor(rnd() * max * 100) / 100;
  for (let i = 0; i < 5000; i++) {
    const filled = SLOTS.map((s) => s.id).filter(() => rnd() < 0.75);
    const hours = {};
    SLOTS.forEach((s) => { hours[s.id] = Math.round(rnd() * 44) / 4; }); // quarter hours, 0–11
    const input = {
      displaySlots: sheet({ filled, hours, covers: Math.floor(rnd() * 160), expoAsBusser: rnd() < 0.3 }),
      floorPool: cents(6000), barPool: cents(1200), barTipOutCharged: rnd() < 0.7,
    };
    assertSameFigures(calcTipsV1(input), REFERENCE(input), `random #${i}`);
  }
});

test("versions: no column / null = method 1; unknown methods give no figures", () => {
  assert.deepEqual(TIP_CALC_VERSIONS, [1]);
  assert.equal(rowCalcVersion(null), 1, "no row");
  assert.equal(rowCalcVersion({}), 1, "pre-0025 row (no column)");
  assert.equal(rowCalcVersion({ calc_version: null }), 1, "column, no value");
  assert.equal(rowCalcVersion({ calc_version: 2 }), 2);
  assert.equal(tipCalcSupported(1), true);
  assert.equal(tipCalcSupported(2), false, "this build doesn't know method 2");
  assert.equal(calcTips(2, CASES["full night, bar tip-out on"]), null);
  assert.equal(calcTips(3, CASES["full night, bar tip-out on"]), null);
  assert.equal(calcTips(null, CASES["full night, bar tip-out on"]), null, "a sheet that didn't load");
});
