// OFFLINE check: has the arithmetic every paid Tip Sheet was calculated with
// ("method 1", src/lib/tipMath.js) moved by so much as a cent?
//
// Compares method 1 in src/lib/tipMath.js with the arithmetic as it stood in
// src/App.jsx at commit c96ec05 (before it was moved out), over every sent /
// locked / finalized sheet in an export of the real data. Pass = every printed
// figure identical on every sheet: $/POINT, AMT BY PT, Bar Tip-Out, each
// recipient's share, all $/HR, every FINAL TIP, total distributed, floor check.
//
// Structurally incapable of writing: it reads one local file and git, and
// talks to nothing — no database, no app, no network.
//
//   1. Run supabase/queries/tip_sheets_frozen_export.sql in the Supabase SQL
//      editor; Export -> Download CSV, saved OUTSIDE the repo.
//   2. npm run tipcheck -- "<path to the CSV>"
//      (or: node tools/tipcheck/check.mjs "<path>")
//   CONTROL=1 nudges the new side by $0.000000001 — every sheet must FAIL,
//   which proves the check can see a change far smaller than a cent.
//
// The reference is read straight out of `git show c96ec05:src/App.jsx` — not a
// hand copy — so "matches the old code" means the code that actually ran.
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
const { calcTipsV1, rowCalcVersion } = await mod("src/lib/tipMath.js");
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
const tally = {};
for (const row of rows) {
  const { slots, source } = slotsFor(row);
  const floorPool = (parseFloat(row.floor_cash) || 0) + (parseFloat(row.floor_credit) || 0);
  const barPool = (parseFloat(row.bar_cash) || 0) + (parseFloat(row.bar_credit) || 0);
  const rules = rulesFromRow(row);
  const barTipOutCharged = barTipOutEffective({ mode: rules.barMode, storedOn: rules.barStoredOn, barPool, frozen: isFrozen(row) });
  const input = { displaySlots: slots, floorPool, barPool, barTipOutCharged };
  // CONTROL=1: nudge the new side by a billionth of a dollar, to prove the
  // check notices a change far smaller than a cent.
  const a = calcTipsV1(process.env.CONTROL ? { ...input, floorPool: floorPool + 1e-9 } : input);
  const b = OLD(slots, floorPool, barPool, barTipOutCharged, BAR_TIP_OUT_RATE);
  const diffs = [];
  for (const k of [...MONEY, ...OTHER]) if (!Object.is(a[k], b[k])) diffs.push(`${k}: ${a[k]} vs ${b[k]}`);
  for (const k of MONEY) if (typeof a[k] === "number" && truncCents(a[k]) !== truncCents(b[k])) diffs.push(`${k} PRINTED: ${truncCents(a[k])} vs ${truncCents(b[k])}`);
  a.finalSlots.forEach((p, i) => {
    const q = b.finalSlots[i];
    for (const k of ["id", "name", "pts", "hours", "raw", "barShare", "final"]) if (!Object.is(p[k], q[k])) diffs.push(`${q.id}.${k}: ${p[k]} vs ${q[k]}`);
    for (const k of ["raw", "barShare", "final"]) {
      if (typeof p[k] === "number" && truncCents(p[k]) !== truncCents(q[k])) diffs.push(`${q.id}.${k} PRINTED: ${truncCents(p[k])} vs ${truncCents(q[k])}`);
    }
  });
  const filled = slots.filter((s) => s.name).length;
  const ok = diffs.length === 0;
  if (!ok) failed++;
  tally[source] = (tally[source] || 0) + 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${row.date}  v${rowCalcVersion(row)}  ${source.padEnd(15)}  ${filled} slots filled`);
  diffs.forEach((d) => console.log(`        ${d}`));
}
console.log(`\n${rows.length} sheets — ${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(", ")}`);
console.log(failed ? `${failed} SHEET(S) DIFFER` : "ZERO DIFFERENCES — every figure on every sheet identical, before and after.");
process.exit(failed ? 1 : 0);
