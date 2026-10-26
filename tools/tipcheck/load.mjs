// Reads the owner's export of frozen Tip Sheets: the CSV the Supabase SQL
// editor downloads for supabase/queries/tip_sheets_frozen_export.sql (a
// "json_agg" header and one quoted cell holding the JSON array of rows).
// Read-only. The export holds real payroll data: keep it OUTSIDE the repo
// (.gitignore refuses *.csv as a backstop).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function loadExport(path) {
  const raw = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const nl = raw.indexOf("\n");
  const header = raw.slice(0, nl).trim();
  let cell = raw.slice(nl + 1).trim();
  if (cell.startsWith('"') && cell.endsWith('"')) cell = cell.slice(1, -1).replace(/""/g, '"');
  const rows = JSON.parse(cell);
  if (!Array.isArray(rows)) throw new Error("export isn't a JSON array of tip_sheets rows");
  return { header, rows };
}

// Run directly: print the export's shape only — never figures or names.
//   node tools/tipcheck/load.mjs "<export.csv>"
if (import.meta.url === pathToFileURL(process.argv[1] || "").href && process.argv[2]) {
  const { header, rows } = loadExport(process.argv[2]);
  console.log("header:", header);
  console.log("rows:", rows.length, "dates:", rows[0]?.date, "→", rows[rows.length - 1]?.date);
  console.log("sent / locked / finalized:", rows.filter((r) => r.sent).length, rows.filter((r) => r.locked).length, rows.filter((r) => r.finalized).length);
  console.log("with roster_snapshot:", rows.filter((r) => r.roster_snapshot && Object.keys(r.roster_snapshot).length).length);
  console.log("columns:", [...new Set(rows.flatMap((r) => Object.keys(r)))].sort().join(", "));
}
