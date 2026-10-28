// OFFLINE check: has the arithmetic any paid Tip Sheet was calculated with
// (its frozen method in src/lib/tipMath.js) moved by so much as a cent?
//
// Each sent / locked / finalized sheet in an export of the real data is checked
// against the code its method actually ran as:
//   method 1 (no calc_version) — the arithmetic in src/App.jsx at c96ec05,
//                                before it was moved out
//   method 2                   — calcTipsV2 in src/lib/tipMath.js at c368ebd
//                                (deploy B; unchanged through 21dff67)
//   method 3                   — not frozen yet: listed, not checked
// Pass = every printed figure identical on every sheet: $/POINT, AMT BY PT, Bar
// Tip-Out, each recipient's share, all $/HR, every FINAL TIP, total
// distributed, floor check (and, for method 2, Left behind).
//
// Structurally incapable of writing: it reads one local file and git, and
// talks to nothing — no database, no app, no network.
//
//   1. Run supabase/queries/tip_sheets_frozen_export.sql in the Supabase SQL
//      editor; Export -> Download CSV, saved OUTSIDE the repo.
//   2. npm run tipcheck -- "<path to the CSV>"
//      (or: node tools/tipcheck/check.mjs "<path>")
//   CONTROL=1 nudges the new side's floor pool (method 1: by $0.000000001;
//   method 2, which truncates its inputs to the cent: by $1) — every checked
//   sheet must FAIL, which proves the check can see a change.
//
// The references are read straight out of git (`git show c96ec05:src/App.jsx`,
// `git show c368ebd:src/lib/tipMath.js`) — not hand copies — so "matches the
// old code" means the code that actually ran.
// Sheets frozen before migration 0023 have no stored roster; their filled
// slots are worked out from the clock times (marked "worked out").
// Prints a PASS / FAIL line per sheet; money only appears for a difference.
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadExport } from "./load.mjs";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const mod = (p) => import(pathToFileURL(`${REPO}/${p}`).href);
if (!process.argv[2]) {
  console.error('usage: npm run tipcheck -- "<path to the export CSV>"');
  process.exit(2);
}
const { calcTipsV1, calcTipsV2, rowCalcVersion } = await mod("src/lib/tipMath.js");
const { BAR_TIP_OUT_RATE, applyExpoMode, pinnedSlot, rulesFromRow, barTipOutEffective, isFrozen, truncCents } = await mod("src/lib/tipRules.js");
const { hoursBetween } = await mod("src/lib/tipTimes.js");

// ---- the c96ec05 code ---------------------------------------------------------
const old = execSync("git show c96ec05:src/App.jsx", { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).replace(/\r\n/g, "\n");
const grab = (start, end) => {
  const a = old.indexOf(start);
  const b = old.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error(`c96ec05: couldn't find ${start.slice(0, 40)}`);
  return old.slice(a, b + end.length);
};
const barLine = grab("const barTipOutTotal = barTipOutCharged ? barPool * BAR_TIP_OUT_RATE : 0;", ";");
const block = grab("const totalPoints = displaySlots.reduce", "const floorCheckMatches = Math.abs(floorCheckTotal - floorPool) < 0.1;");
const OLD = new Function("displaySlots", "floorPool", "barPool", "barTipOutCharged", "BAR_TIP_OUT_RATE",
  `${barLine}\n${block}\nreturn { barTipOutTotal, totalPoints, perPoint, barTipOutRecipients, barShareEach, serverRate, bussersRate, barRate, finalSlots, totalDistributed, floorCheckTotal, floorCheckMatches };`);
const SLOTS = new Function(`return ${grab("const SLOTS = [", "];").replace(/^const SLOTS = /, "").replace(/;$/, "")};`)();

// ---- the c368ebd code (method 2) ------------------------------------------------
const v2src = execSync("git show c368ebd:src/lib/tipMath.js", { cwd: REPO, encoding: "utf8" }).replace(/\r\n/g, "\n");
const v2a = v2src.indexOf("export function calcTipsV2(");
const v2b = v2src.indexOf("\n}\n", v2a);
if (v2a < 0 || v2b < 0) throw new Error("c368ebd: couldn't find calcTipsV2");
const OLD_V2 = new Function("BAR_TIP_OUT_RATE", "truncCents",
  `${v2src.slice(v2a, v2b + 3).replace(/^export /, "")}\nreturn calcTipsV2;`)(BAR_TIP_OUT_RATE, truncCents);

// ---- one stored row -> the slots the sheet computes from -----------------------
// Same order of precedence as App.jsx (displaySlots): pinned roster on a frozen
// sheet; else Custom Schedule entries; else the schedule — which this check
// can't see, so a slot counts as filled if it has clock times ("worked out").
function slotsFor(row) {
  const covers = parseFloat(row.covers) || 0;
  const slots = applyExpoMode(SLOTS.map((s) => ({ ...s })), !!row.expo_as_busser);
  const times = row.time_entries || {};
  const snap = row.roster_snapshot && Object.keys(row.roster_snapshot).length ? row.roster_snapshot : null;
  const custom = row.slot_overrides && Object.keys(row.slot_overrides).length ? row.slot_overrides : null;
  const pinned = !!snap && isFrozen(row);
  const source = pinned ? "stored roster" : custom ? "custom schedule" : "worked out";
  const out = slots.map((slot) => {
    const t = times[slot.id] || { in: "", out: "" };
    const hours = hoursBetween(t.in, t.out);
    if (pinned) {
      const pin = pinnedSlot(snap, slot.id) || { name: "", pts: null };
      return { ...slot, name: pin.name, pts: pin.pts, hours };
    }
    const ov = custom?.[slot.id];
    let name = custom && ov?.name !== undefined ? ov.name : (String(t.in || "").trim() || String(t.out || "").trim() ? `(${slot.id})` : "");
    let pts = null;
    if (name) {
      pts = slot.role === "Host" ? (covers > 80 ? slot.defaultPts : 0) : slot.defaultPts;
      if (custom && ov?.pts !== undefined) pts = ov.pts;
    }
    return { ...slot, name, pts, hours };
  });
  return { slots: out, source };
}

// ---- compare ------------------------------------------------------------------
const { rows } = loadExport(process.argv[2]);
const MONEY = ["barTipOutTotal", "perPoint", "barShareEach", "serverRate", "bussersRate", "barRate", "totalDistributed", "floorCheckTotal"];
const OTHER = ["totalPoints", "barTipOutRecipients", "floorCheckMatches"];
let failed = 0;
let unchecked = 0;
const tally = {};
const byMethod = {};
for (const row of rows) {
  const version = rowCalcVersion(row);
  const { slots, source } = slotsFor(row);
  const filled = slots.filter((s) => s.name).length;
  byMethod[version] = (byMethod[version] || 0) + 1;
  if (version !== 1 && version !== 2) {
    unchecked++;
    console.log(`----  ${row.date}  v${version}  ${source.padEnd(15)}  ${filled} slots filled  (method ${version} isn't frozen yet: not checked)`);
    continue;
  }
  const floorPool = (parseFloat(row.floor_cash) || 0) + (parseFloat(row.floor_credit) || 0);
  const barPool = (parseFloat(row.bar_cash) || 0) + (parseFloat(row.bar_credit) || 0);
  const rules = rulesFromRow(row);
  const barTipOutCharged = barTipOutEffective({ mode: rules.barMode, storedOn: rules.barStoredOn, barPool, frozen: isFrozen(row) });
  const input = { displaySlots: slots, floorPool, barPool, barTipOutCharged };
  // CONTROL=1: nudge the new side by a billionth of a dollar, to prove the
  // check notices a change far smaller than a cent.
  // (Method 2 truncates its inputs to the cent, so its nudge is $1: always moves $/POINT.)
  const nudged = process.env.CONTROL ? { ...input, floorPool: floorPool + (version === 1 ? 1e-9 : 1) } : input;
  const a = version === 1 ? calcTipsV1(nudged) : calcTipsV2(nudged);
  const b = version === 1 ? OLD(slots, floorPool, barPool, barTipOutCharged, BAR_TIP_OUT_RATE) : OLD_V2(input);
  const diffs = [];
  const keys = version === 1 ? [...MONEY, ...OTHER] : [...MONEY, ...OTHER, "version", "leftBehind", "leftBehindBound"];
  for (const k of keys) if (!Object.is(a[k], b[k])) diffs.push(`${k}: ${a[k]} vs ${b[k]}`);
  for (const k of MONEY) if (typeof a[k] === "number" && truncCents(a[k]) !== truncCents(b[k])) diffs.push(`${k} PRINTED: ${truncCents(a[k])} vs ${truncCents(b[k])}`);
  a.finalSlots.forEach((p, i) => {
    const q = b.finalSlots[i];
    for (const k of ["id", "name", "pts", "hours", "raw", "barShare", "final"]) if (!Object.is(p[k], q[k])) diffs.push(`${q.id}.${k}: ${p[k]} vs ${q[k]}`);
    for (const k of ["raw", "barShare", "final"]) {
      if (typeof p[k] === "number" && truncCents(p[k]) !== truncCents(q[k])) diffs.push(`${q.id}.${k} PRINTED: ${truncCents(p[k])} vs ${truncCents(q[k])}`);
    }
  });
  const ok = diffs.length === 0;
  if (!ok) failed++;
  tally[source] = (tally[source] || 0) + 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${row.date}  v${version}  ${source.padEnd(15)}  ${filled} slots filled`);
  diffs.forEach((d) => console.log(`        ${d}`));
}
console.log(`\n${rows.length} sheets — ${Object.entries(byMethod).map(([k, v]) => `${v} method ${k}`).join(", ")}`);
console.log(`checked: ${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(", ") || "none"}${unchecked ? `; ${unchecked} not checked (method not frozen yet)` : ""}`);
console.log(failed ? `${failed} SHEET(S) DIFFER` : "ZERO DIFFERENCES — every figure on every checked sheet identical, before and after.");
process.exit(failed ? 1 : 0);
