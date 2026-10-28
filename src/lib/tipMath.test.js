// Method 1 must stay exactly what every sheet before migration 0025 was paid
// with. REFERENCE below is the arithmetic copied verbatim from src/App.jsx at
// c96ec05 (before it moved to tipMath.js). Every figure the sheet prints must
// match it to the last bit — not "within a cent" — on synthetic sheets that
// exercise each rule, and on thousands of random ones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { calcTips, calcTipsV1, calcTipsV2, calcTipsV3, rowCalcVersion, sheetCalcVersion, tipCalcSupported, TIP_CALC_VERSIONS, CURRENT_TIP_CALC_VERSION } from "./tipMath.js";
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
  assert.deepEqual(TIP_CALC_VERSIONS, [1, 2, 3]);
  assert.equal(CURRENT_TIP_CALC_VERSION, 3);
  assert.equal(rowCalcVersion(null), 1, "no row");
  assert.equal(rowCalcVersion({}), 1, "pre-0025 row (no column)");
  assert.equal(rowCalcVersion({ calc_version: null }), 1, "column, no value");
  assert.equal(rowCalcVersion({ calc_version: 2 }), 2);
  assert.equal(tipCalcSupported(1), true);
  assert.equal(tipCalcSupported(2), true);
  assert.equal(tipCalcSupported(3), true);
  assert.equal(tipCalcSupported(4), false);
  assert.equal(calcTips(2, CASES["full night, bar tip-out on"]).version, 2);
  assert.equal(calcTips(3, CASES["full night, bar tip-out on"]).version, 3);
  assert.equal(calcTips(4, CASES["full night, bar tip-out on"]), null);
  assert.equal(calcTips(null, CASES["full night, bar tip-out on"]), null, "a sheet that didn't load");
});

test("which method a sheet gets", () => {
  // Any saved sheet keeps its own method — including every sheet from before 0025.
  assert.equal(sheetCalcVersion({ loaded: true, row: { date: "x" }, columnPresent: true }), 1, "existing row, no value -> 1, even with the column");
  assert.equal(sheetCalcVersion({ loaded: true, row: { calc_version: null }, columnPresent: true }), 1);
  assert.equal(sheetCalcVersion({ loaded: true, row: { calc_version: 2 }, columnPresent: true }), 2);
  assert.equal(sheetCalcVersion({ loaded: true, row: { calc_version: 2 }, columnPresent: false }), 2, "a stored method is never overridden");
  assert.equal(sheetCalcVersion({ loaded: true, row: { calc_version: 2, sent: true }, columnPresent: true }), 2, "the 27 Oct sheet stays method 2");
  assert.equal(sheetCalcVersion({ loaded: true, row: { calc_version: 3 }, columnPresent: true }), 3);
  // Only a date with NO saved sheet gets the current method (3), and only with the column there.
  assert.equal(sheetCalcVersion({ loaded: true, row: null, columnPresent: true }), 3);
  assert.equal(sheetCalcVersion({ loaded: true, row: null, columnPresent: false }), 1, "no column: methods 2 and 3 unreachable, even for a new sheet");
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

// ---- method 2 is frozen too -------------------------------------------------
// The 27 Oct 2026 sheet was paid with method 2, so method 2 must never move
// either. REFERENCE_V2 is calcTipsV2 copied verbatim from src/lib/tipMath.js at
// c368ebd (deploy B; unchanged through 21dff67). Compared to the last bit.
function REFERENCE_V2({ displaySlots, floorPool, barPool, barTipOutCharged }) {
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

function assertSameV2(got, want, label) {
  assertSameFigures(got, want, label);
  for (const k of ["version", "leftBehind", "leftBehindBound"]) {
    assert.ok(Object.is(got[k], want[k]), `${label}: ${k} ${got[k]} !== ${want[k]}`);
  }
}

test("method 2 = c368ebd arithmetic, every rule", () => {
  for (const [label, input] of Object.entries(CASES)) {
    assertSameV2(calcTipsV2(input), REFERENCE_V2(input), label);
    assertSameV2(calcTips(2, input), REFERENCE_V2(input), `${label} via calcTips(2)`);
  }
});

test("method 2 = c368ebd arithmetic, 5000 random sheets", () => {
  let seed = 20261027;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const cents = (max) => Math.floor(rnd() * max * 100) / 100;
  for (let i = 0; i < 5000; i++) {
    const filled = SLOTS.map((s) => s.id).filter(() => rnd() < 0.75);
    const hours = {};
    const same = rnd() < 0.4 ? Math.round(rnd() * 44) / 4 : null;
    SLOTS.forEach((s) => { hours[s.id] = same ?? Math.round(rnd() * 44) / 4; });
    const input = {
      displaySlots: sheet({ filled, hours, covers: Math.floor(rnd() * 160), expoAsBusser: rnd() < 0.3 }),
      floorPool: cents(6000), barPool: cents(1200), barTipOutCharged: rnd() < 0.7,
    };
    assertSameV2(calcTipsV2(input), REFERENCE_V2(input), `random #${i}`);
  }
});

// ---- method 3 ---------------------------------------------------------------
// The 27 Oct shape: two servers and two Busser/Runners, each pair on equal
// points and 5 hours; Isabella alone on bar.
const OCT27 = {
  displaySlots: [
    { id: "server1", role: "Servers", name: "David", pts: 1, hours: 5 },
    { id: "server2", role: "Servers", name: "Juliette", pts: 1, hours: 5 },
    { id: "busser1", role: "Busser/Runner", name: "Miguel", pts: 0.6, hours: 5 },
    { id: "busser2", role: "Busser/Runner", name: "Emilio", pts: 0.6, hours: 5 },
    { id: "expo", role: "Expo (Fri–Sun)", name: "X", pts: 0.3, hours: 5 },
    { id: "bar1", role: "Bar", name: "Isabella", pts: 0.85, hours: 6.75 },
  ],
  floorPool: 1474.61, barPool: 250.5, barTipOutCharged: true,
};
const slot = (r, id) => r.finalSlots.find((p) => p.id === id);

test("method 3: the 27 Oct shape — equal groups get AMT BY PT, not a cent less", () => {
  const v2 = calcTipsV2(OCT27);
  const v3 = calcTipsV3(OCT27);
  for (const r of [v2, v3]) {
    assert.equal(r.perPoint, 338.99);
    assert.equal(slot(r, "server1").raw, 338.99);
    assert.equal(slot(r, "busser1").raw, 203.39);
    assert.equal(r.barShareEach, 8.35);
    assert.equal(r.serverRate, 67.79, "$/HR still printed as method 2");
    assert.equal(r.bussersRate, 42.34);
  }
  // Method 2 (what the 27th was paid): 5 x 67.79, 5 x 42.34.
  assert.equal(slot(v2, "server1").final, 338.95);
  assert.equal(slot(v2, "busser1").final, 211.7);
  // Method 3.
  assert.deepEqual(v3.uniformGroups, { servers: true, bussers: true, bar: true });
  assert.equal(slot(v3, "server1").final, 338.99);
  assert.equal(slot(v3, "server2").final, 338.99);
  assert.equal(slot(v3, "busser1").final, 211.74);
  assert.equal(slot(v3, "busser2").final, 211.74);
  // Sole bartender: AMT BY PT 288.14 + bar pool 250.50 − Bar Tip-Out 25.05.
  assert.equal(slot(v2, "bar1").final, 513.54, "method 2: 6.75 x trunc(513.59 / 6.75)");
  assert.equal(slot(v3, "bar1").final, 513.59);
  assert.equal(v3.floorCheckMatches, true);
  assert.ok(v3.leftBehind < v2.leftBehind);
});

test("method 3: a swing, or unequal hours, is method 2 unchanged", () => {
  const swing = {
    displaySlots: [
      { id: "server1", role: "Servers", name: "A", pts: 1, hours: 5 },
      { id: "server2", role: "Servers", name: "B", pts: 1, hours: 5 },
      { id: "server3", role: "Servers", name: "C", pts: 0.55, hours: 5 },
      { id: "busser1", role: "Busser/Runner", name: "D", pts: 0.6, hours: 5 },
      { id: "busser2", role: "Busser/Runner", name: "E", pts: 0.6, hours: 4.5 },
      { id: "bar1", role: "Bar", name: "F", pts: 0.85, hours: 7 },
      { id: "bar2", role: "Bar", name: "G", pts: 0.3, hours: 7 },
    ],
    floorPool: 2011.37, barPool: 433.21, barTipOutCharged: true,
  };
  const v2 = calcTipsV2(swing);
  const v3 = calcTipsV3(swing);
  assert.deepEqual(v3.uniformGroups, { servers: false, bussers: false, bar: false });
  const { version: _a, uniformGroups: _u, ...rest3 } = v3;
  const { version: _b, ...rest2 } = v2;
  assert.deepEqual(rest3, rest2, "every figure identical to method 2");
  // The swing on the same hours as a full server gets the same money (by design).
  assert.equal(slot(v3, "server3").final, slot(v3, "server1").final);
});

test("method 3: one person in a group gets the group's whole pool", () => {
  const solo = {
    displaySlots: [
      { id: "server1", role: "Servers", name: "A", pts: 1, hours: 6.25 },
      { id: "busser1", role: "Busser/Runner", name: "B", pts: 0.6, hours: 5.5 },
      { id: "bar1", role: "Bar", name: "Bernie", pts: 0.85, hours: 7.75 },
    ],
    floorPool: 999.99, barPool: 70.07, barTipOutCharged: true,
  };
  const r = calcTipsV3(solo);
  assert.deepEqual(r.uniformGroups, { servers: true, bussers: true, bar: true });
  assert.equal(slot(r, "server1").final, slot(r, "server1").raw);
  assert.equal(slot(r, "busser1").final, sumCents([slot(r, "busser1").raw, r.barShareEach]));
  assert.equal(slot(r, "bar1").final, sumCents([slot(r, "bar1").raw, 70.07, -r.barTipOutTotal]), "AMT BY PT + bar tips − Bar Tip-Out");
});

// The one-pager's hand-check rule, applied to printed figures only: within a
// group, same printed HRS and PTS for everyone -> AMT BY PT (+ share; for a
// bartender, + an even split of bar tips − Bar Tip-Out); otherwise
// trunc(HRS x $/HR). Everything above FINAL TIP is method 2's.
function assertMethod3ByHand(r, input, label) {
  const named = r.finalSlots.filter((p) => p.name);
  const of = (role) => named.filter((p) => p.role === role);
  const printedSame = (ps) => ps.length > 0 && ps.every((p) => p.pts.toFixed(2) === ps[0].pts.toFixed(2) && p.hours.toFixed(2) === ps[0].hours.toFixed(2));
  const same = { Servers: printedSame(of("Servers")), "Busser/Runner": printedSame(of("Busser/Runner")), Bar: printedSame(of("Bar")) };
  assert.deepEqual(r.uniformGroups, { servers: same.Servers, bussers: same["Busser/Runner"], bar: same.Bar }, `${label}: branch readable off the sheet`);
  const barOwnEach = of("Bar").length ? T(sumCents([T(input.barPool), -r.barTipOutTotal]) / of("Bar").length) : 0;
  named.forEach((p) => {
    const want = p.role === "Servers" ? (same.Servers ? p.raw : T(p.hours * r.serverRate))
      : p.role === "Busser/Runner" ? (same["Busser/Runner"] ? sumCents([p.raw, r.barShareEach]) : T(p.hours * r.bussersRate))
      : p.role === "Bar" ? (same.Bar ? sumCents([p.raw, barOwnEach]) : T(p.hours * r.barRate))
      : p.role.startsWith("Expo") ? sumCents([p.raw, r.barShareEach])
      : p.raw;
    assert.equal(p.final, want, `${label}: ${p.id} FINAL from printed figures`);
  });
}

test("method 3: hand-checkable, = method 2 except equal groups, never below it, 5000 random sheets", () => {
  let seed = 20261028;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const cents = (max) => Math.floor(rnd() * max * 100) / 100;
  let uniformSeen = 0;
  for (let i = 0; i < 5000; i++) {
    const filled = SLOTS.map((s) => s.id).filter(() => rnd() < 0.75);
    const hours = {};
    const same = rnd() < 0.4 ? Math.round(rnd() * 44) / 4 : null;
    SLOTS.forEach((s) => { hours[s.id] = same ?? Math.round(rnd() * 44) / 4; });
    const pts = rnd() < 0.2 ? { server3: 1, bar2: 0.85 } : {}; // custom points that make a group equal
    const input = {
      displaySlots: sheet({ filled, hours, pts, covers: Math.floor(rnd() * 160), expoAsBusser: rnd() < 0.3 }),
      floorPool: cents(6000), barPool: cents(1200), barTipOutCharged: rnd() < 0.7,
    };
    const v2 = calcTipsV2(input);
    const v3 = calcTipsV3(input);
    const label = `random #${i}`;
    assertMethod3ByHand(v3, input, label);
    for (const k of ["barTipOutTotal", "totalPoints", "perPoint", "barTipOutRecipients", "barShareEach", "serverRate", "bussersRate", "barRate", "leftBehindBound"]) {
      assert.ok(Object.is(v3[k], v2[k]), `${label}: ${k} same as method 2`);
    }
    const groupOf = { Servers: "servers", "Busser/Runner": "bussers", Bar: "bar" };
    v3.finalSlots.forEach((p, k) => {
      const q = v2.finalSlots[k];
      for (const f of ["id", "name", "pts", "hours", "raw", "barShare"]) assert.ok(Object.is(p[f], q[f]), `${label}: ${p.id}.${f}`);
      if (p.final == null) return assert.equal(q.final, null);
      if (v3.uniformGroups[groupOf[p.role]]) {
        uniformSeen++;
        assert.ok(p.final >= q.final, `${label}: ${p.id} method 3 ${p.final} below method 2 ${q.final}`);
      } else {
        assert.equal(p.final, q.final, `${label}: ${p.id} not in an equal group -> method 2`);
      }
    });
    assert.ok(v3.leftBehind >= 0, `${label}: never pays out more than the floor pool`);
    assert.ok(v3.leftBehind <= v2.leftBehind, `${label}: leaves no more behind than method 2`);
    if (v2.floorCheckMatches) assert.equal(v3.floorCheckMatches, true, `${label}: floor check`);
  }
  assert.ok(uniformSeen > 3000, `equal groups exercised (${uniformSeen})`);
});
