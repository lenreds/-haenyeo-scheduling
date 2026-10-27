// Method 1 must stay exactly what every sheet before migration 0025 was paid
// with. REFERENCE below is the arithmetic copied verbatim from src/App.jsx at
// c96ec05 (before it moved to tipMath.js). Every figure the sheet prints must
// match it to the last bit — not "within a cent" — on synthetic sheets that
// exercise each rule, and on thousands of random ones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { calcTips, calcTipsV1, calcTipsV2, rowCalcVersion, sheetCalcVersion, tipCalcSupported, TIP_CALC_VERSIONS, CURRENT_TIP_CALC_VERSION } from "./tipMath.js";
import { BAR_TIP_OUT_RATE, applyExpoMode, truncCents } from "./tipRules.js";

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
  assert.deepEqual(TIP_CALC_VERSIONS, [1, 2]);
  assert.equal(CURRENT_TIP_CALC_VERSION, 2);
  assert.equal(rowCalcVersion(null), 1, "no row");
  assert.equal(rowCalcVersion({}), 1, "pre-0025 row (no column)");
  assert.equal(rowCalcVersion({ calc_version: null }), 1, "column, no value");
  assert.equal(rowCalcVersion({ calc_version: 2 }), 2);
  assert.equal(tipCalcSupported(1), true);
  assert.equal(tipCalcSupported(2), true);
  assert.equal(tipCalcSupported(3), false);
  assert.equal(calcTips(2, CASES["full night, bar tip-out on"]).version, 2);
  assert.equal(calcTips(3, CASES["full night, bar tip-out on"]), null);
  assert.equal(calcTips(null, CASES["full night, bar tip-out on"]), null, "a sheet that didn't load");
});

test("which method a sheet gets", () => {
  // Any saved sheet keeps its own method — including every sheet from before 0025.
  assert.equal(sheetCalcVersion({ loaded: true, row: { date: "x" }, columnPresent: true }), 1, "existing row, no value -> 1, even with the column");
  assert.equal(sheetCalcVersion({ loaded: true, row: { calc_version: null }, columnPresent: true }), 1);
  assert.equal(sheetCalcVersion({ loaded: true, row: { calc_version: 2 }, columnPresent: true }), 2);
  assert.equal(sheetCalcVersion({ loaded: true, row: { calc_version: 2 }, columnPresent: false }), 2, "a stored method is never overridden");
  // Only a date with NO saved sheet gets method 2, and only with the column there.
  assert.equal(sheetCalcVersion({ loaded: true, row: null, columnPresent: true }), 2);
  assert.equal(sheetCalcVersion({ loaded: true, row: null, columnPresent: false }), 1, "no column: method 2 unreachable, even for a new sheet");
  // A failed load is not "no sheet".
  assert.equal(sheetCalcVersion({ loaded: false, row: null, columnPresent: true }), null);
});

// ---- method 2 ---------------------------------------------------------------
const isCents = (n) => Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
const T = (n) => truncCents(n) / 100;
const sumCents = (xs) => xs.reduce((s, x) => s + Math.round(x * 100), 0) / 100;

// Every printed figure follows from the printed figure above it.
function assertReproducibleByHand(r, input, label, { payable = true } = {}) {
  const { floorPool, barPool, barTipOutCharged } = input;
  for (const k of ["perPoint", "barTipOutTotal", "barShareEach", "serverRate", "bussersRate", "barRate", "totalDistributed", "floorCheckTotal", "leftBehind"]) {
    assert.ok(isCents(r[k]), `${label}: ${k} ${r[k]} isn't whole cents`);
  }
  assert.equal(r.perPoint, r.totalPoints > 0 ? T(T(floorPool) / r.totalPoints) : 0, `${label}: $/POINT`);
  assert.equal(r.barTipOutTotal, barTipOutCharged ? T(T(barPool) * BAR_TIP_OUT_RATE) : 0, `${label}: Bar Tip-Out`);
  assert.equal(r.barShareEach, r.barTipOutRecipients > 0 ? T(r.barTipOutTotal / r.barTipOutRecipients) : 0, `${label}: each recipient`);
  const named = r.finalSlots.filter((p) => p.name);
  r.finalSlots.forEach((p) => {
    assert.ok(isCents(p.raw), `${label}: ${p.id} AMT BY PT`);
    assert.equal(p.raw, T((p.pts || 0) * r.perPoint), `${label}: ${p.id} AMT BY PT = trunc(points x printed $/POINT)`);
  });
  const rate = (pool, hrs) => (hrs > 0 ? T(pool / hrs) : 0);
  const of = (role) => named.filter((p) => p.role === role);
  const hrs = (ps) => ps.reduce((s, p) => s + p.hours, 0);
  assert.equal(r.serverRate, rate(sumCents(of("Servers").map((p) => p.raw)), hrs(of("Servers"))), `${label}: server $/HR`);
  assert.equal(r.bussersRate, rate(sumCents(of("Busser/Runner").flatMap((p) => [p.raw, r.barShareEach])), hrs(of("Busser/Runner"))), `${label}: busser $/HR`);
  assert.equal(r.barRate, rate(sumCents([...of("Bar").map((p) => p.raw), T(barPool), -r.barTipOutTotal]), hrs(of("Bar"))), `${label}: bar $/HR`);
  named.forEach((p) => {
    assert.ok(isCents(p.final), `${label}: ${p.id} FINAL`);
    const want = p.role === "Servers" ? T(p.hours * r.serverRate)
      : p.role === "Busser/Runner" ? T(p.hours * r.bussersRate)
      : p.role === "Bar" ? T(p.hours * r.barRate)
      : p.role.startsWith("Expo") ? sumCents([p.raw, r.barShareEach])
      : p.raw;
    assert.equal(p.final, want, `${label}: ${p.id} FINAL from printed figures`);
  });
  assert.ok(r.leftBehind >= 0, `${label}: never pays out more than the floor pool (left behind ${r.leftBehind})`);
  // payable: every filled hourly group (Servers, Busser/Runner, Bar) has hours,
  // so only truncation can leave floor money behind. A group on 0 hours leaves
  // its whole pool unpaid, and the check must then say so.
  if (payable) {
    assert.ok(r.leftBehind <= r.leftBehindBound + 1e-9, `${label}: left behind ${r.leftBehind} within truncation bound ${r.leftBehindBound}`);
    assert.equal(r.floorCheckMatches, true, `${label}: floor check passes on an honest sheet`);
  }
}

test("method 2: every printed figure reproducible by hand, every rule", () => {
  for (const [label, input] of Object.entries(CASES)) assertReproducibleByHand(calcTipsV2(input), input, label);
});

test("method 2: reproducible by hand, never above method 1, 5000 random sheets", () => {
  let seed = 4242;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const cents = (max) => Math.floor(rnd() * max * 100) / 100;
  for (let i = 0; i < 5000; i++) {
    const filled = SLOTS.map((s) => s.id).filter(() => rnd() < 0.75);
    const hours = {};
    SLOTS.forEach((s) => { hours[s.id] = Math.round(rnd() * 44) / 4; });
    const input = {
      displaySlots: sheet({ filled, hours, covers: Math.floor(rnd() * 160), expoAsBusser: rnd() < 0.3 }),
      floorPool: cents(6000), barPool: cents(1200), barTipOutCharged: rnd() < 0.7,
    };
    const v2 = calcTipsV2(input);
    const v1 = calcTipsV1(input);
    const named = input.displaySlots.filter((p) => p.name && (p.pts || 0) > 0);
    const payable = ["Servers", "Busser/Runner", "Bar"].every((role) => {
      const ps = named.filter((p) => p.role === role);
      return ps.length === 0 || ps.reduce((s, p) => s + p.hours, 0) > 0;
    });
    assertReproducibleByHand(v2, input, `random #${i}`, { payable });
    v2.finalSlots.forEach((p, k) => {
      if (p.final == null) return;
      // Bar may keep up to 1¢ more: Bar Tip-Out is truncated before it leaves
      // the bar pool, so the fraction method 1 passed on stays with the bar.
      const slack = p.role === "Bar" ? 0.01 : 0;
      assert.ok(p.final <= T(v1.finalSlots[k].final) + slack + 1e-9, `random #${i}: ${p.id} method 2 ${p.final} above method 1 ${T(v1.finalSlots[k].final)}`);
    });
  }
});

test("method 2: truncate $/HR before multiplying (the 15 Oct busser shape)", () => {
  // Two Busser/Runners on 5 hours, AMT BY PT 121.81 each, bar share 3.75 each:
  // pool 251.12 / 10 hrs -> $/HR 25.11 -> 5 x 25.11 = 125.55 each.
  const slots = [
    { id: "server1", role: "Servers", name: "A", pts: 1, hours: 6 },
    { id: "server2", role: "Servers", name: "B", pts: 1, hours: 6 },
    { id: "busser1", role: "Busser/Runner", name: "C", pts: 0.6, hours: 5 },
    { id: "busser2", role: "Busser/Runner", name: "D", pts: 0.6, hours: 5 },
    { id: "bar1", role: "Bar", name: "E", pts: 1, hours: 8 },
  ];
  const r = calcTipsV2({ displaySlots: slots, floorPool: 852.69, barPool: 75, barTipOutCharged: true });
  assert.equal(r.perPoint, 203.02); // 852.69 / 4.2 = 203.0214…
  assert.equal(r.barTipOutTotal, 7.5);
  assert.equal(r.barShareEach, 3.75);
  const c = r.finalSlots.find((p) => p.id === "busser1");
  assert.equal(c.raw, 121.81);
  assert.equal(r.bussersRate, 25.11);
  assert.equal(c.final, 125.55);
});
