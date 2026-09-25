import React, { useState, useMemo, useEffect, useRef } from "react";
import { Check, X, AlertTriangle, Users, Package, Clock, ChevronLeft, ChevronRight, Printer, FileDown, Calendar, CalendarDays, StickyNote, Receipt, Lock, Unlock, LogOut } from "lucide-react";
import {
  fetchInitial,
  fetchRailRequests,
  updateRailStatus,
  upsertScheduleOverride,
  sendRailReply,
  fetchTipSheet,
  upsertTipSheet,
  insertStaff,
  updateStaff,
  replaceStaffRoles,
  deleteStaff,
  fetchGmailStatus,
  triggerGmailPoll,
  fetchInfoUpdates,
  approveInfoUpdate,
  denyInfoUpdate,
  triggerSchedulePublish,
  triggerTipSheetSend,
  submitManualRail,
  fetchWeeklySchedule,
  fetchWeeklyPlaceholders,
  upsertWeeklyShift,
  upsertWeeklyPlaceholder,
  seedWeeklySchedule,
  seedWeeklyPlaceholders,
  fetchScheduleNotes,
  insertScheduleNote,
  updateScheduleNote,
  deleteScheduleNote,
  notesTableAvailable,
  fetchScheduleWeeks,
  setWeekFinalized,
  setWeekPublished,
  setWeekSectionLocked,
  setRailArchived,
  deleteRailRequest,
  fetchCalendarNotes,
  insertCalendarNote,
  updateCalendarNote,
  deleteCalendarNote,
  calendarNotesAvailable,
  insertRoleShiftOption,
  deleteRoleShiftOption,
  setShiftOptionOff,
  fetchGeneralNotes,
  insertGeneralNote,
  updateGeneralNote,
  deleteGeneralNote,
  generalNotesAvailable,
  fetchPadNotes,
  insertPadNote,
  updatePadNote,
  deletePadNote,
  padNotesAvailable,
  updateSchedulingNote,
  fetchRailViewState,
  setRailCleared as persistRailCleared,
  RAIL_LISTS,
} from "./lib/data.js";
import QRCode from "qrcode";

// "" / undefined -> null so numeric columns don't choke; otherwise Number().
function numOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

/* ---- Save as PDF ---- */
// Snapshot a DOM node print-style and download it as a PDF (no print dialog).
// html2canvas + jsPDF load on demand so they stay out of the main bundle. In
// the offscreen clone: interactive chrome is stripped, <select>/<input> become
// plain text (html2canvas doesn't paint a select's chosen option), and an
// optional logo header is prepended. Tall captures paginate onto extra pages.
// .screen-only marks app state that isn't part of the document (FINALIZED /
// LOCKED banners, the action row, advisory notes). It's stripped here and hidden
// by @media print, so tagging an element is all it takes to keep it off both.
const PDF_STRIP_ALWAYS = [".screen-only", ".subject-preview", ".published-badge", ".publish-btn", ".print-btn", ".today-btn", ".back-btn", ".save-status", ".save-btn"];
// Snapshot a node into a cropped canvas. Split out of exportNodeAsPdf so the Tip
// Sheet can capture, measure how much of the page the result would fill, and
// re-capture at a different width before committing to a page (see
// exportTipSheetPdf and PDF_PAGE_FILL_TARGET).
async function captureNodeForPdf(node, { header, strip = [] } = {}) {
  const [{ default: html2canvas }] = await Promise.all([import("html2canvas")]);
  // Cloned selects/inputs lose their JS-set values — read them from the live
  // node (querySelectorAll order matches the structurally identical clone).
  const liveSelects = Array.from(node.querySelectorAll("select"));
  const liveInputs = Array.from(node.querySelectorAll("input"));
  node.setAttribute("data-pdf-root", "1");
  let canvas;
  try {
    canvas = await html2canvas(node, {
      scale: 2,
      backgroundColor: "#ffffff",
      onclone: (doc) => {
        const root = doc.querySelector('[data-pdf-root="1"]');
        if (!root) return;
        root.querySelectorAll([...PDF_STRIP_ALWAYS, ...strip].join(", ")).forEach((el) => el.remove());
        root.querySelectorAll("select").forEach((sel, i) => {
          const live = liveSelects[i];
          const span = doc.createElement("span");
          span.style.cssText = "font-family:'Space Mono',monospace;font-size:10px;font-weight:700;color:#2B2A25;";
          span.textContent = live && live.selectedIndex >= 0 ? (live.options[live.selectedIndex]?.text || "") : "";
          sel.replaceWith(span);
        });
        root.querySelectorAll("input").forEach((inp, i) => {
          const span = doc.createElement("span");
          span.style.cssText = "font-family:inherit;font-size:12px;color:#2B2A25;";
          // Carry the input's classes plus a marker, so stylesheet rules that
          // targeted the input still reach its stand-in — the Tip Sheet's
          // denomination writing-rules depend on this.
          span.className = `${inp.className} pdf-field`.trim();
          span.textContent = liveInputs[i] ? String(liveInputs[i].value || "") : "";
          inp.replaceWith(span);
        });
        if (header) {
          const h = doc.createElement("div");
          h.style.cssText = "text-align:center;margin-bottom:14px;";
          const img = doc.createElement("img");
          img.src = HAENYEO_LOGO;
          img.alt = "Haenyeo";
          img.style.cssText = "max-width:230px;max-height:86px;object-fit:contain;";
          h.appendChild(img);
          if (header.title) {
            const t = doc.createElement("div");
            t.style.cssText = "font-family:'Space Mono',monospace;font-weight:700;font-size:13px;color:#2B2A25;margin-top:6px;letter-spacing:0.5px;";
            t.textContent = header.title;
            h.appendChild(t);
          }
          root.prepend(h);
        }
      },
    });
  } finally {
    node.removeAttribute("data-pdf-root");
  }

  // Stripping chrome makes the clone shorter than the live node, so the canvas
  // ends in blank rows — scan up from the bottom and crop them off.
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let bottom = canvas.height;
  const maxScan = Math.min(canvas.height - 1, 4000);
  for (let scanned = 0; scanned < maxScan; scanned++) {
    const row = ctx.getImageData(0, bottom - 1, canvas.width, 1).data;
    let content = false;
    for (let x = 0; x < row.length; x += 4) {
      if (row[x + 3] !== 0 && (row[x] < 246 || row[x + 1] < 246 || row[x + 2] < 246)) { content = true; break; }
    }
    if (content) break;
    bottom--;
  }
  let out = canvas;
  const outH = Math.min(canvas.height, bottom + 24);
  if (outH < canvas.height - 4) {
    out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = outH;
    out.getContext("2d").drawImage(canvas, 0, 0);
  }
  return out;
}

const PDF_MARGIN = 26;
// Usable box on a letter page in points, for either orientation.
function pdfPageBox(orientation) {
  const [pageW, pageH] = orientation === "landscape" ? [792, 612] : [612, 792];
  return { pageW, pageH, availW: pageW - PDF_MARGIN * 2, availH: pageH - PDF_MARGIN * 2 };
}

// Width-fit, paginating down onto extra pages when the capture is taller than
// one page. Used by everything except the Tip Sheet.
async function paginateCanvasToPdf(canvas, filename, orientation) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation, unit: "pt", format: "letter" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = PDF_MARGIN;
  const availW = pageW - margin * 2;
  const availH = pageH - margin * 2;
  const imgW = availW;
  const imgH = (canvas.height / canvas.width) * imgW;
  const data = canvas.toDataURL("image/png");
  const pages = Math.max(1, Math.ceil(imgH / availH));
  for (let p = 0; p < pages; p++) {
    if (p > 0) pdf.addPage();
    // Same lossless compression as the other PDF paths. The alias makes jsPDF
    // embed the image once and reuse it on every page instead of per page.
    pdf.addImage(data, "PNG", margin, margin - p * availH, imgW, imgH, "sheet", "FAST");
    // Mask the margins so page n's overflow doesn't bleed into page n±1's edges.
    pdf.setFillColor(255, 255, 255);
    pdf.rect(0, 0, pageW, margin, "F");
    pdf.rect(0, pageH - margin, pageW, margin + 1, "F");
  }
  pdf.save(filename);
}

// One page, scaled from BOTH dimensions and centred (brief item 4). min() is the
// only ratio-preserving fit that can't crop: whichever axis runs out first sets
// the scale, and the slack on the other axis becomes even margins. Whether the
// slack is small enough is the caller's problem — canvasPageFill() measures it.
function canvasPageFill(canvas, orientation) {
  const { availW, availH } = pdfPageBox(orientation);
  const scale = Math.min(availW / canvas.width, availH / canvas.height);
  return { scale, widthFill: (canvas.width * scale) / availW, heightFill: (canvas.height * scale) / availH };
}
// Returns the jsPDF instance so the caller can download it (Save as PDF) or
// base64 it for an email attachment (Send Tip Sheet) — one render, two outputs.
async function onePageCanvasToPdf(canvas, orientation) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation, unit: "pt", format: "letter" });
  const { pageW, pageH } = pdfPageBox(orientation);
  const { scale } = canvasPageFill(canvas, orientation);
  const w = canvas.width * scale;
  const h = canvas.height * scale;
  // "FAST" = lossless Flate on the embedded pixels. Without it jsPDF stores the
  // 2x capture nearly raw (~8.5 MB), over Vercel's 4.5 MB request limit once
  // it's attached to the tip sheet email. Same pixels either way.
  pdf.addImage(canvas.toDataURL("image/png"), "PNG", (pageW - w) / 2, (pageH - h) / 2, w, h, undefined, "FAST");
  return pdf;
}

async function exportNodeAsPdf(node, filename, { header, orientation = "portrait", strip = [] } = {}) {
  const canvas = await captureNodeForPdf(node, { header, strip });
  await paginateCanvasToPdf(canvas, filename, orientation);
}

// Tip Sheet PDF (brief item 4): how much of the usable page height the content
// must cover before we stop adjusting. A ratio-preserving fit can only fill both
// axes when the capture's aspect ratio matches the page's (landscape letter
// ≈ 1.32 wide once margins are off), so filling the height comes down to how
// wide the capture is — a narrower CSS width reflows the layout taller. The card
// is captured at the base width, measured, and re-captured narrower if it would
// leave a band at the bottom, so a light night (few payout lines) and a heavy one
// both land on a full page.
const PDF_PAGE_FILL_TARGET = 0.9;
const TIP_PDF_BASE_WIDTH = 1080;
const TIP_PDF_MIN_WIDTH = 820;
const TIP_PDF_MAX_WIDTH = 1400;

// How far back Set Schedule lets you navigate (brief item 2). Anything older
// lives on the Calendar, which is read-only by design.
const SCHEDULE_LOOKBACK_WEEKS = 2;

/* ---- Save / autosave status pill (brief item 3) ---- */
// How long after the last edit a background save fires.
const AUTOSAVE_DEBOUNCE_MS = 2000;
const SAVE_STATUS_TEXT = {
  saved: "Saved",
  saving: "Saving…",
  dirty: "Unsaved changes",
  error: "Not saved — press Save",
};
function SaveStatus({ state }) {
  const key = SAVE_STATUS_TEXT[state] ? state : "saved";
  return <span className={`save-status save-status-${key}`}>{SAVE_STATUS_TEXT[key]}</span>;
}
// States that mean work would be lost on a refresh.
function isUnsaved(state) {
  return state === "dirty" || state === "saving" || state === "error";
}

/* ---- Branded schedule sheet (colored Save-as-PDF design) ---- */
// Palette for the schedule PDF + QR sheet. Colors are accents on white so the
// sheet still reads fine on a black-and-white printer.
const SHEET = {
  dark: "#1a1a1a", orange: "#c8956c", green: "#5a8a6a", blue: "#4a7a9b",
  purple: "#8a5a9b", grey: "#8a8a8a", tint: "#fff8f4", teal: "#2a9d8f",
};
const SHEET_GROUP_COLOR = {
  Bar: SHEET.orange, Servers: SHEET.green, "Busser/Runner": SHEET.blue,
  Host: SHEET.purple, Kitchen: SHEET.orange, BOH: SHEET.blue, Training: SHEET.teal,
};

/* ---- Role-color cells (ROLE-COLOR-CELLS-BRIEF) ---- */
// A shift cell is colored by the role actually worked that day (from the shift
// code's prefix), not the section row it sits in — Akira covering Bar shows
// orange inside the Busser/Runner group. One map drives the live grid, the PDF
// sheet, and (mirrored in api/_lib/emails.js) the schedule email.
const ROLE_COLOR = {
  Bar: SHEET.orange, Servers: SHEET.green, "Busser/Runner": SHEET.blue,
  Host: SHEET.purple, Expo: SHEET.orange, Kitchen: SHEET.orange, BOH: SHEET.blue,
  Management: "#888888", Training: SHEET.teal,
};
// Role worked for a stored code. Section-scoped codes (BOH_*/KITCHEN/FM) name
// their role directly; prefix codes go through roleFromCode; codes with no role
// of their own (MID_12_8, unmigrated legacy) fall back to the row's role.
function roleForCell(code, fallbackRole) {
  if (!code || code === "OFF" || code === "GAP") return null;
  if (code === "FM") return "Management";
  if (code === "BOH_STD" || code === "BOH_AM") return "BOH";
  if (code === "KITCHEN") return "Kitchen";
  return roleFromCode(code) || fallbackRole || null;
}
// Readable chip triple (text/border/tint) per role accent for the live grid.
// Screen-only cell chip styling for the Set Schedule grid (the PDF sheet and
// schedule email read ROLE_COLOR directly, so they are unaffected). Dark Split:
// same role hues as before, inverted for a dark surface — tinted background,
// accent-colored text — instead of the previous dark-on-pale-tint.
const CELL_STYLE_BY_ACCENT = {
  "#c8956c": { color: "#e0b48f", borderColor: "rgba(200,149,108,0.55)", background: "rgba(200,149,108,0.14)" },
  "#5a8a6a": { color: "#7fb392", borderColor: "rgba(90,138,106,0.55)", background: "rgba(90,138,106,0.14)" },
  "#4a7a9b": { color: "#79a8c7", borderColor: "rgba(74,122,155,0.55)", background: "rgba(74,122,155,0.14)" },
  "#8a5a9b": { color: "#b184c2", borderColor: "rgba(138,90,155,0.55)", background: "rgba(138,90,155,0.14)" },
  "#888888": { color: "#aaaaaa", borderColor: "rgba(136,136,136,0.55)", background: "rgba(136,136,136,0.14)" },
  "#2a9d8f": { color: "#5fc9bb", borderColor: "rgba(42,157,143,0.55)", background: "rgba(42,157,143,0.14)" },
};
function roleCellStyle(role) {
  const accent = ROLE_COLOR[role];
  return accent ? CELL_STYLE_BY_ACCENT[accent] : undefined;
}
// Dark-theme "Off" chip (Management grid). The old inline SHIFT_META.OFF colors
// were tuned for the light card and left a tan border on the dark surface.
const OFF_CHIP_DARK = { color: "#555555", borderColor: "#2a2a2a", background: "transparent" };

// Midnight Solid (MIDNIGHT-SOLID-TIPSHEET-RAIL-BRIEF item 1): the Calendar week
// view is a read-only sheet on near-black, where every chip is the same solid
// #1a1a1a and only the INK carries the role. That keeps a dense grid scannable
// by hue without seven competing background colors. Off days drop the chip
// entirely and show a recessive dot instead.
const MIDNIGHT = { bg: "#0a0a0a", panel: "#0f0f0f", chip: "#1a1a1a", line: "#2a2a2a", row: "#141414", off: "#222222" };
function calChipStyle(role) {
  const accent = ROLE_COLOR[role];
  return { background: MIDNIGHT.chip, borderColor: MIDNIGHT.line, color: accent || "#aaaaaa" };
}
// Cross-role label (CROSS-ROLE-LABEL-BRIEF): when someone works outside their
// primary role, a small role name renders under the shift in a lighter shade
// of the same accent. Mirrored in api/_lib/emails.js for the schedule email.
const ROLE_COLOR_MUTED = {
  Bar: "#d6b294", Expo: "#d6b294", Kitchen: "#d6b294",
  Servers: "#85a891", "Busser/Runner": "#7ea0b8", BOH: "#7ea0b8",
  Host: "#ab86b8", Management: "#a6a6a6", Training: "#7fc4ba",
};
// Label wording per the brief: "Server" (singular); other roles verbatim.
function crossRoleLabelText(role) {
  return role === "Servers" ? "Server" : role;
}
const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Build the offscreen DOM for one schedule sheet. Fully inline-styled and
// self-contained (html2canvas snapshots it without the app CSS).
// payload: { sectionTitle, weekLabel, days:[{dow,date}×7], todayIdx (-1 when
// the week doesn't contain today), groups:[{label, rows:[{name, shifts[7]}]}],
// managerOn:[names[]×7] }
// Longest run of rows one group prints before it is split under a repeated
// "(CONT.)" heading — comfortably less than a landscape page holds.
const SHEET_MAX_GROUP_ROWS = 18;
// compact: the FOH sheet's tighter row spacing — the one layout that fits 16
// staff + Manager On on one landscape page at full type size. Built into the
// sheet (not print-only CSS) so Print, Save as PDF and the Publish attachment
// are the same layout from one source. BOH/Kitchen keep the roomy default.
function buildScheduleSheetNode({ sectionTitle, weekLabel, days, todayIdx, groups, managerOn, compact = false }) {
  const P = compact
    ? { th: "5px 6px", cell: "3px 6px", name: "3px 12px", grp: "3px 12px", head: "6px 22px", pill: "3px 4px", legend: 6 }
    : { th: "11px 6px", cell: "8px 6px", name: "8px 12px", grp: "7px 12px", head: "16px 26px", pill: "6px 4px", legend: 12 };
  const mono = "'Space Mono', monospace";
  const sans = "'Manrope', sans-serif";
  const dayTint = (i) => (i === todayIdx ? `background:${SHEET.tint};` : "");
  const dayHead = days
    .map((d, i) =>
      i === todayIdx
        ? `<th class="sh-th" style="padding:${P.th};background:${SHEET.orange};color:#fff;font-family:${mono};font-weight:700;font-size:11px;letter-spacing:1.5px;text-align:center;">★ ${d.dow} ${d.date}</th>`
        : `<th class="sh-th" style="padding:${P.th};color:#8c8c8c;font-family:${mono};font-weight:700;font-size:11px;letter-spacing:1.5px;text-align:center;border-bottom:1.5px solid #e4e4e4;">${d.dow} ${d.date}</th>`
    )
    .join("");
  // Cell text takes the color of the role worked that day (r.roles), not the
  // section's color — off days stay dimmed grey italic em-dashes. Working
  // outside the row's primary role adds a small muted role name underneath.
  const shiftCell = (label, role, primary, i) => {
    const off = !label || label === "Off";
    const cross = !off && role && primary && role !== primary;
    const crossLine = cross
      ? `<div style="font-size:9px;line-height:1.1;margin-top:1px;font-weight:700;color:${ROLE_COLOR_MUTED[role] || "#a6a6a6"};">${escHtml(crossRoleLabelText(role))}</div>`
      : "";
    return `<td class="sh-cell" style="padding:${P.cell};text-align:center;border-bottom:1px solid #efefef;${dayTint(i)}${
      off ? `font-style:italic;color:#cccccc;` : `color:${ROLE_COLOR[role] || "#3a3a3a"};`
    }font-family:${sans};font-size:12px;${off ? "" : "font-weight:700;"}">${off ? "—" : escHtml(label)}${crossLine}</td>`;
  };
  // Each group is its own <tbody class="sh-group">, which print CSS keeps on
  // one page (break-inside: avoid) — a group never splits across pages. A group
  // too long to fit one page anyway is pre-split into chunks, each with its own
  // heading ("… (CONT.)"), so any unavoidable break still lands under a heading.
  // The date row is the table's <thead>, which the browser repeats per page.
  const groupBlock = (g) => {
    const color = SHEET_GROUP_COLOR[g.label] || SHEET.grey;
    const head = (cont) => `<tr><td class="sh-grp" colspan="8" style="border-top:2.5px solid ${color};background:#fafafa;padding:${P.grp};">
      <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${color};margin-right:8px;"></span>
      <span style="font-family:${mono};font-weight:700;font-size:11px;letter-spacing:2px;color:#333;">${escHtml(g.label).toUpperCase()}${cont ? " (CONT.)" : ""}</span>
    </td></tr>`;
    const row = (r) => `<tr>
        <td class="sh-name" style="padding:${P.name};border-bottom:1px solid #efefef;font-family:${sans};font-weight:600;font-size:12.5px;color:#2b2b2b;white-space:nowrap;">${escHtml(r.name)}</td>
        ${r.shifts.map((label, i) => shiftCell(label, r.roles?.[i], r.primaryRole, i)).join("")}
      </tr>`;
    const chunks = [];
    for (let i = 0; i < g.rows.length; i += SHEET_MAX_GROUP_ROWS) chunks.push(g.rows.slice(i, i + SHEET_MAX_GROUP_ROWS));
    if (!chunks.length) chunks.push([]);
    return chunks.map((c, ci) => `<tbody class="sh-group">${head(ci > 0)}${c.map(row).join("")}</tbody>`).join("");
  };
  const pill = (n) =>
    `<span style="display:inline-block;background:${SHEET.dark};color:#fff;border-radius:999px;padding:2.5px 9px;font-family:${sans};font-weight:600;font-size:10px;margin:1px;white-space:nowrap;">${escHtml(n)}</span>`;
  const managerRow = managerOn
    ? `<tbody class="sh-group"><tr><td class="sh-grp" colspan="8" style="border-top:2.5px solid ${SHEET.grey};background:#fafafa;padding:${P.grp};">
        <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${SHEET.grey};margin-right:8px;"></span>
        <span style="font-family:${mono};font-weight:700;font-size:11px;letter-spacing:2px;color:#333;">MANAGER ON</span>
      </td></tr>
      <tr>
        <td class="sh-name" style="padding:${P.name};border-bottom:1px solid #efefef;font-family:${sans};font-weight:600;font-size:11px;color:#8c8c8c;">Manager on</td>
        ${managerOn
          .map((names, i) =>
            names.length
              ? `<td class="sh-cell" style="padding:${P.pill};text-align:center;border-bottom:1px solid #efefef;${dayTint(i)}">${names.map(pill).join(" ")}</td>`
              : `<td class="sh-cell" style="padding:${P.cell};text-align:center;border-bottom:1px solid #efefef;${dayTint(i)}font-style:italic;color:#cccccc;font-family:${sans};font-size:12px;">—</td>`
          )
          .join("")}
      </tr></tbody>`
    : "";
  const legendDots = groups
    .map((g) => {
      const color = SHEET_GROUP_COLOR[g.label] || SHEET.grey;
      return `<span style="margin-left:14px;white-space:nowrap;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:5px;"></span>${escHtml(g.label)}</span>`;
    })
    .join("");
  const todaySwatch =
    todayIdx >= 0
      ? `<span style="margin-right:16px;white-space:nowrap;"><span style="display:inline-block;width:10px;height:10px;background:${SHEET.orange};border-radius:2.5px;margin-right:5px;"></span>Today</span>`
      : "";
  const printedOn = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  const node = document.createElement("div");
  node.style.cssText = "position:absolute;left:-10000px;top:0;width:1560px;background:#ffffff;padding:0 0 6px;";
  node.innerHTML = `
    <div class="sh-head" style="background:#ffffff;border-bottom:2px solid #2b2a25;padding:${P.head};display:flex;align-items:center;justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:14px;">
        <img src="${HAENYEO_ICON}" alt="" style="width:36px;height:36px;object-fit:contain;" />
        <div>
          <div style="font-family:${mono};font-weight:700;font-size:20px;letter-spacing:6px;color:#2b2a25;">HAENYEO</div>
          <div style="font-family:${mono};font-weight:700;font-size:10px;letter-spacing:2.5px;color:${SHEET.orange};margin-top:2px;">${escHtml(sectionTitle)}</div>
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-family:${mono};font-weight:700;font-size:14px;letter-spacing:1px;color:#2b2a25;">${escHtml(weekLabel)}</div>
        <div style="font-family:${sans};font-size:10px;color:#8a8a8a;margin-top:2px;">Printed ${printedOn}</div>
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
      <colgroup><col style="width:172px;" />${days.map(() => "<col />").join("")}</colgroup>
      <thead><tr><th style="border-bottom:1.5px solid #e4e4e4;"></th>${dayHead}</tr></thead>
      ${groups.map(groupBlock).join("")}${managerRow}
    </table>
    <div class="sh-legend" style="display:flex;align-items:center;margin-top:${P.legend}px;padding:0 4px;font-family:${sans};font-size:10.5px;color:#7a7a7a;">
      <div>${todaySwatch}<span style="white-space:nowrap;"><span style="font-style:italic;color:#cccccc;">—</span>&nbsp; Day off</span></div>
      <div style="margin-left:auto;">${legendDots}</div>
    </div>`;
  return node;
}

// Dev-only escape hatch for eyeballing the sheet in the browser (dead code in
// prod builds — import.meta.env.DEV is compile-time false there).
if (import.meta.env.DEV && typeof window !== "undefined") window.__sheetPreview = buildScheduleSheetNode;

// Snapshot a sheet node onto a single landscape page, scaled to fit — returns
// the jsPDF instance so callers can either download it or extract its bytes.
async function renderSheetNodeToPdf(node) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  document.body.appendChild(node);
  let canvas;
  try {
    canvas = await html2canvas(node, { scale: 2, backgroundColor: "#ffffff" });
  } finally {
    node.remove();
  }
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 24;
  const scale = Math.min((pageW - margin * 2) / canvas.width, (pageH - margin * 2) / canvas.height);
  const w = canvas.width * scale;
  const h = canvas.height * scale;
  // Lossless "FAST" Flate, as in onePageCanvasToPdf: these PDFs ride along on
  // the publish email, and uncompressed captures across several weeks would
  // blow past Vercel's 4.5 MB request limit.
  pdf.addImage(canvas.toDataURL("image/png"), "PNG", (pageW - w) / 2, (pageH - h) / 2, w, h, undefined, "FAST");
  return pdf;
}
async function exportSheetNodeAsPdf(node, filename) {
  const pdf = await renderSheetNodeToPdf(node);
  pdf.save(filename);
}
// Same render, but return the PDF as raw base64 (for email attachments). No
// data: prefix — the server base64-encodes it straight into the MIME part.
async function sheetNodePdfBase64(node) {
  return pdfToBase64(await renderSheetNodeToPdf(node));
}
function pdfToBase64(pdf) {
  const bytes = new Uint8Array(pdf.output("arraybuffer"));
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

const HAENYEO_LOGO = "data:image/png;base64,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";

const HAENYEO_ICON = "data:image/png;base64,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";



/* ---------------------------------- RAIL DATA ---------------------------------- */

const TYPE_STYLES = {
  "REQUEST OFF": { badge: "#7B93A3", label: "Request Off" },
  "SHIFT SWAP": { badge: "#8FA396", label: "Shift Swap" },
  "COVERAGE REQUEST": { badge: "#D98C86", label: "Coverage Request" },
  "TIME OFF": { badge: "#6E86A8", label: "Time Off" },
};

// A TIME OFF dates string is "consecutive" if it uses a range ("Jul 28 to Aug 4"),
// otherwise a "non-consecutive" list. Returns { consecutive, dates:[ISO...] }.
function timeOffDates(datesStr, ref = new Date()) {
  const parsed = parseRailDates(datesStr, ref);
  const consecutive = /\b(?:to|through)\b/i.test(String(datesStr || "")) && parsed.length >= 2;
  if (consecutive) {
    const start = new Date(parsed[0] + "T00:00:00");
    const end = new Date(parsed[parsed.length - 1] + "T00:00:00");
    const out = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) out.push(iso(new Date(d)));
    return { consecutive: true, dates: out };
  }
  return { consecutive: false, dates: parsed };
}

const initialPending = [
  { id: 1, type: "REQUEST OFF", name: "Bernie", dates: "07/16", notice: "9 days notice", urgent: false, note: "Bar covered by Isabella & Angel that day.", rotate: -1.4 },
  { id: 2, type: "SHIFT SWAP", name: "Reiko", dates: "07/12", notice: "10 days notice", urgent: false, note: "Swapping with Mia — she's confirmed.", rotate: 1.1 },
  { id: 3, type: "COVERAGE REQUEST", name: "Emilio", dates: "07/09", notice: "2 days notice", urgent: true, note: "No one has picked up the shift yet.", rotate: -0.8 },
  { id: 4, type: "REQUEST OFF", name: "Halle", dates: "07/22", notice: "20 days notice", urgent: false, note: "No schedule conflicts found.", rotate: 1.6 },
];

const initialLog = [
  { id: "l1", text: "Auto-approved Kevin — Jul 4, no conflict", time: "8:41 AM", tone: "good" },
  { id: "l2", text: "Auto-confirmed receipt — David coverage req.", time: "8:22 AM", tone: "neutral" },
  { id: "l3", text: "Flagged: 2 requests off overlap Jul 19 — needs review", time: "7:55 AM", tone: "warn" },
  { id: "l4", text: "Auto-approved Halle — Jul 11, no conflict", time: "Yesterday", tone: "good" },
];

const roster = [
  { name: "Ivy", status: "In — 4pm", tone: "in" },
  { name: "Mia", status: "In — 6pm", tone: "in" },
  { name: "Emilio", status: "Coverage gap", tone: "gap" },
  { name: "Bernie", status: "In — 4pm", tone: "in" },
  { name: "Juliette", status: "In — 5pm", tone: "in" },
];

function timeNow() {
  return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Recurring holidays, computed per year: US federal + the restaurant's own big
// nights (Valentine's, Mother's Day, Halloween, NYE). Fixed rules — no admin UI.
function nthWeekdayOfMonth(year, month, weekday, n) {
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (n - 1) * 7);
}
function lastWeekdayOfMonth(year, month, weekday) {
  const last = new Date(year, month + 1, 0);
  const offset = (last.getDay() - weekday + 7) % 7;
  return new Date(year, month, last.getDate() - offset);
}
const _holidayCache = {};
function holidaysForYear(year) {
  if (_holidayCache[year]) return _holidayCache[year];
  const entries = [
    [new Date(year, 0, 1), "New Year's Day"],
    [nthWeekdayOfMonth(year, 0, 1, 3), "MLK Day"],
    [new Date(year, 1, 14), "Valentine's Day"],
    [nthWeekdayOfMonth(year, 1, 1, 3), "Presidents Day"],
    [nthWeekdayOfMonth(year, 4, 0, 2), "Mother's Day"],
    [lastWeekdayOfMonth(year, 4, 1), "Memorial Day"],
    [new Date(year, 6, 4), "Independence Day"],
    [nthWeekdayOfMonth(year, 8, 1, 1), "Labor Day"],
    [nthWeekdayOfMonth(year, 9, 1, 2), "Columbus Day"],
    [new Date(year, 9, 31), "Halloween"],
    [new Date(year, 10, 11), "Veterans Day"],
    [nthWeekdayOfMonth(year, 10, 4, 4), "Thanksgiving"],
    [new Date(year, 11, 25), "Christmas"],
    [new Date(year, 11, 31), "New Year's Eve"],
  ];
  const byIso = {};
  entries.forEach(([d, name]) => { byIso[iso(d)] = name; });
  _holidayCache[year] = byIso;
  return byIso;
}
function holidayFor(isoStr) {
  return holidaysForYear(Number(isoStr.slice(0, 4)))[isoStr] || null;
}

// always the real current date going forward — not tied to the app's demo date
function getWeekStrip() {
  const today = new Date();
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push({ date: d, iso: iso(d), label: JS_WEEKDAY_NAMES[d.getDay()].slice(0, 3), num: d.getDate() });
  }
  return days;
}

/* -------------------------------- CALENDAR DATA -------------------------------- */

// display order for role sections — Expo isn't its own section since it's just
// Daniel and Akira's Busser/Runner row on their specific day
// Training sits at the bottom of FOH: trainees aren't tipped and don't fill a
// tip-out slot, so grouping them last keeps the tipped roles together. (The
// brief offered "below Host, above Busser/Runner" or bottom-of-FOH.)
const ROLES = ["Bar", "Host", "Servers", "Busser/Runner", "Training"];

// other schedules on the Set Schedule tab, not staffed yet — placeholder slots only
const PLACEHOLDER_GROUPS = { boh: 4, kitchen: 6, management: 2 };
const PLACEHOLDER_LABELS = { boh: "Back of House", kitchen: "Kitchen", management: "Management" };
// row order here mirrors staff_roles.sort_order — keep them in sync.
// Jon cross-works Kitchen (Management + Kitchen), so he appears in the Kitchen
// roster too; cross-scheduling blocks him from both sections the same day.
const PLACEHOLDER_NAMES = {
  boh: ["Hector", "Freddy", "Temo", "Oryan"],
  kitchen: ["Jenny", "Ajuma", "Kelvin", "Jason", "Freddy", "Jon"],
  management: ["Lenis", "Jon"],
};

// staff_roles rows use these role names for the non-FOH grids
const GROUP_ROLE = { boh: "BOH", kitchen: "Kitchen", management: "Management" };

// Note for reference: kitchen actually closes at 10p Thu/Fri/Sat (staff out ~11:30)
// and 9p Sun-Wed (staff out ~10:30) — simplified on the schedule to just "3p – Close".

// every staff member, listed once
const PERSON_ROSTER = [
  { name: "Bernie", role: "Bar" },
  { name: "Isabella", role: "Bar" },
  { name: "Angel", role: "Bar" },
  { name: "Abraham", role: "Bar" },
  { name: "Juliette", role: "Host" },
  { name: "Halle", role: "Host" },
  { name: "Ivy", role: "Servers" },
  { name: "Mia", role: "Servers" },
  { name: "Reiko", role: "Servers" },
  { name: "David", role: "Servers" },
  { name: "Daniel", role: "Servers" },
  { name: "Akira", role: "Busser/Runner" },
  { name: "Emilio", role: "Busser/Runner" },
  { name: "Miguel", role: "Busser/Runner" },
  { name: "Kevin", role: "Busser/Runner" },
  { name: "Dennis", role: "Busser/Runner" },
];

// this reflects the real week of Jul 6–12, 2026 from the uploaded schedule PDF.
// index 0 = Sunday ... 6 = Saturday. Daniel expos Saturday, Akira expos Friday.
// Mia's row on the sheet only showed her 3 days off ("-ro-") without her working
// shift times, so hers is left as a flat placeholder — fill in manually.
// David and Daniel are grouped under Servers but still fill Busser/Runner (and
// Expo/Host) slots — see their custom cycles below.
const PERSON_PATTERNS = {
  Bernie:   ["OPENER", "OFF",    "OFF",    "OFF",    "OFF",    "OFF",    "OPENER"],
  Isabella: ["OFF",    "OPENER", "OPENER", "CLOSER", "CLOSER", "OPENER", "OFF"],
  Angel:    ["OFF",    "OFF",    "OFF",    "OFF",    "OFF",    "SWING",  "OPENER"],
  Abraham:  ["OFF",    "OFF",    "OFF",    "OPENER", "OFF",    "OFF",    "OFF"],
  Juliette: ["OFF",    "OPENER", "OFF",    "OPENER", "OFF",    "OFF",    "OPENER"],
  Halle:    ["OFF",    "OFF",    "OPENER", "OFF",    "OPENER", "OPENER", "OFF"],
  Ivy:      ["OFF",    "CLOSER", "SWING",  "OPENER", "SWING",  "OPENER", "OFF"],
  Mia:      ["CLOSER", "CLOSER", "CLOSER", "CLOSER", "CLOSER", "CLOSER", "CLOSER"],
  Reiko:    ["OFF",    "OPENER", "OPENER", "OPENER", "SWING",  "OPENER", "SWING"],
  David:    ["BUSRUN6", "BUSRUN6", "BUSRUN6", "BUSRUN4", "OFF",   "OFF",    "OFF"],
  Daniel:   ["BUSRUN6", "OFF",     "BUSRUN6", "BUSRUN6", "OFF",   "BUSRUN6","EXPO"],
  Emilio:   ["OFF",    "CLOSER", "CLOSER", "OFF",    "OFF",    "OFF",    "OFF"],
  Miguel:   ["OFF",    "OFF",    "OFF",    "OPENER", "OPENER", "OFF",    "OFF"],
  Kevin:    ["OFF",    "OFF",    "OFF",    "OFF",    "CLOSER", "OPENER", "CLOSER"],
  Dennis:   ["OFF",    "OPENER", "OPENER", "CLOSER", "OFF",    "SWING",  "OPENER"],
  Akira:    ["OPENER", "OFF",    "OFF",    "SWING",  "OFF",    "EXPO",   "BAR6"],
};

/* --------------------------- ROLES & SHIFT OPTIONS ---------------------------- */
// Shift codes are role-prefixed (SV_/BR_/HOST/EXPO/BAR_) so a stored cell value
// carries both the role worked that day and the shift. The DB versions of these
// two structures (staff_roles, role_shift_options — migration 0002) win when
// present; these are the fallbacks so the app never renders blank pre-migration.

// which role(s) each FOH person can work; first entry = primary/default
const DEFAULT_STAFF_ROLES = {
  Bernie: ["Bar"], Isabella: ["Bar"], Abraham: ["Bar"],
  Angel: ["Bar", "Servers"],
  Juliette: ["Host"], Halle: ["Host"],
  Ivy: ["Servers"], Mia: ["Servers"], Reiko: ["Servers"],
  David: ["Servers", "Busser/Runner", "Expo", "Host"],
  Daniel: ["Servers", "Busser/Runner", "Expo"],
  Akira: ["Busser/Runner", "Bar", "Expo"],
  Emilio: ["Busser/Runner"], Miguel: ["Busser/Runner"], Kevin: ["Busser/Runner"], Dennis: ["Busser/Runner"],};

// dropdown options per role (FC = first cut, CL = close, SC = second cut)
const DEFAULT_ROLE_OPTIONS = {
  Servers: [
    { code: "OFF", label: "Off" }, { code: "SV_4FC", label: "4pm-FC" }, { code: "SV_5CL", label: "5pm-CL" },
    { code: "SV_5SC", label: "5pm-SC" }, { code: "SV_6CL", label: "6pm-CL" },
  ],
  "Busser/Runner": [
    { code: "OFF", label: "Off" }, { code: "BR_4FC", label: "4pm-FC" }, { code: "BR_5SC", label: "5pm-SC" },
    { code: "BR_5CL", label: "5pm-CL" }, { code: "BR_6CL", label: "6pm-CL" },
  ],
  Host: [{ code: "OFF", label: "Off" }, { code: "HOST_4", label: "Host 4pm" }],
  Expo: [{ code: "OFF", label: "Off" }, { code: "EXPO_5", label: "Expo 5pm" }, { code: "EXPO_6", label: "Expo 6pm" }],
  Bar: [
    { code: "OFF", label: "Off" }, { code: "BAR_4FC", label: "4pm-FC" }, { code: "BAR_4CL", label: "4pm-CL" },
    { code: "BAR_5SC", label: "5pm-SC" }, { code: "BAR_5CL", label: "5pm-CL" }, { code: "BAR_5FC", label: "5pm-FC" },
    { code: "BAR_6CL", label: "6pm-CL" },
  ],
  Training: [
    { code: "OFF", label: "Off" }, { code: "TRAIN_4", label: "Training 4pm" }, { code: "TRAIN_6", label: "Training 6pm" },
  ],
  BOH: [
    { code: "OFF", label: "Off" }, { code: "BOH_STD", label: "3p – Close" }, { code: "BOH_AM", label: "9a – 5p" },
    { code: "MID_12_8", label: "12p – 8p" },
  ],
  Kitchen: [
    { code: "OFF", label: "Off" }, { code: "KITCHEN", label: "3p – Close" }, { code: "MID_12_8", label: "12p – 8p" },
  ],
  Management: [{ code: "OFF", label: "Off" }, { code: "FM", label: "FM" }],
};

// short role names for the compact in-cell role picker
const ROLE_SHORT = { Bar: "Bar", Host: "Host", Servers: "Server", "Busser/Runner": "Bus/Run", Expo: "Expo", Training: "Train" };

// Manager-added shift options (brief item 3) need a stable code. Reusing the
// existing per-role prefixes matters: roleFromCode() reads them to decide which
// role a shift belongs to, so a hand-rolled code would lose its role color and
// its Tip Sheet slot.
// Roles whose dropdowns the Manage Shifts panel exposes, in display order.
const SHIFT_MANAGED_ROLES = ["Bar", "Host", "Servers", "Busser/Runner", "Expo", "Training", "BOH", "Kitchen", "Management"];
const ROLE_CODE_PREFIX = {
  Servers: "SV", "Busser/Runner": "BR", Bar: "BAR", Host: "HOST", Expo: "EXPO",
  Training: "TRAIN", BOH: "BOH", Kitchen: "KITCHEN", Management: "FM",
};
// "7pm-CL" -> "SV_7PMCL", de-duped against the codes already on that role.
function shiftCodeFor(role, label, existingCodes = []) {
  const prefix = ROLE_CODE_PREFIX[role] || "SHIFT";
  const slug = String(label).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "NEW";
  let code = `${prefix}_${slug}`;
  let n = 2;
  while (existingCodes.includes(code)) code = `${prefix}_${slug}${n++}`;
  return code;
}

// Manage Shifts HINT only: does a label read like an off state ("RO", "Req
// Off", "PTO")? Used to suggest ticking "Counts as off" — never to decide who
// is working. That is the option's is_off flag alone (see isOffCell).
function looksLikeOffLabel(label) {
  return /(^|[^a-z])(rs*[./]?s*o|off|req(uest)?.?s*off|pto|vacation|leave)([^a-z]|$)/i.test(String(label || ""));
}

// which roles the Staff screen offers per section
const SECTION_ROLES = {
  FOH: ["Bar", "Host", "Servers", "Busser/Runner", "Expo", "Training"],
  BOH: ["BOH", "Kitchen"],
  Kitchen: ["Kitchen", "BOH"],
  // Expo: a manager can be scheduled as Expo on the Management grid, which
  // routes them into the Expo tip slot like any other cross-role shift.
  Management: ["Management", "Kitchen", "Expo"],
};
const SECTIONS = ["FOH", "BOH", "Kitchen", "Management"];

// QR codes for the Staff tab. VITE_STAFF_REGISTER_CODE is baked in at build time
// (not secret — it's the code word posted in the restaurant). Missing at build
// time shows a visible placeholder so it's obvious the env var wasn't set.
const SCHEDULE_INBOX = "haenyeo.schedule@gmail.com";
const REGISTER_CODE = import.meta.env.VITE_STAFF_REGISTER_CODE || "CODEWORD-NOT-SET";
// RFC 6068: mailto: links must encode spaces as %20 (not +), newlines as %0A,
// and other reserved chars accordingly. URLSearchParams uses + for spaces, so we
// manually encode to the mailto spec instead.
function mailtoLink(subject, body) {
  const encode = (s) => {
    if (!s) return "";
    return encodeURIComponent(s)
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29")
      .replace(/'/g, "%27");
  };
  const parts = [`subject=${encode(subject)}`];
  if (body) parts.push(`body=${encode(body)}`);
  return `mailto:${SCHEDULE_INBOX}?${parts.join("&")}`;
}
const QR_CODES = [
  { key: "register", label: "Register", printLabel: "Register", instruction: 'Replace "Your Name Here" with your full name, add your phone number, and send', subject: `[REGISTER] – Your Name Here – ${REGISTER_CODE}`, body: "My best phone number is: " },
  { key: "reqoff", label: "Request Off", printLabel: "Request Off", instruction: 'Replace "Your Name" with your name, add the date, and send', subject: "RO Your Name – Date" },
  { key: "timeoff-c", label: "Time Off (consecutive)", printLabel: "Time Off — Date Range", instruction: 'Replace "Your Name" with your name, add your start and end dates, and send', subject: "RO Your Name – Start Date to End Date" },
  { key: "timeoff-n", label: "Time Off (non-consecutive)", printLabel: "Time Off — Specific Dates", instruction: 'Replace "Your Name" with your name, list each date separated by commas, and send', subject: "RO Your Name – Date, Date, Date" },
  { key: "swap", label: "Shift Swap", printLabel: "Shift Swap", instruction: 'Replace "Your Name" with your name, add the date, and say who you\'re swapping with in the body', subject: "swap Your Name – Date", body: "I would like to swap with: " },
  { key: "coverage", label: "Coverage Request", printLabel: "Coverage Request", instruction: 'Replace "Your Name" with your name, add the date, say who is covering you, and CC that person\'s email', subject: "coverage Your Name – Date", body: "The person covering me will be: " },
  { key: "update", label: "Update My Info", printLabel: "Update Contact Info", instruction: 'Replace "Your Name" with your name and fill in your new email and/or phone number', subject: `[UPDATE INFO] – Your Name – ${REGISTER_CODE}`, body: "My new email is: \nMy new phone is: " },
];

// Print-sheet layout for the 6 non-register codes (SCHEDULE-DESIGN-BRIEF §3).
// Layout/wording only — the QR contents come from QR_CODES via `key`.
const QR_PRINT_CARDS = [
  { key: "reqoff", title: "Request Off", color: SHEET.green, text: "Single day off — add your name and the date" },
  { key: "timeoff-c", title: "Time Off — Date Range", color: SHEET.green, text: "Multiple days in a row — add start and end dates" },
  { key: "timeoff-n", title: "Time Off — Specific Days", color: SHEET.green, text: "Scattered dates — list each one separated by commas" },
  { key: "swap", title: "Shift Swap", color: SHEET.blue, text: "Add the date + say who you're swapping with" },
  { key: "coverage", title: "Coverage Request", color: SHEET.blue, text: "Add the date + who is covering you — CC them on the email" },
  { key: "update", title: "Update My Info", color: SHEET.purple, text: "New email or phone? Fill in what changed" },
];

// which role a stored shift code belongs to (null for OFF/GAP)
function roleFromCode(code) {
  if (!code) return null;
  if (code.startsWith("SV_")) return "Servers";
  if (code.startsWith("BR_")) return "Busser/Runner";
  if (code.startsWith("HOST")) return "Host";
  if (code.startsWith("EXPO")) return "Expo";
  if (code.startsWith("BAR_")) return "Bar";
  if (code.startsWith("TRAIN")) return "Training";
  return null;
}

// pre-redesign codes still in the DB (or the seed constants) — mapped to the
// new vocabulary using the person's primary role where the old code was generic
const LEGACY_BY_ROLE = {
  Bar: { OPENER: "BAR_4FC", SWING: "BAR_5CL", CLOSER: "BAR_6CL", FIVE_CLOSE: "BAR_5CL" },
  Host: { OPENER: "HOST_4", SWING: "HOST_4", CLOSER: "HOST_4" },
  Servers: { OPENER: "SV_4FC", SWING: "SV_5SC", CLOSER: "SV_6CL", FIVE_CLOSE: "SV_5CL" },
  "Busser/Runner": { OPENER: "BR_4FC", SWING: "BR_5CL", CLOSER: "BR_6CL" },
};
const LEGACY_ANY_ROLE = { BUSRUN4: "BR_4FC", BUSRUN6: "BR_6CL", EXPO: "EXPO_5", BAR4: "BAR_4FC", BAR6: "BAR_6CL", HOST: "HOST_4" };
function normalizeShiftCode(code, primaryRole) {
  if (!code) return "OFF";
  if (LEGACY_ANY_ROLE[code]) return LEGACY_ANY_ROLE[code];
  const roleMap = LEGACY_BY_ROLE[primaryRole];
  if (roleMap && roleMap[code]) return roleMap[code];
  return code;
}
function normalizePatterns(patterns, roleByName) {
  const out = {};
  Object.entries(patterns).forEach(([name, week]) => {
    out[name] = week.map((c) => normalizeShiftCode(c, roleByName[name]));
  });
  return out;
}
const DEFAULT_PRIMARY_ROLE = {};
PERSON_ROSTER.forEach((p) => { DEFAULT_PRIMARY_ROLE[p.name] = p.role; });
// Set Schedule notes (migration 0018): the per-staff note is one short line,
// and the side pad remembers being collapsed per browser.
const SCHED_NOTE_MAX = 60;
const PAD_COLLAPSED_KEY = "haenyeo.schedPadCollapsed";
const ALL_OFF_WEEK = ["OFF", "OFF", "OFF", "OFF", "OFF", "OFF", "OFF"];

/* -------------------------------- TIP OUT DATA -------------------------------- */

// Fixed positions on the sheet, in the exact order you read it: each slot has a
// locked-in point value. Whoever occupies the slot that day earns that point —
// nobody scheduled for a slot means the slot (and its points) stays empty.
const SLOTS = [
  { id: "server1", role: "Servers", label: "Server", defaultPts: 1 },
  { id: "server2", role: "Servers", label: "Server", defaultPts: 1 },
  { id: "server3", role: "Servers", label: "Server (Swing)", defaultPts: 0.55 },
  { id: "busser1", role: "Busser/Runner", label: "Busser/Runner", defaultPts: 0.6 },
  { id: "busser2", role: "Busser/Runner", label: "Busser/Runner", defaultPts: 0.6 },
  { id: "expo", role: "Expo (Fri–Sun)", label: "Expo", defaultPts: 0.3 },
  { id: "host", role: "Host", label: "Host", defaultPts: 0.1 },
  { id: "bar1", role: "Bar", label: "Bartender", defaultPts: 0.85 },
  { id: "bar2", role: "Bar", label: "Bartender (Swing)", defaultPts: 0.3 },
];

const POINT_REFERENCE = [
  "SERVER 1.",
  "SWING SERVER .55",
  "BUSSER/RUNNER .6",
  "EXPO .3",
  "HOST .1 (80+ COVERS)",
  "BARTENDER .85",
  "SWING BARTENDER .3",
];

// drawer denominations, $100 bills down to nickels. Each row takes a DOLLAR
// AMOUNT (2 twenties = "40"), not a bill count — totals are a straight sum.
const DENOMS = [100, 50, 20, 10, 5, 1, 0.25, 0.1, 0.05];
function denomLabel(d) {
  return d >= 1 ? `$${d}` : `${Math.round(d * 100)}¢`;
}
function denomTotal(amounts) {
  return DENOMS.reduce((sum, d) => sum + (parseFloat(amounts[d]) || 0), 0);
}

// slot-fill priority within a role: higher rank fills the full-point slots
// first. Second-cut servers take the Server (Swing) slot; the latest-starting
// bartender takes the Bartender (Swing) slot.
// Start hour implied by a shift code, for Tip Sheet slot ordering. Every seeded
// code carries its start after the underscore (SV_4FC, BAR_6CL, HOST_4, EXPO_5).
// Manager-added codes that don't follow that shape sort last rather than
// silently displacing someone from slot 1.
function shiftStartHour(code) {
  const m = String(code || "").match(/_(\d{1,2})/);
  return m ? Number(m[1]) : 99;
}

function dateInfoFromIso(isoStr) {
  const [y, m, d] = isoStr.split("-").map(Number);
  const dateObj = new Date(y, m - 1, d);
  return { iso: isoStr, weekday: dateObj.getDay(), day: d, dateObj };
}

// payroll rounding: round any clock punch to the nearest 15 minutes,
// with the classic 7/8-minute cutoff (<=7 rounds down, >=8 rounds up)
function parseTimeInput(str) {
  if (!str) return null;
  const m = str.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = m[3];
  if (meridiem === "pm" && hour !== 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (!meridiem && hour >= 1 && hour <= 11) hour += 12; // no am/pm typed — assume PM (dinner shift default)
  return hour * 60 + minute;
}
function roundToQuarter(mins) {
  if (mins == null) return null;
  const rem = mins % 15;
  return rem <= 7 ? mins - rem : mins + (15 - rem);
}
function hoursBetween(inStr, outStr) {
  const inM = roundToQuarter(parseTimeInput(inStr));
  let outM = roundToQuarter(parseTimeInput(outStr));
  if (inM == null || outM == null) return 0;
  if (outM < inM) outM += 24 * 60; // shift crosses midnight
  return (outM - inM) / 60;
}

// truncates to the cent instead of rounding — 215.4405 stays 215.44, never 215.45
function money(n) {
  return (Math.floor((n || 0) * 100) / 100).toFixed(2);
}

// one-off exceptions layered on top of each person's recurring pattern — this is
// what approving a Rail request actually changes
const OVERRIDES = {
  "Bernie|2026-07-16": { type: "OFF" },
  "Emilio|2026-07-09": { type: "GAP" },
  "Reiko|2026-07-12": { swap: true },
};

// colors keyed by start time: 4pm = green, 5pm = amber, 6pm = blue; Bar = teal,
// Expo = purple, Host = pink. Labels here are display fallbacks — the dropdowns
// read labels from role_shift_options so wording stays a data edit.
const SHIFT_META = {
  // Servers
  SV_4FC: { label: "4pm-FC", fg: "#3f6b42", border: "#6E9B72", bg: "#E9F1E9" },
  SV_5CL: { label: "5pm-CL", fg: "#8a5a20", border: "#C98A3E", bg: "#FBF0DE" },
  SV_5SC: { label: "5pm-SC", fg: "#8a5a1f", border: "#c2934a", bg: "#F7EEDD" },
  SV_6CL: { label: "6pm-CL", fg: "#33425C", border: "#4A5C7A", bg: "#E7EAF2" },
  // Busser/Runner
  BR_4FC: { label: "4pm-FC", fg: "#3f6b42", border: "#6E9B72", bg: "#E9F1E9" },
  BR_5SC: { label: "5pm-SC", fg: "#8a5a1f", border: "#c2934a", bg: "#F7EEDD" },
  BR_5CL: { label: "5pm-CL", fg: "#8a5a20", border: "#C98A3E", bg: "#FBF0DE" },
  BR_6CL: { label: "6pm-CL", fg: "#33425C", border: "#4A5C7A", bg: "#E7EAF2" },
  // Host / Expo
  HOST_4: { label: "Host 4pm", fg: "#8a4a5c", border: "#b8768a", bg: "#F5E7EC" },
  EXPO_5: { label: "Expo 5pm", fg: "#5b3a8a", border: "#8a63b8", bg: "#EFE7F5" },
  EXPO_6: { label: "Expo 6pm", fg: "#5b3a8a", border: "#8a63b8", bg: "#E7DCF0" },
  // Bar
  BAR_4FC: { label: "4pm-FC", fg: "#1f6f78", border: "#3fa8b3", bg: "#E5F3F4" },
  BAR_4CL: { label: "4pm-CL", fg: "#1f6f78", border: "#3fa8b3", bg: "#E5F3F4" },
  BAR_5SC: { label: "5pm-SC", fg: "#1f6f78", border: "#3fa8b3", bg: "#DCEFF0" },
  BAR_5CL: { label: "5pm-CL", fg: "#1f6f78", border: "#3fa8b3", bg: "#DCEFF0" },
  // Training (brief item 4) — teal, not tipped, excluded from Tip Sheet slots
  TRAIN_4: { label: "Training 4pm", fg: "#1f6f66", border: "#2a9d8f", bg: "#E6F5F3" },
  TRAIN_6: { label: "Training 6pm", fg: "#1f6f66", border: "#2a9d8f", bg: "#E6F5F3" },
  BAR_5FC: { label: "5pm-FC", fg: "#1f6f78", border: "#3fa8b3", bg: "#DCEFF0" },
  BAR_6CL: { label: "6pm-CL", fg: "#17555c", border: "#2f8a94", bg: "#D2E9EB" },
  // Management
  FM: { label: "FM", fg: "#33425C", border: "#4A5C7A", bg: "#E7EAF2" },
  // BOH / Kitchen (wording unchanged for now)
  BOH_STD: { label: "3p – Close", fg: "#5c4a2e", border: "#9c7d4a", bg: "#F1EAD9" },
  BOH_AM: { label: "9a – 5p", fg: "#3f6b42", border: "#6E9B72", bg: "#E9F1E9" },
  KITCHEN: { label: "3p – Close", fg: "#5c4a2e", border: "#9c7d4a", bg: "#F1EAD9" },
  MID_12_8: { label: "12p – 8p", fg: "#7a5c99", border: "#a889c2", bg: "#F0E9F5" },
  OFF: { label: "Off", fg: "#8c8574", border: "#d6cfbb", bg: "transparent" },
  GAP: { label: "Open — needs coverage", fg: "#B23A2F", border: "#B23A2F", bg: "#fff" },
  // retired pre-redesign codes — kept so unmigrated data still renders
  OPENER: { label: "4p – 1st cut", fg: "#3f6b42", border: "#6E9B72", bg: "#E9F1E9" },
  SWING: { label: "5p – 2nd cut", fg: "#8a5a20", border: "#C98A3E", bg: "#FBF0DE" },
  CLOSER: { label: "6p – close", fg: "#33425C", border: "#4A5C7A", bg: "#E7EAF2" },
  EXPO: { label: "Expo", fg: "#5b3a8a", border: "#8a63b8", bg: "#EFE7F5" },
  BAR4: { label: "Bar 4pm", fg: "#1f6f78", border: "#3fa8b3", bg: "#E5F3F4" },
  BAR6: { label: "Bar 6pm", fg: "#1f6f78", border: "#3fa8b3", bg: "#DCEFF0" },
  BUSRUN4: { label: "Bus/Run 4pm", fg: "#3f6b42", border: "#6E9B72", bg: "#E9F1E9" },
  BUSRUN6: { label: "Bus/Run 6pm", fg: "#33425C", border: "#4A5C7A", bg: "#E7EAF2" },
  HOST: { label: "Host", fg: "#8a4a5c", border: "#b8768a", bg: "#F5E7EC" },
  FIVE_CLOSE: { label: "5p – Close", fg: "#8a5a1f", border: "#c2934a", bg: "#F7EEDD" },
};

// local-date ISO (yyyy-mm-dd) — toISOString() would shift the day in non-UTC zones
function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// Single source of truth for "today" across the calendar, week nav, and tip sheet.
const TODAY_ISO = iso(new Date());
const TODAY_HEADER = new Date()
  .toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })
  .replace(",", "")
  .toUpperCase();
function personShiftFor(name, dateObj, patterns, overrides) {
  const key = `${name}|${dateObj.iso}`;
  const ov = overrides[key];
  if (ov?.type) return { type: ov.type, swap: false };
  return { type: (patterns[name] || ALL_OFF_WEEK)[dateObj.weekday], swap: !!ov?.swap };
}

// Routes everyone working that day into a point slot by the ROLE their shift
// code carries (SV_/BR_/HOST/EXPO/BAR_ prefix) — so the role picked in the
// schedule determines the slot they fill, whatever their usual section.
//
// Fill the Tip Sheet's fixed slots from whoever is working that date.
// `working` comes from staffWorkingOn, so anyone off / RO / GAP that day is
// already gone and this only has to route and order.
//
// Slot order is payroll-critical: within a role, slots fill purely by start
// time, earliest first. The three Server slots map to cut order — 1st cut, 2nd
// cut, 3rd cut/closer — so Server (Swing) is simply the 3rd server by start
// time, with no shift-code restriction. Fewer servers than slots leaves the
// trailing slots empty (two servers fill 1 and 2; Swing stays empty). Same rule
// for Bartender before Bartender (Swing).
// ---- One order for "who is working" (Tip Sheet + Today at a Glance) ----
// Group by the role of the SHIFT worked (Juliette on a server shift is a Server
// that night; a manager on Expo is Expo), then start time, then first name so
// ties never reshuffle between renders. The Tip Sheet fills its slots straight
// from this order and Glance lists it — change the slot order here and Glance
// follows. People with no tip-pool shift sort after Bar: MANAGEMENT (managers
// off the floor, e.g. FM), then OTHER (e.g. Training).
const WORK_GROUP_ORDER = ["Servers", "Busser/Runner", "Expo", "Host", "Bar", "Management", "Other"];
function workGroupOf(p) {
  const role = roleFromCode(normalizeShiftCode(p.code, p.role));
  if (role && role !== "Training") return role;
  return p.role === "Management" ? "Management" : "Other";
}
function orderWorking(list) {
  const group = (p) => WORK_GROUP_ORDER.indexOf(workGroupOf(p));
  const start = (p) => shiftStartHour(normalizeShiftCode(p.code, p.role));
  return [...list].sort((a, b) => group(a) - group(b) || start(a) - start(b) || a.name.localeCompare(b.name));
}
// The Tip Sheet's own step on top of staffWorkingOn: a manager is only a Tip
// Sheet candidate on a floor shift (Expo), not on FM. Everyone on the FOH roster
// who is working stays — slot filling (autoAssignSlots) then decides who is
// tipped. Glance never applies this.
function onTipSheet(w) {
  return w.role !== "Management" || !!roleFromCode(normalizeShiftCode(w.code, w.role));
}

function autoAssignSlots(working) {
  const byRole = {};
  orderWorking(working).forEach((p) => {
    const code = normalizeShiftCode(p.code, p.role);
    const role = roleFromCode(code);
    if (!role) return;
    // Trainees aren't tipped, so they never fill a tip-out slot.
    if (role === "Training") return;
    const slotRole = role === "Expo" ? "Expo (Fri–Sun)" : role;
    (byRole[slotRole] = byRole[slotRole] || []).push({ name: p.name, code, start: shiftStartHour(code) });
  });
  // Already in orderWorking order — earliest start first (ties by name):
  // Servers slot 1, then 2, then Swing (3rd cut); Busser/Runner 1 then 2;
  // Bartender before Bartender (Swing).

  const used = {};
  return SLOTS.map((slot) => {
    const list = byRole[slot.role] || [];
    const idx = used[slot.role] || 0;
    used[slot.role] = idx + 1;
    return { ...slot, autoName: list[idx] ? list[idx].name : "" };
  });
}

// build a 5-week grid (35 days) around a given month, starting Monday
function buildMonth(viewDate) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  // Find the first Monday of the month
  const first = new Date(year, month, 1);
  const firstDayOfWeek = first.getDay(); // 0=Sun, 1=Mon, ...
  const daysBeforeMonthStart = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1; // days to go back to Monday
  const start = new Date(year, month, 1 - daysBeforeMonthStart);

  const days = [];
  for (let i = 0; i < 35; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push({
      date: d,
      iso: iso(d),
      day: d.getDate(),
      weekday: d.getDay(),
      inMonth: d.getMonth() === month,
      isToday: iso(d) === TODAY_ISO,
    });
  }
  const weeks = [];
  for (let i = 0; i < 35; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

// Monday (local midnight) of the week containing `d`.
function mondayOf(d) {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = m.getDay(); // 0=Sun … 6=Sat
  m.setDate(m.getDate() - (dow === 0 ? 6 : dow - 1));
  return m;
}

// The Mon–Sun week `offset` weeks from the week containing today. Any integer
// offset — positive or negative — produces a valid week, so week navigation has
// no upper or lower bound and never runs off the end of a fixed array.
function buildWeekByOffset(offset) {
  const start = mondayOf(new Date());
  start.setDate(start.getDate() + offset * 7);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    out.push({
      date: d,
      iso: iso(d),
      day: d.getDate(),
      weekday: d.getDay(),
      inMonth: true,
      isToday: iso(d) === TODAY_ISO,
    });
  }
  return out;
}

// How many weeks away from the current week the week containing `date` sits.
function weekOffsetFor(date) {
  return Math.round((mondayOf(date) - mondayOf(new Date())) / (7 * 86400000));
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Sub-tab display names, used by the per-section Lock button (brief item 2).
const SECTION_LABEL = { foh: "FOH", bohkitchen: "BOH+Kitchen", management: "Management" };
// schedule_weeks.section -> sub-tab key. 'ALL' is the week-level finalize/publish
// row (migration 0013) and deliberately has no sub-tab.
const DB_SECTION_KEY = { FOH: "foh", BOHKITCHEN: "bohkitchen", MANAGEMENT: "management" };
const JS_WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Set Schedule's PERSON_PATTERNS arrays are still index 0=Sun..6=Sat (JS Date convention) —
// this maps each Mon-first display column back to the right index in those arrays
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const MONTH_FMT = { month: "short", day: "numeric" };
// "2026-07-27" -> "Jul 27". Parsed as local midnight so the day never slips back
// a date the way `new Date("2026-07-27")` (UTC) does west of Greenwich.
function shortDate(isoStr) {
  if (!isoStr) return "";
  return new Date(`${isoStr}T00:00:00`).toLocaleDateString(undefined, MONTH_FMT);
}

function formatWeekRange(week) {
  if (!week) return "";
  const fmt = (d) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  const yy = String(week[6].date.getFullYear()).slice(-2);
  return `${fmt(week[0].date)}-${fmt(week[6].date)}/${yy}`;
}

// isOff: the component's isOffCell, so a "Counts as off" option (e.g. RO)
// isn't counted as scheduled. Defaults to plain OFF.
function daySummary(dateObj, patterns, overrides, roster, isOff = (t) => !t || t === "OFF") {
  let scheduled = 0, off = 0, gap = false;
  roster.forEach((p) => {
    const shift = personShiftFor(p.name, dateObj, patterns, overrides);
    if (isOff(shift.type)) off++;
    else if (shift.type === "GAP") gap = true;
    else scheduled++;
  });
  return { scheduled, off, gap };
}

const MONTH_INDEX = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// Parse a Rail "dates" display string into ISO dates. Handles both numeric
// "MM/DD" / "MM/DD/YY" and month-name "Jul 28" forms (the latter is what Gmail
// subjects use). Years are inferred: use the reference year, but roll forward if
// the date would land more than ~2 months in the past (a future request typed
// near year-end). Returns [] if nothing parses.
function parseRailDates(datesStr, ref = new Date()) {
  if (!datesStr) return [];
  const s = String(datesStr);
  const refY = ref.getFullYear();
  const inferYear = (m, d, y) => {
    if (y != null) return y < 100 ? 2000 + y : y;
    const cand = new Date(refY, m - 1, d);
    return (cand - ref) / 86400000 < -60 ? refY + 1 : refY;
  };
  const out = new Set();
  const push = (m, d, y) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return;
    const yr = inferYear(m, d, y);
    out.add(`${yr}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  };
  let mm;
  const numeric = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/g;
  while ((mm = numeric.exec(s))) push(Number(mm[1]), Number(mm[2]), mm[3] ? Number(mm[3]) : null);
  const named = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?/g;
  while ((mm = named.exec(s))) {
    const mi = MONTH_INDEX[mm[1].slice(0, 3).toLowerCase()];
    if (mi) push(mi, Number(mm[2]), mm[3] ? Number(mm[3]) : null);
  }
  return [...out].sort();
}

// Does a Rail "dates" string touch a given ISO date? (used by the calendar popup)
function railDatesMatch(datesStr, isoStr) {
  return parseRailDates(datesStr).includes(isoStr);
}

/* ------------------------------------ APP ------------------------------------- */

export default function SchedulingHub({ session, onSignOut }) {
  const [tab, setTab] = useState("rail"); // 'rail' | 'calendar' | 'template'
  const [pending, setPending] = useState(initialPending);
  const [log, setLog] = useState(initialLog);
  const [nameToId, setNameToId] = useState({});
  // 'month' | 'day' | 'week'. 'day' is the date notes page (brief item 5) —
  // it replaced the old click-a-day popup, and the week view can bounce back to
  // whichever date opened it.
  const [calView, setCalView] = useState("month");
  const [calDayIso, setCalDayIso] = useState(null); // the date whose page is open
  // Set when the Tip Sheet was opened from a Calendar date page (brief item 4),
  // so the sheet can show a way back. Cleared once you leave that date.
  const [tipFromDayIso, setTipFromDayIso] = useState(null);
  // Month/year being viewed. Opens on the CURRENT month (brief item 4) — it used
  // to be pinned to the July 2026 sample week, so the calendar always landed on
  // a month nobody was looking for.
  const [calDate, setCalDate] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [weekIndex, setWeekIndex] = useState(0); // week offset from the current week (0 = this week, negative = past)
  const [calMonthView, setCalMonthView] = useState(1); // 1 or 3 months
  const [patterns, setPatterns] = useState(() => normalizePatterns(PERSON_PATTERNS, DEFAULT_PRIMARY_ROLE));
  const [overrides, setOverrides] = useState(OVERRIDES);
  const [staffList, setStaffList] = useState(() =>
    PERSON_ROSTER.map((p) => ({ id: null, name: p.name, role: p.role, section: "FOH", active: true }))
  );
  const [staffRolesMap, setStaffRolesMap] = useState(DEFAULT_STAFF_ROLES); // { name: [roles], first = primary
  const [groupRosters, setGroupRosters] = useState(PLACEHOLDER_NAMES); // { boh/kitchen/management: [names] }
  const [roleOptions, setRoleOptions] = useState(DEFAULT_ROLE_OPTIONS);
  const [rolesTableReady, setRolesTableReady] = useState(false); // migration 0002 applied?
  const [resolvedReqs, setResolvedReqs] = useState([]); // raw approved/denied rail rows
  // Archived requests: out of the pending queue, still on record, restorable.
  const [archivedReqs, setArchivedReqs] = useState([]);
  const [archivedOpen, setArchivedOpen] = useState(false); // collapsed by default
  const [railMenuId, setRailMenuId] = useState(null);      // which card's ••• menu is open
  const [railConfirm, setRailConfirm] = useState(null);    // { mode: 'delete' | 'archive', item }
  const [railActionBusy, setRailActionBusy] = useState(false);
  const [cellRoleSel, setCellRoleSel] = useState({}); // "name|weekday" -> role picked but shift not chosen yet
  const [newStaff, setNewStaff] = useState({ name: "", section: "FOH", roles: [], primary: "" });
  const [staffDrafts, setStaffDrafts] = useState({}); // staff id -> edited { name, active, roles, primary }
  const [staffMsg, setStaffMsg] = useState("");
  const [gmailStatus, setGmailStatus] = useState(null); // { configured, connected, lastPollAt, lastError, ... }
  const [gmailChecking, setGmailChecking] = useState(false);
  // Google rejected the stored token (invalid_grant etc.) or there isn't one —
  // /api/gmail/status works this out server-side. Drives the Rail's red dot +
  // Reconnect link and the banner in the send dialogs.
  const gmailDisconnected = !!gmailStatus?.needsReconnect;
  const gmailReconnectUrl = gmailStatus?.reconnectUrl || "/api/auth/start";
  async function refreshGmailStatus() {
    try { setGmailStatus(await fetchGmailStatus()); }
    catch (e) { console.error("Gmail status refresh failed:", e); }
  }
  const [railNotes, setRailNotes] = useState({}); // rail request id -> manager note draft
  const [railBusy, setRailBusy] = useState(null); // id being resolved (disables its buttons)
  const [partialOpen, setPartialOpen] = useState({}); // TIME OFF id -> partial-approve field open
  const [partialDates, setPartialDates] = useState({}); // TIME OFF id -> approved-dates text
  const [manualOpen, setManualOpen] = useState(false); // "+ Add Request" modal
  const [manualForm, setManualForm] = useState({ staffId: "", type: "REQUEST OFF", dates: "", note: "", loggedBy: "" });
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(null); // "schedule" | "tips" while exporting
  const scheduleCardRef = useRef(null);
  const tipCardRef = useRef(null);
  const schedulePrintRef = useRef(null); // print-only mount for the branded schedule sheet
  const [infoUpdates, setInfoUpdates] = useState([]); // pending staff_info_updates
  const [staffProfile, setStaffProfile] = useState(null); // open staff id in directory
  const [editingStaffId, setEditingStaffId] = useState(null); // which staff member is being edited in modal
  const [editingStaffEmail, setEditingStaffEmail] = useState("");
  const [editingStaffPhone, setEditingStaffPhone] = useState("");
  const [qrModal, setQrModal] = useState(null); // open QR key
  const [qrDataUrl, setQrDataUrl] = useState(""); // generated QR image
  const [deleteTarget, setDeleteTarget] = useState(null); // staff pending delete confirm
  const [deleteMode, setDeleteMode] = useState(false); // per-row Delete buttons armed?
  // Calendar date notes (brief item 7): { "YYYY-MM-DD": [rows] }
  const [calNotes, setCalNotes] = useState({});
  const [calNoteDraft, setCalNoteDraft] = useState("");
  const [calNoteEditId, setCalNoteEditId] = useState(null);
  const [calNoteEditText, setCalNoteEditText] = useState("");
  // Rail's Date Note quick-add (brief item 3) — same calendar_notes rows the
  // Calendar's date page reads, just a second way in. Defaults to today.
  const [quickNoteDate, setQuickNoteDate] = useState(TODAY_ISO);
  const [quickNoteDraft, setQuickNoteDraft] = useState("");
  const [quickNoteBusy, setQuickNoteBusy] = useState(false);
  const [quickNoteMsg, setQuickNoteMsg] = useState("");
  // Manage Shifts (brief item 3): which role has its add-field open, and its text
  const [shiftAddRole, setShiftAddRole] = useState(null);
  const [shiftAddLabel, setShiftAddLabel] = useState("");
  const [shiftMsg, setShiftMsg] = useState("");
  // Today at a Glance swap dialog (brief item 5)
  // Which day the "Today at a Glance" box is showing (brief item 7). Driven by
  // the 7-day strip; today until someone picks another day.
  const [glanceIso, setGlanceIso] = useState(TODAY_ISO);
  const [swapModal, setSwapModal] = useState(null); // { name, role, code, dateIso } | null
  // removeOnly: take the person off with no replacement (brief item 3).
  const [swapForm, setSwapForm] = useState({ withName: "", shift: "", note: "", removeOnly: false });
  const [swapBusy, setSwapBusy] = useState(false);
  // Tip Sheet day-of add / remove (see applyDayOfChange). The modal IS the
  // confirmation: it names the person and the date before anything is written.
  const [dayOfModal, setDayOfModal] = useState(null); // { mode: "add" | "remove", dateIso, name? } | null
  const [dayOfForm, setDayOfForm] = useState({ name: "", role: "", shift: "", reason: "" });
  const [dayOfBusy, setDayOfBusy] = useState(false);
  const [dayOfError, setDayOfError] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [qrPrintUrls, setQrPrintUrls] = useState({}); // all 7 QR images for the print sheet
  const [qrPrinting, setQrPrinting] = useState(false);
  const [timeOffBlock, setTimeOffBlock] = useState(null); // { name, dayLabel, onOverride } | null
  // Dark Split Rail: which request the centre detail panel is showing. The
  // auto-action log and the resolved list are hidden by the shared cleared_at
  // watermarks in `railCleared` below — the DB is never touched, entries simply
  // stop being rendered once a Clear timestamp sits after their created_at.
  const [selectedRailId, setSelectedRailId] = useState(null);
  // Finalized is no longer its own button (brief item 1) — a successful Send
  // sets it, and Unlock clears it. It still drives the FINALIZED banner and the
  // read-only inputs.
  const [tipFinalized, setTipFinalized] = useState(false);
  const [tipFinalizedAt, setTipFinalizedAt] = useState(null);
  // Lock is the manual half: freeze or reopen a date without emailing anyone.
  const [tipLocked, setTipLocked] = useState(false);
  const [tipLockedAt, setTipLockedAt] = useState(null);
  const [tipLockBusy, setTipLockBusy] = useState(false);
  // Opens on today, like the Calendar — it used to be pinned to the Jul 2 2026
  // sample date. TODAY_ISO is the same value the Today button jumps to.
  const [tipDateIso, setTipDateIso] = useState(TODAY_ISO);
  const [floorCash, setFloorCash] = useState("");
  const [floorCredit, setFloorCredit] = useState("");
  const [barCash, setBarCash] = useState("");
  const [barCredit, setBarCredit] = useState("");
  const [covers, setCovers] = useState("");
  const [openingCounts, setOpeningCounts] = useState({});
  const [closingCounts, setClosingCounts] = useState({});
  const [closingSum, setClosingSum] = useState("");
  const [payoutItems, setPayoutItems] = useState([]);
  const [cashSales, setCashSales] = useState("");
  const [tipTimes, setTipTimes] = useState({}); // slotId -> { in, out }
  const [customMode, setCustomMode] = useState(false);
  // Per-date: slow bar nights skip the 10% bar tip-out (bar keeps it all).
  const [barTipOutOn, setBarTipOutOn] = useState(true);
  const [slotOverrides, setSlotOverrides] = useState({}); // slotId -> { name, pts }
  const [tipSent, setTipSent] = useState(false);
  // When the emails actually went out, for the "Sent ✓ 11:42 PM" button label
  // (migration 0015). Null on sheets sent before that column existed.
  const [tipSentAt, setTipSentAt] = useState(null);
  // Send Tip Sheet confirmation screen (brief item 5). Nothing is emailed until
  // Confirm & Send — the modal owns the editable subject, the optional message
  // notes, and which recipients are excluded.
  const [tipSendOpen, setTipSendOpen] = useState(false);
  const [tipSendSubject, setTipSendSubject] = useState("");
  const [tipSendNotes, setTipSendNotes] = useState("");
  const [tipSendExcluded, setTipSendExcluded] = useState([]); // names unchecked in the modal
  const [tipSendBusy, setTipSendBusy] = useState(false);
  const [tipSendResult, setTipSendResult] = useState(null); // error string after a failed send
  // Save / autosave state (brief item 3): "saved" | "dirty" | "saving" | "error".
  const [tipSaveState, setTipSaveState] = useState("saved");
  const [schedSaveState, setSchedSaveState] = useState("saved");
  // Bumped every time a date's saved row lands, which is the signal to re-take
  // the autosave baseline: that state came FROM the DB, so it isn't a change.
  const [tipLoadSeq, setTipLoadSeq] = useState(0);
  // Persistent Rail clears (brief item 1). GLOBAL, not per user: one shared
  // watermark per list, so a Clear by any manager hides those entries for
  // everyone. Hide-only — rail_requests is never touched.
  const [railCleared, setRailCleared] = useState({ auto_log: null, resolved: null });
  const [railClearBusy, setRailClearBusy] = useState(null);
  // General notes for the Rail's Notes box (brief item 2) — undated, standing
  // notes, not tied to a week or a date.
  const [genNotes, setGenNotes] = useState([]);
  const [genNoteDraft, setGenNoteDraft] = useState("");
  const [genNoteEditId, setGenNoteEditId] = useState(null);
  const [genNoteEditText, setGenNoteEditText] = useState("");
  const [genNoteBusy, setGenNoteBusy] = useState(false);

  const tipDateInfo = dateInfoFromIso(tipDateIso);
  // "THURSDAY · SEPTEMBER 25, 2026" for the printed / PDF sheet (uppercased in CSS).
  const tipSheetDateLabel = `${tipDateInfo.dateObj.toLocaleDateString("en-US", { weekday: "long" })} · ${tipDateInfo.dateObj.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
  const coversNum = parseFloat(covers) || 0;

  // FOH roster: DB staff (active, FOH section) with their primary role; falls
  // back to the seed roster before the first load completes. The known-role
  // check keeps pre-migration DB rows (BOH/Kitchen/Mgmt staff with section
  // defaulted to FOH and role '') out of the FOH grid.
  const fohRoster = useMemo(
    () =>
      staffList
        .filter((s) => s.active !== false && (s.section || "FOH") === "FOH")
        .map((s) => ({ name: s.name, role: (staffRolesMap[s.name] || [])[0] || s.role }))
        .filter((p) => ROLES.includes(p.role) || (staffRolesMap[p.name] || []).length > 0),
    [staffList, staffRolesMap]
  );
  const fohRoleGroups = useMemo(() => {
    const order = [...ROLES];
    fohRoster.forEach((p) => { if (!order.includes(p.role)) order.push(p.role); });
    return order.filter((r) => fohRoster.some((p) => p.role === r));
  }, [fohRoster]);

  // ---- Independent weekly schedules (migration 0010) ----------------------
  // `patterns` and `placeholderPatterns` are the RECURRING TEMPLATE, shared by
  // every week — that's what made editing one week edit them all. The two maps
  // below hold the weeks that have their own saved record, keyed by the week's
  // Monday ISO. A week absent from the map has never been edited and renders
  // from the template; the first edit snapshots it in (see writeCellShift).
  // Declared here, above autoSlots, because the Tip Sheet resolves through them.
  const [placeholderPatterns, setPlaceholderPatterns] = useState(() => {
    const init = {};
    Object.entries(PLACEHOLDER_GROUPS).forEach(([key, count]) => {
      init[key] = Array.from({ length: count }, () => ["OFF", "OFF", "OFF", "OFF", "OFF", "OFF", "OFF"]);
    });
    return init;
  });
  const [weeklyPatterns, setWeeklyPatterns] = useState({});        // { "2026-08-03": { name: [7] } }
  const [weeklyPlaceholders, setWeeklyPlaceholders] = useState({}); // { "2026-08-03": { group: [[7]] } }
  // Week starts we've already fetched, so we don't refetch on every render.
  const loadedWeeksRef = useRef(new Set());

  // staff_id -> name. Declared here because the weekly loaders need it;
  // staffNameById further down aliases this rather than rebuilding it.
  const idToName = useMemo(() => {
    const m = {};
    staffList.forEach((s) => { if (s.id) m[s.id] = s.name; });
    return m;
  }, [staffList]);

  // Monday of the week currently shown in Set Schedule. Derived straight from
  // the offset so it doesn't depend on activeWeek, which is built further down.
  const activeWeekStart = useMemo(() => {
    const m = mondayOf(new Date());
    m.setDate(m.getDate() + weekIndex * 7);
    return iso(m);
  }, [weekIndex]);

  // The schedule that applies to a given week — its own record if it has one,
  // otherwise the shared template. Every read path goes through these, so Set
  // Schedule, the Calendar and the Tip Sheet can never disagree about a week.
  function patternsForWeekStart(weekStartIso) {
    return (weekStartIso && weeklyPatterns[weekStartIso]) || patterns;
  }
  function placeholdersForWeekStart(weekStartIso) {
    return (weekStartIso && weeklyPlaceholders[weekStartIso]) || placeholderPatterns;
  }
  // For the many call sites that hold a single day rather than a week. Day
  // shapes differ: the calendar grid uses { date, iso }, dateInfoFromIso uses
  // { dateObj, iso }. Handle all of them — falling through to the template here
  // would silently show the wrong week rather than failing loudly.
  function patternsForDate(day) {
    if (!day) return patterns;
    const d =
      day instanceof Date ? day
      : day.date instanceof Date ? day.date
      : day.dateObj instanceof Date ? day.dateObj
      : day.iso ? new Date(`${day.iso}T00:00:00`)
      : null;
    return d ? patternsForWeekStart(iso(mondayOf(d))) : patterns;
  }
  const activePatterns = patternsForWeekStart(activeWeekStart);
  const activePlaceholders = placeholdersForWeekStart(activeWeekStart);

  // Pull a week's stored record before we display it. Pre-migration the tables
  // don't exist, fetch returns null, and the week simply stays on the template.
  async function ensureWeekLoaded(weekStartIso) {
    if (!weekStartIso || loadedWeeksRef.current.has(weekStartIso)) return;
    loadedWeeksRef.current.add(weekStartIso);
    try {
      const [wp, wph] = await Promise.all([
        fetchWeeklySchedule(weekStartIso, idToName),
        fetchWeeklyPlaceholders(weekStartIso),
      ]);
      if (wp) setWeeklyPatterns((prev) => ({ ...prev, [weekStartIso]: wp }));
      if (wph) setWeeklyPlaceholders((prev) => ({ ...prev, [weekStartIso]: wph }));
    } catch (e) {
      console.error(`Weekly schedule load failed for ${weekStartIso}:`, e);
      loadedWeeksRef.current.delete(weekStartIso); // allow a retry
    }
  }

  // ---- Per-week notes (migration 0010) ------------------------------------
  // notesWeek is the week the modal is showing — Set Schedule opens it on the
  // week being edited, the Rail panel opens it on the current week.
  const [notesWeek, setNotesWeek] = useState(null);
  const [notesByWeek, setNotesByWeek] = useState({}); // { weekStartIso: [rows] }
  const [noteDraft, setNoteDraft] = useState("");
  const [noteEditId, setNoteEditId] = useState(null);
  const [noteEditText, setNoteEditText] = useState("");
  const weekNotes = notesByWeek[activeWeekStart] || [];
  const thisWeekStart = iso(mondayOf(new Date()));
  const modalNotes = (notesWeek && notesByWeek[notesWeek]) || [];

  async function reloadNotes(weekStartIso) {
    if (!weekStartIso) return;
    try {
      const rows = await fetchScheduleNotes(weekStartIso);
      setNotesByWeek((prev) => ({ ...prev, [weekStartIso]: rows }));
    } catch (e) {
      console.error("Notes load failed:", e);
    }
  }

  // ---- Set Schedule notes (migration 0018) ----------------------------------
  // Two surfaces, both permanent and global — switching weeks never touches
  // them. (1) staff.scheduling_note: a ⚑ beside the name on the grid, edited on
  // the Staff tab or from the flag itself; both go through saveSchedulingNote.
  // (2) The side pad: schedule_pad_notes, its own table so it can't mix with
  // the Rail's Notes box (general_notes).
  const schedNoteByName = useMemo(() => {
    const m = {};
    staffList.forEach((s) => { if (s.scheduling_note) m[s.name] = s.scheduling_note; });
    return m;
  }, [staffList]);
  const [schedNoteEdit, setSchedNoteEdit] = useState(null); // { name, draft } — flag editor on the grid
  const [staffNoteDrafts, setStaffNoteDrafts] = useState({}); // { name: text } — Staff tab inputs mid-edit
  const [schedNoteMsg, setSchedNoteMsg] = useState("");

  async function saveSchedulingNote(name, text) {
    const s = staffList.find((x) => x.name === name);
    if (!s) return;
    const value = String(text || "").trim().slice(0, SCHED_NOTE_MAX) || null;
    const prev = s.scheduling_note ?? null;
    if (value === prev) return;
    const setNote = (v) => setStaffList((list) => list.map((x) => (x.name === name ? { ...x, scheduling_note: v } : x)));
    setNote(value);
    setSchedNoteMsg("");
    if (!s.id) return; // sample roster (local dev) — nothing to write
    try {
      await updateSchedulingNote(s.id, value);
    } catch (e) {
      console.error("Scheduling note save failed:", e);
      setNote(prev);
      setSchedNoteMsg(`Couldn't save ${name}'s scheduling note: ${e.message || e}`);
    }
  }
  const schedNoteCancelRef = useRef(false);
  function commitSchedNoteEdit() {
    if (schedNoteCancelRef.current) { schedNoteCancelRef.current = false; return; }
    if (!schedNoteEdit) return;
    const { name, draft } = schedNoteEdit;
    setSchedNoteEdit(null);
    saveSchedulingNote(name, draft);
  }

  const [padNotes, setPadNotes] = useState([]);
  const [padDraft, setPadDraft] = useState("");
  const [padEdit, setPadEdit] = useState(null); // { id, text }
  const [padMsg, setPadMsg] = useState("");
  const [padCollapsed, setPadCollapsed] = useState(() => {
    try { return localStorage.getItem(PAD_COLLAPSED_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(PAD_COLLAPSED_KEY, padCollapsed ? "1" : "0"); } catch { /* private window etc. */ }
  }, [padCollapsed]);
  // Loaded once — the pad is global, so week navigation must not reload it.
  useEffect(() => {
    fetchPadNotes().then(setPadNotes).catch((e) => console.error("Pad notes load failed:", e));
  }, []);

  async function addPadNote() {
    const note = padDraft.trim();
    if (!note) return;
    const tempId = `tmp-${Date.now()}`;
    setPadNotes((list) => [...list, { id: tempId, note }]);
    setPadDraft("");
    setPadMsg("");
    try {
      const row = await insertPadNote(note);
      setPadNotes((list) => list.map((n) => (n.id === tempId ? row : n)));
    } catch (e) {
      console.error("Pad note add failed:", e);
      setPadNotes((list) => list.filter((n) => n.id !== tempId));
      setPadDraft(note);
      setPadMsg(e.message || String(e));
    }
  }
  const padCancelRef = useRef(false);
  async function commitPadEdit() {
    if (padCancelRef.current) { padCancelRef.current = false; return; }
    if (!padEdit) return;
    const { id, text } = padEdit;
    setPadEdit(null);
    const note = text.trim();
    const before = padNotes.find((n) => n.id === id);
    if (!before || note === before.note) return;
    if (!note) { removePadNote(id); return; } // emptied = deleted
    setPadNotes((list) => list.map((n) => (n.id === id ? { ...n, note } : n)));
    try {
      await updatePadNote(id, note);
    } catch (e) {
      console.error("Pad note edit failed:", e);
      setPadNotes((list) => list.map((n) => (n.id === id ? before : n)));
      setPadMsg(e.message || String(e));
    }
  }
  async function removePadNote(id) {
    const before = padNotes;
    setPadNotes((list) => list.filter((n) => n.id !== id));
    try {
      await deletePadNote(id);
    } catch (e) {
      console.error("Pad note delete failed:", e);
      setPadNotes(before);
      setPadMsg(e.message || String(e));
    }
  }

  // Name cell for every Set Schedule grid. The flag, tooltip and editor are all
  // absolutely positioned, so a note never widens the name column — the day
  // columns keep their width whether or not anyone is flagged.
  function schedNameCell(name, label = name) {
    const note = schedNoteByName[name];
    const editable = staffList.some((s) => s.name === name);
    const editing = schedNoteEdit?.name === name;
    const openEditor = () => {
      schedNoteCancelRef.current = false;
      setSchedNoteEdit({ name, draft: note || "" });
    };
    return (
      <td className="emp-name">
        <span className={`sched-name ${note ? "has-note" : ""}`}>
          {label}
          {note ? (
            <button className="sched-flag screen-only" onClick={openEditor} aria-label={`Edit ${name}'s scheduling note`}>⚑</button>
          ) : editable ? (
            <button className="sched-flag sched-flag-add screen-only" onClick={openEditor} title={`Add a scheduling note for ${name}`} aria-label={`Add a scheduling note for ${name}`}>⚑</button>
          ) : null}
          {note && !editing && <span className="sched-note-tip screen-only" role="tooltip">{note}</span>}
          {editing && (
            <span className="sched-note-editor screen-only">
              <input
                autoFocus
                maxLength={SCHED_NOTE_MAX}
                value={schedNoteEdit.draft}
                placeholder="e.g. No Tuesdays"
                onChange={(e) => setSchedNoteEdit({ name, draft: e.target.value })}
                onBlur={commitSchedNoteEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") { schedNoteCancelRef.current = true; setSchedNoteEdit(null); }
                }}
              />
              <span className="sched-note-hint">Enter saves · blank clears · Esc cancels</span>
            </span>
          )}
        </span>
      </td>
    );
  }

  // Auto-note on Rail approval: "Bernie — Request Off — Aug 3 — Approved".
  // A request can span weeks, so dates are grouped and one note is written per
  // affected week. Failures are logged and ignored — a missing note must never
  // undo an approval that already wrote to the schedule.
  async function noteApproval(item, isoDates) {
    if (!isoDates || !isoDates.length) return;
    const byWeek = {};
    isoDates.forEach((d) => {
      const ws = iso(mondayOf(new Date(`${d}T00:00:00`)));
      if (!byWeek[ws]) byWeek[ws] = [];
      byWeek[ws].push(d);
    });
    const label = TYPE_STYLES[item.type]?.label || item.type;
    const staffId = item.staffId || nameToId[item.name] || null;
    for (const [ws, ds] of Object.entries(byWeek)) {
      const pretty = ds.sort()
        .map((d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, MONTH_FMT))
        .join(", ");
      try {
        const row = await insertScheduleNote({
          weekStartIso: ws,
          note: `${item.name} — ${label} — ${pretty} — Approved`,
          staffId, source: "rail", railRequestId: item.id,
        });
        if (row) setNotesByWeek((prev) => ({ ...prev, [ws]: [row, ...(prev[ws] || [])] }));
      } catch (e) {
        console.error("Auto-note failed:", e);
      }
    }
  }

  // ---- Who is working on a date --------------------------------------------
  // The ONE place that decides whether someone is working a date. Today at a
  // Glance, the 7-day strip and the Tip Sheet (auto-fill, saved Custom
  // Schedules, send recipients, emailed rows, PDF) all read it, so they can't
  // drift apart again.
  //
  // Per person:
  //   1. a schedule_overrides row for the date wins — Rail approvals, swaps, and
  //      an approved day off a manager deliberately replaced with a shift;
  //   2. otherwise an APPROVED Request Off covering the date means off. The
  //      approval's override write can be skipped (the overwrite prompt) or fail,
  //      and the day off is still real. TIME OFF isn't read here: it can be
  //      partially approved, and its row keeps the full requested range, so only
  //      the overrides it wrote are trustworthy;
  //   3. otherwise the week's own saved schedule, else the template.
  // A cell is off per isOffCell — never by reading a label. GAP isn't working
  // either; gaps come back on their own so the glance can still flag the hole.
  //
  // This answers "who is working", so it includes managers on FM and anyone
  // untipped. Who gets a Tip Sheet slot is a separate, narrower question —
  // onTipSheet() below — applied by the Tip Sheet only.
  //
  // Off is decided by the OPTION, not its wording: a shift option can carry
  // "Counts as off" (role_shift_options.is_off, migration 0019) — e.g. an "RO"
  // option kept on the grid on purpose. Its code (SV_RO etc.) looks like a real
  // shift, which is how RO staff leaked onto Glance and the Tip Sheet. Empty,
  // OFF and the legacy bare "RO" code are off regardless of the flag, so plain
  // Off never depends on the migration.
  const offCodes = useMemo(() => {
    const s = new Set();
    Object.values(roleOptions || {}).forEach((list) => (list || []).forEach((o) => { if (o?.isOff) s.add(o.code); }));
    return s;
  }, [roleOptions]);
  const isOffCell = (code) => !code || code === "OFF" || code === "RO" || offCodes.has(code);
  const railOffByDate = useMemo(() => {
    const m = {};
    resolvedReqs.forEach((it) => {
      if (it.status !== "approved" || it.type !== "REQUEST OFF" || !it.name) return;
      parseRailDates(it.dates).forEach((d) => { (m[d] = m[d] || new Set()).add(it.name); });
    });
    return m;
  }, [resolvedReqs]);

  function staffWorkingOn(dateIso) {
    const di = dateInfoFromIso(dateIso);
    const pats = patternsForDate(di);
    const ph = placeholdersForWeekStart(iso(mondayOf(di.dateObj)));
    const railOff = railOffByDate[dateIso];
    const working = [];
    const off = [];
    const gaps = [];
    const seen = new Set();
    function place(name, role, baseType) {
      if (seen.has(name)) return;
      seen.add(name);
      const ov = overrides[`${name}|${dateIso}`];
      let type = ov?.type || baseType;
      if (!ov?.type && railOff?.has(name)) type = "OFF";
      if (isOffCell(type)) off.push(name);
      else if (type === "GAP") gaps.push({ name, role, code: "GAP" });
      else working.push({ name, role, code: type, swapped: !!ov?.swap });
    }
    fohRoster.forEach((p) => place(p.name, p.role, (pats[p.name] || ALL_OFF_WEEK)[di.weekday]));
    // Every manager with a working cell — FM included (they're in the
    // building). Only an FOH code (Expo) puts them on the Tip Sheet.
    (groupRosters.management || []).forEach((name, idx) => {
      const code = ph.management?.[idx]?.[di.weekday] || "OFF";
      place(name, "Management", code);
    });
    // Anyone else whose dated override carries an FOH shift — e.g. a BOH or
    // Kitchen person added on the day as a busser from the Tip Sheet, or picked
    // as a swap replacement. They have no FOH pattern, so only the override
    // puts them on the floor.
    const activeNames = new Set(staffList.filter((s) => s.active !== false).map((s) => s.name));
    Object.entries(overrides).forEach(([key, ov]) => {
      const cut = key.lastIndexOf("|");
      if (key.slice(cut + 1) !== dateIso) return;
      const name = key.slice(0, cut);
      if (seen.has(name) || !activeNames.has(name) || !roleFromCode(ov?.type)) return;
      place(name, roleFromCode(ov.type), ov.type);
    });
    return { working, off, gaps };
  }

  // ---- Today at a Glance --------------------------------------------------
  // Who is on the floor on the day picked in the 7-day strip (brief item 7),
  // defaulting to today. Coverage gaps stay listed (in red) — they're a hole
  // to fill, not a person working.
  // Grouped in the Tip Sheet's order (orderWorking). "(swing)" marks whoever
  // lands in the Server (Swing) / Bartender (Swing) slot for this date.
  const glanceView = useMemo(() => {
    const { working, gaps } = staffWorkingOn(glanceIso);
    const swing = new Set(
      autoAssignSlots(working.filter(onTipSheet))
        .filter((s) => /Swing/.test(s.label) && s.autoName)
        .map((s) => s.autoName)
    );
    const groups = [];
    orderWorking(working).forEach((p) => {
      const key = workGroupOf(p);
      let g = groups[groups.length - 1];
      if (!g || g.key !== key) groups.push((g = { key, people: [] }));
      g.people.push({ ...p, swing: swing.has(p.name) });
    });
    return { groups, gaps, count: working.length + gaps.length };
  }, [fohRoster, patterns, weeklyPatterns, placeholderPatterns, weeklyPlaceholders, groupRosters, overrides, railOffByDate, staffList, offCodes, glanceIso]);
  const glanceIsToday = glanceIso === TODAY_ISO;
  // "THURSDAY, SEP 24" for any other day; today stays the familiar label.
  const glanceHeading = glanceIsToday
    ? "Today at a Glance"
    : new Date(`${glanceIso}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });

  // Primary role for a staff member, used to pick their shift dropdown.
  function primaryRoleOf(name) {
    const fromMap = (staffRolesMap[name] || [])[0];
    if (fromMap) return fromMap;
    return staffList.find((s) => s.name === name)?.role || "Servers";
  }

  // The swap acts on whichever day the glance box is showing, so the modal
  // carries that date rather than assuming today (brief item 7).
  function openSwap(entry) {
    setSwapModal({ ...entry, dateIso: glanceIso });
    setSwapForm({ withName: "", shift: "", note: "", removeOnly: false });
  }

  // ---- Day-of changes -----------------------------------------------------
  // Someone leaves early, comes in unscheduled, or no-shows. Tip Sheet add /
  // remove and the Today at a Glance swap / remove-only all come through
  // applyDayOfChange, which only ever writes DATED schedule_overrides (no
  // railId). staffWorkingOn reads those, so the Tip Sheet, Today at a Glance
  // and the Calendar all move together — nothing freezes names the way Custom
  // Schedule does. The Set Schedule grid never reads overrides, so the planned
  // week stays exactly as built; a marker on the cell (dayOfChangeFor) plus a
  // note on the week and on the date say what changed instead.
  //
  // Supabase-js can't wrap two client writes in a transaction, so if the
  // second write fails the first is put back rather than leaving the day half
  // changed.
  async function applyDayOfChange({ dateIso, removeName = null, addName = null, addCode = null, reason = "" }) {
    const removeId = removeName ? nameToId[removeName] : null;
    const addId = addName ? nameToId[addName] : null;
    if ((removeName && !removeId) || (addName && !addId)) {
      throw new Error("live staff records haven't loaded for one of these people");
    }
    const prevOverrides = overrides;
    const isTipDate = dateIso === tipDateIso;
    // Tip times are stored per slot, and a removal shifts people between
    // slots — carry each person's typed times to wherever they land.
    if (isTipDate) tipTimesRemapRef.current = tipTimesByName();
    const written = [];
    try {
      if (removeName) {
        await upsertScheduleOverride({ staffId: removeId, dateIso, overrideType: "OFF", isSwap: false, railRequestId: null });
        written.push([removeName, removeId]);
      }
      if (addName) {
        await upsertScheduleOverride({ staffId: addId, dateIso, overrideType: addCode, isSwap: !!removeName, railRequestId: null });
        written.push([addName, addId]);
      }
    } catch (e) {
      // A null type falls through to the planned pattern, so this restores
      // "no override" as well as a previous one.
      for (const [n, id] of written) {
        const prev = prevOverrides[`${n}|${dateIso}`];
        await upsertScheduleOverride({
          staffId: id, dateIso, overrideType: prev?.type ?? null, isSwap: !!prev?.swap, railRequestId: prev?.railId ?? null,
        }).catch(() => {});
      }
      if (isTipDate) tipTimesRemapRef.current = null;
      throw e;
    }
    setOverrides((o) => ({
      ...o,
      ...(removeName ? { [`${removeName}|${dateIso}`]: { type: "OFF", swap: false, railId: null } } : {}),
      ...(addName ? { [`${addName}|${dateIso}`]: { type: addCode, swap: !!removeName, railId: null } } : {}),
    }));
    const note = dayOfNoteText({ dateIso, removeName, addName, addCode, reason });
    await writeDayOfNotes(dateIso, note, addId || removeId);
    addLog(note, "good");
    return note;
  }

  // "Sep 24 — Ivy removed from shift (left early)" /
  // "Sep 24 — Miguel added, Busser/Runner 5pm-CL" /
  // "Sep 24 — Ivy off, Miguel on Busser/Runner 5pm-CL"
  function dayOfNoteText({ dateIso, removeName, addName, addCode, reason }) {
    const shift = addCode ? roleShiftText(roleFromCode(addCode), addCode) : "";
    const body = removeName && addName ? `${removeName} off, ${addName} on ${shift}`
      : removeName ? `${removeName} removed from shift`
      : `${addName} added, ${shift}`;
    const why = String(reason || "").trim();
    return `${shortDate(dateIso)} — ${body}${why ? ` (${why})` : ""}`;
  }

  // "Busser/Runner 5pm-CL", "Server 4pm-FC" — but plain "Expo 5pm" / "Host
  // 4pm", whose shift labels already name the role.
  function roleShiftText(role, code) {
    const label = shiftLabelForType(code);
    const r = role === "Servers" ? "Server" : role;
    if (!r || label.toLowerCase().startsWith(r.toLowerCase())) return label;
    return `${r} ${label}`;
  }

  // The same text on the week's Notes panel and on the date's Calendar page —
  // ordinary rows, so both stay editable and deletable. A failed note never
  // undoes the schedule change that already landed.
  async function writeDayOfNotes(dateIso, text, staffId) {
    const ws = iso(mondayOf(new Date(`${dateIso}T00:00:00`)));
    try {
      const row = await insertScheduleNote({ weekStartIso: ws, note: text, staffId: staffId || null, source: "dayof" });
      if (row) setNotesByWeek((prev) => ({ ...prev, [ws]: [row, ...(prev[ws] || [])] }));
    } catch (e) {
      console.error("Day-of week note failed:", e);
      addLog("Schedule changed, but the week note didn't save", "warn");
    }
    try {
      const row = await insertCalendarNote(dateIso, text);
      if (row) setCalNotes((m) => ({ ...m, [dateIso]: [...(m[dateIso] || []), row] }));
    } catch (e) {
      console.error("Day-of calendar note failed:", e);
      addLog("Schedule changed, but the Calendar date note didn't save", "warn");
    }
  }

  // Today at a Glance: replace the person, or with "Remove only" take them off
  // with no replacement (brief item 3). Same override + note path as the Tip
  // Sheet.
  async function confirmSwap() {
    if (!swapModal || swapBusy) return;
    const outName = swapModal.name;
    const removeOnly = !!swapForm.removeOnly;
    const inName = removeOnly ? null : swapForm.withName;
    const code = removeOnly ? null : swapForm.shift;
    if (!removeOnly && (!inName || !code)) return;

    // Older modals (opened before this field existed) fall back to today.
    const dateIso = swapModal.dateIso || TODAY_ISO;
    const dateLabel = new Date(`${dateIso}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    const ok = window.confirm(removeOnly
      ? `Remove ${outName} from ${dateLabel}? They come off the Tip Sheet, Today at a Glance and the Calendar for that date. The planned schedule is unchanged.`
      : `Replace ${outName} with ${inName} (${shiftLabelForType(code)}) on ${dateLabel}? This updates the Tip Sheet, Today at a Glance and the Calendar for that date. The planned schedule is unchanged.`);
    if (!ok) return;

    setSwapBusy(true);
    try {
      await applyDayOfChange({ dateIso, removeName: outName, addName: inName, addCode: code, reason: swapForm.note });
      setSwapModal(null);
    } catch (e) {
      console.error("Swap failed:", e);
      window.alert(`Couldn't save the change: ${e.message || e}`);
    }
    setSwapBusy(false);
  }

  // ---- Manage Shifts (brief item 3) ---------------------------------------
  async function handleAddShiftOption(role) {
    const label = shiftAddLabel.trim();
    if (!label) return;
    const current = roleOptions[role] || [];
    if (current.some((o) => o.label.toLowerCase() === label.toLowerCase())) {
      setShiftMsg(`${role} already has a "${label}" option.`);
      return;
    }
    const code = shiftCodeFor(role, label, current.map((o) => o.code));
    const sortOrder = current.length;
    // Optimistic: the dropdowns pick it up immediately, and we roll back if the
    // write fails so the UI never claims an option that isn't saved.
    setRoleOptions((prev) => ({ ...prev, [role]: [...(prev[role] || []), { code, label }] }));
    setShiftAddLabel("");
    setShiftAddRole(null);
    setShiftMsg("");
    try {
      await insertRoleShiftOption({ role, code, label, sortOrder });
      setShiftMsg(looksLikeOffLabel(label)
        ? `Added "${label}" to ${role}. If it means off, tick "Counts as off" on it.`
        : `Added "${label}" to ${role}.`);
    } catch (e) {
      console.error("Add shift option failed:", e);
      setRoleOptions((prev) => ({ ...prev, [role]: (prev[role] || []).filter((o) => o.code !== code) }));
      setShiftMsg(`Couldn't add "${label}": ${e.message || e}`);
    }
  }
  // "Counts as off" checkbox. Optimistic; rolls back if the write fails.
  async function toggleShiftOptionOff(role, code, label, isOff) {
    const flip = (v) => setRoleOptions((prev) => ({
      ...prev,
      [role]: (prev[role] || []).map((o) => (o.code === code ? { ...o, isOff: v } : o)),
    }));
    flip(isOff);
    setShiftMsg("");
    try {
      await setShiftOptionOff(role, code, isOff);
    } catch (e) {
      console.error("Counts-as-off update failed:", e);
      flip(!isOff);
      setShiftMsg(`Couldn't update "${label}": ${e.message || e}`);
    }
  }
  async function handleRemoveShiftOption(role, code, label) {
    if (code === "OFF") return; // Off is structural, not a real shift
    const prevList = roleOptions[role] || [];
    setRoleOptions((prev) => ({ ...prev, [role]: (prev[role] || []).filter((o) => o.code !== code) }));
    setShiftMsg("");
    try {
      await deleteRoleShiftOption(role, code);
      setShiftMsg(`Removed "${label}" from ${role}. Shifts already scheduled with it are unchanged.`);
    } catch (e) {
      console.error("Remove shift option failed:", e);
      setRoleOptions((prev) => ({ ...prev, [role]: prevList }));
      setShiftMsg(`Couldn't remove "${label}": ${e.message || e}`);
    }
  }

  async function handleAddNote() {
    const text = noteDraft.trim();
    const ws = notesWeek;
    if (!text || !ws) return;
    setNoteDraft("");
    try {
      const row = await insertScheduleNote({ weekStartIso: ws, note: text });
      if (row) {
        setNotesByWeek((prev) => ({ ...prev, [ws]: [row, ...(prev[ws] || [])] }));
      }
    } catch (e) {
      console.error("Add note failed:", e);
      setNoteDraft(text); // hand it back rather than losing what they typed
    }
  }
  async function handleSaveNoteEdit(id) {
    const text = noteEditText.trim();
    const ws = notesWeek;
    if (!text || !ws) return;
    setNoteEditId(null);
    setNotesByWeek((prev) => ({
      ...prev,
      [ws]: (prev[ws] || []).map((n) => (n.id === id ? { ...n, note: text } : n)),
    }));
    try { await updateScheduleNote(id, text); }
    catch (e) { console.error("Edit note failed:", e); reloadNotes(ws); }
  }
  async function handleDeleteNote(id) {
    const ws = notesWeek;
    if (!ws) return;
    setNotesByWeek((prev) => ({
      ...prev,
      [ws]: (prev[ws] || []).filter((n) => n.id !== id),
    }));
    try { await deleteScheduleNote(id); }
    catch (e) { console.error("Delete note failed:", e); reloadNotes(ws); }
  }

  const tipWorking = useMemo(() => {
    const all = staffWorkingOn(tipDateIso);
    return { ...all, working: all.working.filter(onTipSheet) };
  }, [tipDateIso, fohRoster, patterns, weeklyPatterns, placeholderPatterns, weeklyPlaceholders, groupRosters, overrides, railOffByDate, staffList, offCodes]);
  const autoSlots = useMemo(() => autoAssignSlots(tipWorking.working), [tipWorking]);

  function toggleCustomMode() {
    if (!customMode) {
      const seed = {};
      autoSlots.forEach((slot) => {
        seed[slot.id] = { name: slot.autoName, pts: slot.role === "Host" ? (coversNum > 80 ? slot.defaultPts : 0) : slot.defaultPts };
      });
      setSlotOverrides(seed);
    }
    setCustomMode((m) => !m);
  }
  function setSlotName(slotId, value) {
    setSlotOverrides((o) => ({ ...o, [slotId]: { ...o[slotId], name: value } }));
  }
  function setSlotPts(slotId, value) {
    setSlotOverrides((o) => ({ ...o, [slotId]: { ...o[slotId], pts: parseFloat(value) || 0 } }));
  }
  function getTimes(slotId) {
    return tipTimes[slotId] || { in: "", out: "" };
  }
  function setSlotTime(slotId, field, value) {
    setTipTimes((tt) => ({ ...tt, [slotId]: { ...getTimes(slotId), [field]: value } }));
  }

  // Nobody marked off for this date may occupy a tip slot. autoAssignSlots
  // already drops them on the way in, but a saved Custom Schedule bypasses it
  // entirely: slot_overrides freeze whoever was on the schedule the night the
  // sheet was first opened, and customMode switches itself back on whenever a
  // saved row has any. Approve a Rail Request Off after that and the stale name
  // stays in the slot, earning a full point. This is the last gate before the
  // math, so blanking here also keeps them out of every total, the floor check,
  // the emailed rows and the PDF.
  //
  // Only names that belong to a real staff member are checked — a slot typed
  // with someone not on the roster has no schedule to read, so it stands.
  // Everyone else has to be working the date per staffWorkingOn.
  const tipRosterNames = new Set(staffList.map((s) => s.name));
  const tipWorkingNames = new Set(tipWorking.working.map((w) => w.name));
  function offForTipDate(name) {
    if (!name || !tipRosterNames.has(name)) return false;
    return !tipWorkingNames.has(name);
  }

  const slotsExcludedOff = [];
  const displaySlots = autoSlots.map((slot) => {
    const ov = slotOverrides[slot.id];
    let name = customMode && ov?.name !== undefined ? ov.name : slot.autoName;
    if (offForTipDate(name)) {
      slotsExcludedOff.push(name);
      name = "";
    }
    let pts = null;
    if (name) {
      pts = slot.role === "Host" ? (coversNum > 80 ? slot.defaultPts : 0) : slot.defaultPts;
      if (customMode && ov?.pts !== undefined) pts = ov.pts;
    }
    const t = getTimes(slot.id);
    const hours = hoursBetween(t.in, t.out);
    return { ...slot, name, pts, hours };
  });

  // ---- Tip Sheet day-of add / remove --------------------------------------
  // Clock times are keyed by slot, but removing Server 1 slides everyone up a
  // slot. applyDayOfChange snapshots name -> times first; once the slots
  // re-resolve, each person's times follow them (a removed person's go too).
  const tipTimesRemapRef = useRef(null);
  function tipTimesByName() {
    const m = {};
    displaySlots.forEach((s) => { if (s.name && tipTimes[s.id]) m[s.name] = tipTimes[s.id]; });
    return m;
  }
  useEffect(() => {
    const byName = tipTimesRemapRef.current;
    if (!byName) return;
    tipTimesRemapRef.current = null;
    const next = {};
    autoSlots.forEach((s) => { if (s.autoName && byName[s.autoName]) next[s.id] = byName[s.autoName]; });
    setTipTimes(next);
  }, [autoSlots]);

  // Custom Schedule types names by hand, and a locked / sent sheet is
  // read-only, so neither offers add / remove.
  const tipDayOfAllowed = !customMode && !tipFinalized && !tipLocked;
  // Roles with a tip slot (Training isn't tipped).
  const TIP_ADD_ROLES = ["Servers", "Busser/Runner", "Expo", "Host", "Bar"];
  const slotRoleFor = (role) => (role === "Expo" ? "Expo (Fri–Sun)" : role);

  function openDayOfRemove(name) {
    setDayOfError(null);
    setDayOfForm({ name, role: "", shift: "", reason: "" });
    setDayOfModal({ mode: "remove", dateIso: tipDateIso, name });
  }
  function openDayOfAdd() {
    setDayOfError(null);
    setDayOfForm({ name: "", role: "", shift: "", reason: "" });
    setDayOfModal({ mode: "add", dateIso: tipDateIso });
  }
  // Default the role to the first tipped role the person already works.
  function pickDayOfStaff(name) {
    const role = (staffRolesMap[name] || []).find((r) => TIP_ADD_ROLES.includes(r)) || "Servers";
    setDayOfForm((f) => ({ ...f, name, role, shift: "" }));
  }
  // Adding into a role whose slots are all taken would leave the person off
  // the sheet (slot order is by start time), so say so instead.
  function dayOfSlotsFull(role) {
    const slotRole = slotRoleFor(role);
    const capacity = SLOTS.filter((s) => s.role === slotRole).length;
    const filled = autoSlots.filter((s) => s.role === slotRole && s.autoName).length;
    return filled >= capacity;
  }
  async function confirmDayOf() {
    if (!dayOfModal || dayOfBusy) return;
    const { mode, dateIso, name } = dayOfModal;
    setDayOfBusy(true);
    setDayOfError(null);
    try {
      if (mode === "remove") {
        await applyDayOfChange({ dateIso, removeName: name, reason: dayOfForm.reason });
      } else {
        await applyDayOfChange({ dateIso, addName: dayOfForm.name, addCode: dayOfForm.shift, reason: dayOfForm.reason });
      }
      setDayOfModal(null);
    } catch (e) {
      console.error("Day-of change failed:", e);
      setDayOfError(`Couldn't save the change: ${e.message || e}`);
    }
    setDayOfBusy(false);
  }

  const floorPool = (parseFloat(floorCash) || 0) + (parseFloat(floorCredit) || 0);
  const barPool = (parseFloat(barCash) || 0) + (parseFloat(barCredit) || 0);
  function setCount(which, denom, value) {
    const setter = which === "open" ? setOpeningCounts : setClosingCounts;
    setter((c) => ({ ...c, [denom]: value }));
  }
  function addPayout() {
    setPayoutItems((items) => [...items, { id: `p-${Date.now()}`, desc: "", amount: "" }]);
  }
  function updatePayout(id, field, value) {
    setPayoutItems((items) => items.map((it) => (it.id === id ? { ...it, [field]: value } : it)));
  }
  function removePayout(id) {
    setPayoutItems((items) => items.filter((it) => it.id !== id));
  }

  const openingBankTotal = denomTotal(openingCounts);
  const closingBankTotal = denomTotal(closingCounts);
  const payoutsTotal = payoutItems.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0);

  // Off → $0 tip-out, so barShareEach is 0 and the bar keeps its full pool.
  const barTipOutTotal = barTipOutOn ? barPool * 0.1 : 0;

  const totalCashSumPayouts = (parseFloat(closingSum) || 0) + payoutsTotal;
  const minusCashSales = totalCashSumPayouts - (parseFloat(cashSales) || 0);
  const cashTipsEarned = minusCashSales - openingBankTotal;

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

  function shiftTipDate(delta) {
    const d = new Date(tipDateInfo.dateObj);
    d.setDate(d.getDate() + delta);
    setTipDateIso(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    // sent / sent_at come from the new date's own row (see the load effect) —
    // they aren't cleared here any more.
  }

  // Shared tip_sheets row payload; `extra` overrides/adds columns (sent, finalized…).
  function tipPayload(extra = {}) {
    return {
      date: tipDateIso,
      floor_cash: numOrNull(floorCash),
      floor_credit: numOrNull(floorCredit),
      bar_cash: numOrNull(barCash),
      bar_credit: numOrNull(barCredit),
      covers: numOrNull(covers),
      opening_counts: openingCounts,
      closing_counts: closingCounts,
      payouts: payoutItems,
      cash_sales: numOrNull(cashSales),
      closing_sum: numOrNull(closingSum),
      slot_overrides: customMode ? slotOverrides : {},
      time_entries: tipTimes,
      bar_tip_out: barTipOutOn,
      ...extra,
    };
  }

  // ---- Tip Sheet save + autosave (brief item 3) ---------------------------
  // The sheet used to reach Supabase only on Finalize / Lock / Send, so a refresh
  // mid-count lost the night's numbers. Every field in tipPayload() is
  // serialized into a key; when the key drifts from the last-saved baseline the
  // sheet is dirty and a 2s debounce flushes it. The payload is snapshotted when
  // the timer is set, so moving to another date mid-debounce still writes those
  // edits to the date they were made on.
  const tipFormKey = useMemo(
    () => JSON.stringify([
      floorCash, floorCredit, barCash, barCredit, covers,
      openingCounts, closingCounts, closingSum, payoutItems, cashSales,
      customMode ? slotOverrides : {}, tipTimes, barTipOutOn,
    ]),
    [floorCash, floorCredit, barCash, barCredit, covers, openingCounts, closingCounts,
     closingSum, payoutItems, cashSales, customMode, slotOverrides, tipTimes, barTipOutOn]
  );
  const tipBaselineRef = useRef(null);   // tipFormKey as last written / last loaded
  const tipBaselineSeqRef = useRef(-1);  // which tipLoadSeq that baseline belongs to
  const tipFormKeyRef = useRef(tipFormKey);

  // Write one snapshot. `key` is the form key that snapshot represents — it
  // becomes the new baseline, and the status only reads "Saved" if the form
  // hasn't moved on while the write was in flight.
  async function flushTipSheet(snapshot, key) {
    setTipSaveState("saving");
    try {
      await upsertTipSheet(snapshot);
      tipBaselineRef.current = key;
      setTipSaveState(key === tipFormKeyRef.current ? "saved" : "dirty");
      return true;
    } catch (e) {
      console.error("Tip sheet save failed:", e);
      setTipSaveState("error");
      return false;
    }
  }
  async function saveTipSheetNow() {
    if (tipSaveState === "saving") return;
    await flushTipSheet(tipPayload(), tipFormKey);
  }

  useEffect(() => {
    tipFormKeyRef.current = tipFormKey;
    if (tipBaselineSeqRef.current !== tipLoadSeq) {
      tipBaselineSeqRef.current = tipLoadSeq;
      tipBaselineRef.current = tipFormKey;
      setTipSaveState("saved");
      return;
    }
    if (tipFormKey === tipBaselineRef.current) return;
    setTipSaveState("dirty");
    const snapshot = tipPayload(); // captured now, including this date
    const key = tipFormKey;
    const t = setTimeout(() => { flushTipSheet(snapshot, key); }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [tipFormKey, tipLoadSeq]);

  // ---- Set Schedule save state (brief item 3) -----------------------------
  // Set Schedule already writes each cell straight through to Supabase as you
  // click it, so there is nothing to debounce — the indicator tracks those
  // writes instead: dirty the instant a cell changes, saving while a write is in
  // flight, saved when the last one lands. The Save button re-writes the whole
  // displayed week, which also covers a cell whose earlier write failed.
  const schedInflightRef = useRef(0);
  const schedFailedRef = useRef(false);
  function schedSaveStart() {
    schedInflightRef.current += 1;
    setSchedSaveState("saving");
  }
  function schedSaveEnd(ok) {
    if (!ok) schedFailedRef.current = true;
    schedInflightRef.current = Math.max(0, schedInflightRef.current - 1);
    if (schedInflightRef.current === 0) {
      setSchedSaveState(schedFailedRef.current ? "error" : "saved");
      schedFailedRef.current = false;
    }
  }
  // Explicit Save: push the week on screen in full — FOH patterns and the
  // BOH/Kitchen/Management placeholder rows — rather than just the last cell.
  async function saveScheduleNow() {
    if (schedSaveState === "saving") return;
    const ws = activeWeekStart;
    schedSaveStart();
    let ok = false;
    try {
      // Both, not short-circuited — a week can have FOH rows and no placeholder
      // rows (or the other way round) and we want each attempted.
      const wroteFoh = await seedWeeklySchedule(ws, activePatterns, nameToId);
      const wroteGroups = await seedWeeklyPlaceholders(ws, activePlaceholders, groupRosters);
      ok = wroteFoh && wroteGroups;
      if (ok) {
        // The week now has its own complete record, so later template edits
        // can't leak into it — the invariant writeCellShift's first-edit seed
        // sets up.
        setWeeklyPatterns((prev) => (prev[ws] ? prev : { ...prev, [ws]: activePatterns }));
        setWeeklyPlaceholders((prev) => (prev[ws] ? prev : { ...prev, [ws]: activePlaceholders }));
      }
    } catch (e) {
      console.error("Save schedule failed:", e);
      ok = false;
    }
    schedSaveEnd(ok);
  }

  // Warn before leaving with work that hasn't reached Supabase (brief item 3).
  useEffect(() => {
    if (!isUnsaved(tipSaveState) && !isUnsaved(schedSaveState)) return;
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [tipSaveState, schedSaveState]);

  // ---- Send Tip Sheet (brief item 5) --------------------------------------
  // Everyone who worked that night, in slot order, with the email we'd use.
  // Staff without one are listed too, flagged as skipped, so the manager can see
  // who won't get it rather than finding out afterwards.
  const tipSendRoster = useMemo(() => {
    const seen = new Set();
    const out = [];
    finalSlots.forEach((p) => {
      if (!p.name || seen.has(p.name)) return;
      seen.add(p.name);
      const staff = staffList.find((st) => st.name === p.name);
      const email = staff && staff.registered && staff.personal_email ? staff.personal_email : null;
      out.push({ name: p.name, position: p.label, email, payout: money(p.final || 0) });
    });
    return out;
  }, [finalSlots, staffList]);

  const tipSendDayLabel = tipDateInfo.dateObj.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  // "" for a sheet sent before sent_at existed, so the button just reads "Sent ✓".
  const tipSentAtLabel = tipSentAt
    ? new Date(tipSentAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "";
  const tipSendChosen = tipSendRoster.filter((r) => r.email && !tipSendExcluded.includes(r.name));
  // "09/24/26" — the default subject is "Tip sheet 09/24/26".
  const tipSendShortDate = `${tipDateIso.slice(5, 7)}/${tipDateIso.slice(8, 10)}/${tipDateIso.slice(2, 4)}`;

  // A sheet that already went out asks before opening the screen again, so a
  // stray click on "Sent ✓" can't start a second round of emails (brief item 1).
  function openTipSendModal() {
    if (tipSent && !window.confirm(
      `This tip sheet was already sent${tipSentAtLabel ? ` at ${tipSentAtLabel}` : ""}. Send it again?`
    )) return;
    setTipSendSubject(`Tip sheet ${tipSendShortDate}`);
    setTipSendNotes("");
    setTipSendExcluded([]);
    setTipSendResult(null);
    setTipSendOpen(true);
    refreshGmailStatus(); // so a dead token shows before Confirm, not after
  }
  function toggleTipRecipient(name) {
    setTipSendExcluded((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  }

  // The only path that emails. Since Finalize is gone (brief item 1), a
  // successful send is also what finalizes and locks the sheet — one action, one
  // write. The tip math is untouched; the subject, the notes block and the
  // recipient list are what the manager confirmed on the send screen.
  //
  // The email is the Save as PDF page attached, with only the manager's notes
  // (then the sign-off) as the body. The PDF is built first: if that fails
  // nothing is emailed, and the error stays in the modal so they can retry.
  async function confirmSendTipSheet() {
    if (tipSendBusy || !tipSendChosen.length) return;
    setTipSendBusy(true);
    setTipSendResult(null);
    let pdfB64;
    try {
      pdfB64 = pdfToBase64(await renderTipSheetPdf());
    } catch (e) {
      console.error("Tip sheet PDF for email failed:", e);
      setTipSendBusy(false);
      setTipSendResult(`the PDF couldn't be generated (${e.message || e}) — nothing was sent. Try again.`);
      return;
    }
    const res = await triggerTipSheetSend({
      dayDateLabel: tipSendDayLabel,
      subject: tipSendSubject.trim(),
      notes: tipSendNotes.trim(),
      attachment: { filename: tipSheetPdfFilename, b64: pdfB64 },
      recipients: tipSendChosen.map((r) => ({ name: r.name, email: r.email })),
    }, session?.access_token);
    setTipSendBusy(false);
    if (res?.error) {
      setTipSendResult(res.needsReconnect ? null : res.error);
      addLog(`Tip sheet send failed (${res.needsReconnect ? "Gmail disconnected — reconnect" : res.error})`, "warn");
      if (res.needsReconnect) refreshGmailStatus();
      return;
    }
    const now = new Date().toISOString();
    setTipSendOpen(false);
    setTipSent(true);
    setTipSentAt(now);
    setTipFinalized(true);
    setTipFinalizedAt(now);
    setTipLocked(true);
    setTipLockedAt(now);
    addLog(
      `Tip sheet sent — ${tipDateInfo.dateObj.toLocaleDateString(undefined, MONTH_FMT)} — emailed ${res?.sent ?? 0} staff, sheet finalized and locked`,
      "good"
    );
    try {
      await upsertTipSheet(tipPayload({
        sent: true, sent_at: now,
        finalized: true, finalized_at: now,
        locked: true, locked_at: now,
      }));
    } catch (e) {
      console.error("Save tip sheet failed:", e);
      addLog("Emails went out but the sheet's sent/locked state didn't save — run migration 0015?", "warn");
    }
  }

  // Lock, pressed again to unlock — the only way to freeze or reopen a date
  // without emailing anyone (brief item 1). Unlocking also clears finalized:
  // sending is what sets finalized now, so a reopened sheet has to be genuinely
  // editable again rather than finalized-but-unlocked. Optimistic, rolled back
  // if the write fails so the button can't show a lock that didn't save.
  async function toggleTipLock() {
    if (tipLockBusy) return;
    const next = !tipLocked;
    if (!next && tipFinalized &&
        !window.confirm("Unlock this tip sheet for edits? It stops counting as finalized. Emails already sent are not recalled.")) return;
    const at = next ? new Date().toISOString() : null;
    const prevFinalized = tipFinalized;
    const prevFinalizedAt = tipFinalizedAt;
    setTipLockBusy(true);
    setTipLocked(next);
    setTipLockedAt(at);
    if (!next) { setTipFinalized(false); setTipFinalizedAt(null); }
    try {
      await upsertTipSheet(tipPayload(
        next ? { locked: true, locked_at: at }
             : { locked: false, locked_at: null, finalized: false, finalized_at: null }
      ));
      addLog(`Tip sheet ${next ? "locked" : "unlocked"} — ${shortDate(tipDateIso)}`, next ? "warn" : "good");
    } catch (e) {
      console.error("Tip lock save failed:", e);
      setTipLocked(!next);
      setTipLockedAt(next ? null : tipLockedAt);
      setTipFinalized(prevFinalized);
      setTipFinalizedAt(prevFinalizedAt);
      addLog(`Couldn't ${next ? "lock" : "unlock"} the tip sheet — run migration 0013?`, "warn");
    }
    setTipLockBusy(false);
  }

  const weeks = useMemo(() => buildMonth(calDate), [calDate]);
  const threeMonthWeeks = useMemo(() => {
    if (calMonthView !== 3) return [];
    return [0, 1, 2].map((monthIdx) => {
      const monthDate = new Date(calDate.getFullYear(), calDate.getMonth() + monthIdx, 1);
      return buildMonth(monthDate);
    });
  }, [calDate, calMonthView]);
  // weekIndex is an offset from the current week, so 0 is always "this week".
  const onCurrentWeek = weekIndex === 0;
  const weekStrip = useMemo(() => getWeekStrip(), []);
  const [scheduleView, setScheduleView] = useState("foh");
  // Locking is per section AND per week, each combination independent: locking
  // FOH for Jul 27 leaves BOH+Kitchen that week, and FOH every other week,
  // untouched. Held as a Set of "weekStart|sectionKey" and persisted to
  // schedule_weeks, so navigating away and back shows that week's own state.
  const [lockedSectionWeeks, setLockedSectionWeeks] = useState(new Set());
  const lockKeyFor = (weekStartIso, sectionKey) => `${weekStartIso}|${sectionKey}`;
  const isSectionLocked = (weekStartIso, sectionKey) => lockedSectionWeeks.has(lockKeyFor(weekStartIso, sectionKey));
  const scheduleLocked = isSectionLocked(activeWeekStart, scheduleView); // week + sub-tab on screen
  // Look-back limit (brief item 2): Set Schedule reaches 2 weeks back and no
  // further; older weeks are Calendar territory. Those past weeks are visible
  // but frozen — a week that has already been worked isn't something to edit.
  // Forward navigation is unlimited.
  const schedulePastWeek = weekIndex < 0;
  const atOldestScheduleWeek = weekIndex <= -SCHEDULE_LOOKBACK_WEEKS;
  // One flag for "these cells don't take input", whatever the reason.
  const scheduleFrozen = scheduleLocked || schedulePastWeek;
  // Which lock applies to a given placeholder group.
  const groupLockKey = (groupKey) => (groupKey === "management" ? "management" : "bohkitchen");
  const [finalizedWeeks, setFinalizedWeeks] = useState(new Set()); // { "2026-07-13" }
  const [loadError, setLoadError] = useState("");
  const [publishedWeekStarts, setPublishedWeekStarts] = useState(new Set());
  const [publishedAtByWeek, setPublishedAtByWeek] = useState({}); // weekStart -> iso
  const [finalizeBusy, setFinalizeBusy] = useState(false);

  // Load everything from Supabase on mount. DB values win where present;
  // anything the DB doesn't have falls back to the seed constants so the UI is
  // never blank/undefined during development.
  useEffect(() => {
    let cancelled = false;
    fetchInitial()
      .then((d) => {
        if (cancelled) return;
        setNameToId(d.nameToId);
        if (d.staff.length) setStaffList(d.staff);

        // roles + options from the DB when migration 0002 has been applied
        let rolesByName = DEFAULT_STAFF_ROLES;
        if (d.staffRoles && d.staffRoles.length) {
          setRolesTableReady(true);
          const byName = {};
          const rosters = { boh: [], kitchen: [], management: [] };
          d.staffRoles.forEach((r) => {
            const name = d.idToName[r.staff_id];
            if (!name) return;
            if (!byName[name]) byName[name] = [];
            if (r.is_primary) byName[name].unshift(r.role);
            else byName[name].push(r.role);
            Object.entries(GROUP_ROLE).forEach(([gk, roleName]) => {
              if (r.role === roleName) rosters[gk].push({ name, sort: r.sort_order });
            });
          });
          rolesByName = byName;
          setStaffRolesMap(byName);
          const rosterNames = {};
          Object.entries(rosters).forEach(([gk, list]) => {
            rosterNames[gk] = list.sort((a, b) => a.sort - b.sort).map((x) => x.name);
          });
          if (rosterNames.boh.length) setGroupRosters(rosterNames);
        }
        if (d.roleOptions) setRoleOptions((prev) => ({ ...prev, ...d.roleOptions }));

        // primary role per name, for normalizing any pre-redesign shift codes
        const primaryByName = { ...DEFAULT_PRIMARY_ROLE };
        d.staff.forEach((s) => { primaryByName[s.name] = (rolesByName[s.name] || [])[0] || s.role; });

        if (Object.keys(d.patterns).length) {
          setPatterns((prev) => ({ ...prev, ...normalizePatterns(d.patterns, primaryByName) }));
        }
        if (Object.keys(d.placeholders).length) {
          const ph = { ...d.placeholders };
          // Management simplified to Off <-> FM: any legacy scheduled value = FM.
          // Expo codes are real (a manager scheduled as Expo) and stay as-is.
          if (ph.management) {
            ph.management = ph.management.map((row) => row.map((c) => (c === "OFF" || roleFromCode(c) === "Expo" ? c : "FM")));
          }
          setPlaceholderPatterns((prev) => ({ ...prev, ...ph }));
        }
        setOverrides(d.overrides);
        setPending(d.rail.pending);
        setResolvedReqs(d.rail.resolved);
        setArchivedReqs(d.rail.archived || []);
        setLog(
          d.rail.resolved.map((r) => ({
            id: r.id,
            text: `${r.status === "approved" ? "Approved" : "Denied"} ${r.name} — ${TYPE_STYLES[r.type]?.label || r.type}, ${r.dates}`,
            time: new Date(r.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
            at: r.created_at,
            tone: r.status === "approved" ? "good" : "warn",
          }))
        );
      })
      .catch((e) => {
        console.error("Initial load failed:", e);
        setLoadError(e.message || "Could not load data from Supabase.");
      });
    return () => { cancelled = true; };
  }, []);

  // Gmail connection status for the Rail indicator (harmless if /api is absent).
  useEffect(() => {
    let cancelled = false;
    fetchGmailStatus().then((s) => { if (!cancelled) setGmailStatus(s); });
    return () => { cancelled = true; };
  }, []);

  // Reconnecting happens in another tab (/api/auth/start), so while the
  // mailbox reads as disconnected, re-check whenever this tab regains focus —
  // the red state clears on its own once the new grant is saved.
  useEffect(() => {
    if (!gmailDisconnected) return;
    const onFocus = () => { refreshGmailStatus(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [gmailDisconnected]);

  // Calendar date notes — one fetch drives both the popup and the month dots.
  useEffect(() => {
    let cancelled = false;
    fetchCalendarNotes()
      .then((m) => { if (!cancelled) setCalNotes(m); })
      .catch((e) => console.error("Calendar notes load failed:", e));
    return () => { cancelled = true; };
  }, []);

  // ---- Persistent, global Rail clears (brief item 1) ----------------------
  // The watermarks live in rail_view_state, one row per list, shared by every
  // manager. Pre-migration the fetch returns nulls and Clear falls back to the
  // old session-only behaviour rather than erroring.
  useEffect(() => {
    let cancelled = false;
    fetchRailViewState()
      .then((s) => { if (!cancelled) setRailCleared(s); })
      .catch((e) => console.error("Rail view state load failed:", e));
    return () => { cancelled = true; };
  }, []);

  // Everything created at or before the watermark is hidden. Entries with no
  // timestamp (shouldn't happen — addLog stamps them) are kept rather than
  // silently dropped.
  const visibleLog = useMemo(
    () => (railCleared.auto_log ? log.filter((e) => !e.at || e.at > railCleared.auto_log) : log),
    [log, railCleared.auto_log]
  );
  const visibleResolved = useMemo(
    () => (railCleared.resolved ? resolvedReqs.filter((r) => !r.created_at || r.created_at > railCleared.resolved) : resolvedReqs),
    [resolvedReqs, railCleared.resolved]
  );

  // Press Clear -> watermark moves to now. Pass null to unhide the list again.
  // Optimistic: the UI hides immediately, and a failed write only means the
  // clear won't survive a refresh (logged, never silently swallowed).
  async function setRailClearWatermark(list, clearedAt) {
    if (railClearBusy) return;
    setRailClearBusy(list);
    setRailCleared((prev) => ({ ...prev, [list]: clearedAt }));
    try {
      const ok = await persistRailCleared(list, clearedAt, session?.user?.id || null);
      if (!ok) console.warn(`Rail clear not persisted (run migration 0014?) — ${list}`);
    } catch (e) {
      console.error("Rail clear save failed:", e);
    }
    setRailClearBusy(null);
  }

  // ---- General notes for the Rail Notes box (brief item 2) ----------------
  useEffect(() => {
    let cancelled = false;
    fetchGeneralNotes()
      .then((rows) => { if (!cancelled) setGenNotes(rows); })
      .catch((e) => console.error("General notes load failed:", e));
    return () => { cancelled = true; };
  }, []);

  async function addGeneralNote() {
    const text = genNoteDraft.trim();
    if (!text || genNoteBusy) return;
    setGenNoteBusy(true);
    setGenNoteDraft("");
    try {
      const row = await insertGeneralNote(text);
      if (row) setGenNotes((prev) => [...prev, row]);
    } catch (e) {
      console.error("Add note failed:", e);
      setGenNoteDraft(text); // hand the text back rather than losing it
    }
    setGenNoteBusy(false);
  }
  async function saveGeneralNoteEdit(id) {
    const text = genNoteEditText.trim();
    if (!text) return;
    setGenNotes((prev) => prev.map((n) => (n.id === id ? { ...n, note: text } : n)));
    setGenNoteEditId(null);
    try { await updateGeneralNote(id, text); }
    catch (e) { console.error("Edit note failed:", e); }
  }
  async function removeGeneralNote(id) {
    const prev = genNotes;
    setGenNotes((list) => list.filter((n) => n.id !== id));
    if (genNoteEditId === id) setGenNoteEditId(null);
    try { await deleteGeneralNote(id); }
    catch (e) { console.error("Delete note failed:", e); setGenNotes(prev); }
  }

  async function addCalendarNote(dateIso) {
    const text = calNoteDraft.trim();
    if (!text) return;
    setCalNoteDraft("");
    try {
      const row = await insertCalendarNote(dateIso, text);
      if (row) setCalNotes((m) => ({ ...m, [dateIso]: [...(m[dateIso] || []), row] }));
    } catch (e) {
      console.error("Add calendar note failed:", e);
      setCalNoteDraft(text); // give it back rather than losing what they typed
    }
  }
  async function removeCalendarNote(dateIso, id) {
    const prev = calNotes[dateIso] || [];
    setCalNotes((m) => ({ ...m, [dateIso]: prev.filter((n) => n.id !== id) }));
    if (calNoteEditId === id) setCalNoteEditId(null);
    try { await deleteCalendarNote(id); }
    catch (e) { console.error("Delete calendar note failed:", e); setCalNotes((m) => ({ ...m, [dateIso]: prev })); }
  }
  async function saveCalendarNoteEdit(dateIso, id) {
    const text = calNoteEditText.trim();
    if (!text) return;
    setCalNotes((m) => ({ ...m, [dateIso]: (m[dateIso] || []).map((n) => (n.id === id ? { ...n, note: text } : n)) }));
    setCalNoteEditId(null);
    try { await updateCalendarNote(id, text); }
    catch (e) { console.error("Edit calendar note failed:", e); }
  }

  // Rail quick-add: one field for the date, one for the note (brief item 3).
  // Goes through the same insert the Calendar's date page uses and drops the
  // row into calNotes, so the note is on the calendar immediately.
  async function addQuickDateNote() {
    const text = quickNoteDraft.trim();
    if (!text || !quickNoteDate || quickNoteBusy) return;
    setQuickNoteBusy(true);
    setQuickNoteMsg("");
    try {
      const row = await insertCalendarNote(quickNoteDate, text);
      if (row) {
        setCalNotes((m) => ({ ...m, [quickNoteDate]: [...(m[quickNoteDate] || []), row] }));
        setQuickNoteDraft("");
        setQuickNoteMsg(`Added to ${shortDate(quickNoteDate)}`);
        setTimeout(() => setQuickNoteMsg(""), 3000);
      } else {
        setQuickNoteMsg("Couldn't save — calendar notes table missing?");
      }
    } catch (e) {
      console.error("Quick date note failed:", e);
      setQuickNoteMsg("Couldn't save that note.");
    }
    setQuickNoteBusy(false);
  }

  // Finalize/publish state per week. Without this the Finalize button forgot
  // itself on every reload — it wrote to schedule_weeks but nothing read back.
  // Lock rows live in the same table keyed by section, so they load here too.
  useEffect(() => {
    let cancelled = false;
    fetchScheduleWeeks()
      .then((rows) => {
        if (cancelled) return;
        setFinalizedWeeks(new Set(rows.filter((r) => r.finalized).map((r) => r.week_start)));
        setPublishedWeekStarts(new Set(rows.filter((r) => r.published).map((r) => r.week_start)));
        // When each week's emails went out, for the "Published ✓ Sep 21, 4:02 PM"
        // badge (brief item 3). Weeks published before published_at was read
        // back simply have no timestamp and fall back to the button.
        const pubAt = {};
        rows.forEach((r) => { if (r.published && r.published_at) pubAt[r.week_start] = r.published_at; });
        setPublishedAtByWeek(pubAt);
        const locks = new Set();
        rows.forEach((r) => {
          if (!r.locked) return;
          const key = DB_SECTION_KEY[r.section];
          if (key) locks.add(`${r.week_start}|${key}`); // ALL rows carry finalize state, not a lock
        });
        setLockedSectionWeeks(locks);
      })
      .catch((e) => console.error("Schedule weeks load failed:", e));
    return () => { cancelled = true; };
  }, []);

  // Pull each week's own record as it comes into view — the Set Schedule week,
  // and every week the calendar is showing (so day summaries match the grid).
  useEffect(() => {
    if (!Object.keys(idToName).length) return; // need the id->name map first
    ensureWeekLoaded(activeWeekStart);
  }, [activeWeekStart, idToName]);

  useEffect(() => {
    if (!Object.keys(idToName).length) return;
    const starts = new Set();
    (calMonthView === 3 ? threeMonthWeeks.flat() : weeks).forEach((w) => {
      if (w?.[0]?.date) starts.add(iso(mondayOf(w[0].date)));
    });
    starts.forEach((s) => ensureWeekLoaded(s));
  }, [weeks, threeMonthWeeks, calMonthView, idToName]);

  // The Tip Sheet auto-fills from whatever week its date falls in.
  useEffect(() => {
    if (!Object.keys(idToName).length || !tipDateIso) return;
    ensureWeekLoaded(iso(mondayOf(new Date(`${tipDateIso}T00:00:00`))));
  }, [tipDateIso, idToName]);

  // Today at a Glance reads whichever day the 7-day strip has selected, and the
  // strip runs into next week. An unloaded week renders from the template, so
  // someone the saved week has off (RO) would show as working — load every week
  // the strip touches.
  useEffect(() => {
    if (!Object.keys(idToName).length) return;
    const starts = new Set(weekStrip.map((d) => iso(mondayOf(d.date))));
    starts.add(iso(mondayOf(new Date(`${glanceIso}T00:00:00`))));
    starts.forEach((s) => ensureWeekLoaded(s));
  }, [weekStrip, glanceIso, idToName]);

  // Notes for the week on screen (drives the "Notes (N)" count, so it loads
  // whether or not the panel is open).
  useEffect(() => {
    if (activeWeekStart && !notesByWeek[activeWeekStart]) reloadNotes(activeWeekStart);
    // The current week too: Rail approvals auto-note against it (noteApproval)
    // regardless of which week Set Schedule happens to be showing.
    if (!notesByWeek[thisWeekStart]) reloadNotes(thisWeekStart);
  }, [activeWeekStart]);

  // Pending staff info-update requests (Staff tab review section).
  function reloadInfoUpdates() {
    return fetchInfoUpdates().then((u) => setInfoUpdates(u)).catch(() => setInfoUpdates([]));
  }
  useEffect(() => { reloadInfoUpdates(); }, []);

  // Generate the QR image whenever a QR modal opens.
  useEffect(() => {
    if (!qrModal) { setQrDataUrl(""); return; }
    const spec = QR_CODES.find((q) => q.key === qrModal);
    if (!spec) return;
    let cancelled = false;
    QRCode.toDataURL(mailtoLink(spec.subject, spec.body), { width: 320, margin: 2 })
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch((e) => { console.error("QR generation failed:", e); if (!cancelled) setQrDataUrl(""); });
    return () => { cancelled = true; };
  }, [qrModal]);

  const staffNameById = idToName;

  async function handleApproveInfo(u) {
    try {
      await approveInfoUpdate(u);
      setStaffList((l) => l.map((s) => (s.id === u.staff_id
        ? { ...s, personal_email: u.new_email || s.personal_email, phone: u.new_phone || s.phone }
        : s)));
      setInfoUpdates((list) => list.filter((x) => x.id !== u.id));
    } catch (e) {
      console.error("Approve info update failed:", e);
      window.alert(`Couldn't approve: ${e.message}`);
    }
  }
  async function handleDenyInfo(u) {
    try {
      await denyInfoUpdate(u.id);
      setInfoUpdates((list) => list.filter((x) => x.id !== u.id));
    } catch (e) {
      console.error("Deny info update failed:", e);
    }
  }
  function copyText(text) {
    if (text && navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
  }

  // Permanent staff delete (DB cascades to roles/patterns/overrides/rail). Local
  // state is cleaned so the grids update without a reload; group rosters and
  // their schedule grids are spliced at the same index to stay aligned.
  async function handleConfirmDelete() {
    const s = deleteTarget;
    if (!s || deleting) return;
    setDeleting(true);
    const idxByGroup = {};
    Object.keys(groupRosters).forEach((gk) => {
      const i = (groupRosters[gk] || []).indexOf(s.name);
      if (i >= 0) idxByGroup[gk] = i;
    });
    try {
      if (s.id) await deleteStaff(s.id);
      setStaffList((l) => l.filter((x) => (s.id ? x.id !== s.id : x.name !== s.name)));
      setStaffRolesMap((m) => { const n = { ...m }; delete n[s.name]; return n; });
      setPatterns((p) => { const n = { ...p }; delete n[s.name]; return n; });
      setNameToId((m) => { const n = { ...m }; delete n[s.name]; return n; });
      setStaffDrafts((d) => { const n = { ...d }; delete n[s.id || s.name]; return n; });
      setGroupRosters((prev) => {
        const next = {};
        Object.entries(prev).forEach(([gk, names]) => { next[gk] = names.filter((nm) => nm !== s.name); });
        return next;
      });
      setPlaceholderPatterns((prev) => {
        const next = { ...prev };
        Object.entries(idxByGroup).forEach(([gk, i]) => { if (next[gk]) next[gk] = next[gk].filter((_, j) => j !== i); });
        return next;
      });
      if (staffProfile === s.id) setStaffProfile(null);
      setStaffMsg(`Deleted ${s.name}.`);
    } catch (e) {
      console.error("Delete staff failed:", e);
      setStaffMsg(`Couldn't delete ${s.name}: ${e.message || e}`);
    }
    setDeleting(false);
    setDeleteTarget(null);
  }

  // Generate all 7 QR images, then print (only the print sheet shows — see the
  // body.printing-qr @media print rules).
  function handlePrintQR() {
    if (qrPrinting) return;
    setQrPrinting(true);
    Promise.all(
      QR_CODES.map((q) => QRCode.toDataURL(mailtoLink(q.subject, q.body), { width: 300, margin: 1 }).then((url) => [q.key, url]))
    )
      .then((pairs) => setQrPrintUrls(Object.fromEntries(pairs)))
      .catch((e) => { console.error("QR print generation failed:", e); setQrPrinting(false); });
  }
  useEffect(() => {
    if (qrPrinting && Object.keys(qrPrintUrls).length === QR_CODES.length) {
      document.body.classList.add("printing-qr");
      window.print();
      document.body.classList.remove("printing-qr");
      setQrPrinting(false);
    }
  }, [qrPrinting, qrPrintUrls]);

  // MM-DD-to-MM-DD file-name fragment for a week.
  function weekFileRange(week) {
    const fmt = (d) => `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return week ? `${fmt(week[0].date)}-to-${fmt(week[6].date)}` : "week";
  }
  // Build the branded colored sheet node for a section+week (used by both
  // Save-as-PDF and the multi-week publish attachments).
  function scheduleSheetNodeFor(section, week) {
    const isFoh = section === "FOH";
    const node = buildScheduleSheetNode({
      sectionTitle: isFoh ? "FRONT OF HOUSE SCHEDULE" : "BOH & KITCHEN SCHEDULE",
      weekLabel: weekRangeLabel(week),
      days: sheetDays(week),
      todayIdx: sheetTodayIdx(week),
      groups: isFoh
        ? buildFohSheetGroups(week)
        : [
            { label: "Kitchen", rows: buildGroupRows("kitchen", week) },
            { label: "BOH", rows: buildGroupRows("boh", week) },
          ],
      managerOn: buildManagerOn(week),
      compact: isFoh,
    });
    // Print CSS keys off this: only the FOH sheet gets the tightened print
    // density; BOH/Kitchen prints exactly as before.
    node.dataset.sheet = isFoh ? "foh" : "bohkitchen";
    return node;
  }
  // Save-as-PDF: FOH and BOH+Kitchen get the branded colored sheet; the
  // Management sub-tab keeps the generic grid capture.
  async function exportSchedulePdf() {
    if (pdfBusy) return;
    setPdfBusy("schedule");
    try {
      const range = weekFileRange(activeWeek);
      if (scheduleView === "foh" || scheduleView === "bohkitchen") {
        const isFoh = scheduleView === "foh";
        const node = scheduleSheetNodeFor(isFoh ? "FOH" : "BOHKITCHEN", activeWeek);
        await exportSheetNodeAsPdf(node, `Haenyeo-Schedule-${isFoh ? "FOH" : "BOH-Kitchen"}-${range}.pdf`);
      } else if (scheduleCardRef.current) {
        await exportNodeAsPdf(scheduleCardRef.current, `Haenyeo-Schedule-Management-${range}.pdf`, {
          orientation: "landscape",
          header: { title: `Management — ${formatWeekRange(activeWeek)}` },
          strip: [".print-header", ".subtabs", ".cal-legend", ".template-note", ".template-icon"],
        });
      }
    } catch (e) {
      console.error("Schedule PDF export failed:", e);
    }
    setPdfBusy(null);
  }
  // Print the current sub-tab with the SAME branded renderer as the PDF/email
  // (white header + logo, role colors, today highlight, em-dash off days) —
  // never the live interactive grid. Mount an offscreen sheet node into the
  // print portal, flip body.printing-schedule, print, then tear it down.
  function scheduleSheetNodeForCurrentView(week) {
    if (scheduleView === "foh") return scheduleSheetNodeFor("FOH", week);
    if (scheduleView === "bohkitchen") return scheduleSheetNodeFor("BOHKITCHEN", week);
    return buildScheduleSheetNode({
      sectionTitle: "MANAGEMENT SCHEDULE",
      weekLabel: weekRangeLabel(week),
      days: sheetDays(week),
      todayIdx: sheetTodayIdx(week),
      groups: [{ label: "Management", rows: buildGroupRows("management", week) }],
      managerOn: null,
    });
  }
  function printSchedule() {
    const portal = schedulePrintRef.current;
    if (!portal || !activeWeek) { window.print(); return; }
    const node = scheduleSheetNodeForCurrentView(activeWeek);
    // The sheet node renders offscreen at a fixed width for canvas capture;
    // reset that positioning so it flows normally on the printed page.
    node.style.position = "static";
    node.style.left = "auto";
    node.style.top = "auto";
    node.style.width = "100%";
    portal.innerHTML = "";
    portal.appendChild(node);
    document.body.classList.add("printing-schedule");
    window.print();
    document.body.classList.remove("printing-schedule");
    portal.innerHTML = "";
  }
  // One landscape page, filled (brief item 4). The old version pinned the
  // capture to 1280px and let the shared width-fit place it, which left a large
  // empty band at the bottom whenever the content came out shorter than the
  // page. Now the capture is measured and, if it would cover less than
  // PDF_PAGE_FILL_TARGET of the page height, re-taken at a narrower CSS width so
  // the layout reflows taller. Placement then scales from both axes and centres.
  //
  // renderTipSheetPdf is the ONE Tip Sheet renderer: Save as PDF downloads its
  // result and Send Tip Sheet attaches it, so the emailed page is exactly the
  // saved page. It throws on failure — the send path must not email without it.
  const tipSheetPdfFilename = `Haenyeo-TipSheet-${tipDateIso}.pdf`;
  async function renderTipSheetPdf() {
    const card = tipCardRef.current;
    if (!card) throw new Error("the Tip Sheet isn't on screen");
    const origW = card.style.width;
    const origMax = card.style.maxWidth;
    // Outline-only boxes for the PDF (html2canvas can't read @media print).
    card.classList.add("tip-pdf-mode");
    // Drop helper/hint text and the Custom Schedule toggle from the PDF.
    // (Status banners, the action row and the TODAY pill are .screen-only,
    // which PDF_STRIP_ALWAYS already covers.)
    const strip = [".footer-note", ".recon-note", ".custom-toggle", ".fm-banner", ".add-payout-btn", ".remove-payout-btn"];

    // Pin the width so the layout never depends on the browser window size.
    async function captureAt(widthPx) {
      card.style.width = `${widthPx}px`;
      card.style.maxWidth = "none";
      const canvas = await captureNodeForPdf(card, { strip });
      return { widthPx, canvas, fill: canvasPageFill(canvas, "landscape") };
    }

    try {
      let best = await captureAt(TIP_PDF_BASE_WIDTH);
      const { availW, availH } = pdfPageBox("landscape");
      // Reflow roughly conserves area, so the width whose aspect ratio matches
      // the page is about sqrt(W · H · pageRatio). One or two passes converge;
      // we stop early once the target is met, the estimate stops moving, or a
      // narrower capture comes out worse than the one we already have.
      for (let pass = 0; pass < 2 && best.fill.heightFill < PDF_PAGE_FILL_TARGET; pass++) {
        const cssH = best.canvas.height / (best.canvas.width / best.widthPx);
        const next = Math.round(Math.sqrt(best.widthPx * cssH * (availW / availH)));
        const clamped = Math.max(TIP_PDF_MIN_WIDTH, Math.min(TIP_PDF_MAX_WIDTH, next));
        if (Math.abs(clamped - best.widthPx) < 20) break;
        const attempt = await captureAt(clamped);
        if (attempt.fill.heightFill <= best.fill.heightFill) break;
        best = attempt;
      }
      if (best.fill.heightFill < PDF_PAGE_FILL_TARGET) {
        console.warn(
          `[tip-pdf] best capture (${best.widthPx}px) still fills only ` +
          `${(best.fill.heightFill * 100).toFixed(1)}% of the page height`
        );
      }
      return await onePageCanvasToPdf(best.canvas, "landscape");
    } finally {
      card.classList.remove("tip-pdf-mode");
      card.style.width = origW;
      card.style.maxWidth = origMax;
    }
  }
  async function exportTipSheetPdf() {
    if (pdfBusy || !tipCardRef.current) return;
    setPdfBusy("tips");
    try {
      (await renderTipSheetPdf()).save(tipSheetPdfFilename);
    } catch (e) {
      console.error("Tip sheet PDF export failed:", e);
    }
    setPdfBusy(null);
  }

  // Finalize is the Calendar gate and nothing else (brief item 3): it puts the
  // week on the Calendar, and pressing it again takes it back off. No email.
  //
  // Un-finalizing also clears the week's published state (in setWeekFinalized),
  // so the reopen → edit → re-finalize → Publish loop actually re-sends instead
  // of the week being stuck as "already published".
  //
  // This writes through data.js rather than /api/finalize-week: that endpoint
  // still keys schedule_weeks on week_start with a null section, which is the
  // shape from migration 0009 — 0013 moved the key to (week_start, section) and
  // made section NOT NULL. The client path handles both, with a legacy fallback.
  async function toggleWeekFinalized() {
    if (!activeWeek || finalizeBusy) return;
    const weekStart = activeWeek[0].iso; // Monday of week
    const next = !finalizedWeeks.has(weekStart);
    if (!next && publishedWeekStarts.has(weekStart) && !window.confirm(
      `Un-finalize the week of ${shortDate(weekStart)}? It comes off the Calendar, and because it will need publishing again, its "published" mark is cleared. Emails already sent are not recalled.`
    )) return;

    setFinalizeBusy(true);
    try {
      await setWeekFinalized(weekStart, next);
      setFinalizedWeeks((prev) => {
        const s = new Set(prev);
        if (next) s.add(weekStart); else s.delete(weekStart);
        return s;
      });
      if (!next) {
        setPublishedWeekStarts((prev) => {
          const s = new Set(prev);
          s.delete(weekStart);
          return s;
        });
        setPublishedAtByWeek((prev) => {
          const m = { ...prev };
          delete m[weekStart];
          return m;
        });
      }
      addLog(
        `Week of ${shortDate(weekStart)} ${next ? "finalized — now on the Calendar" : "un-finalized — off the Calendar"}`,
        next ? "good" : "warn"
      );
    } catch (e) {
      console.error("Finalize toggle failed:", e);
      addLog(`Finalize failed: ${e.message}`, "warn");
    }
    setFinalizeBusy(false);
  }

  // Lock/unlock one section of one week. Independent of Finalize — a week can be
  // finalized and unlocked, or locked and unfinalized. Optimistic, then rolled
  // back if the write fails, so the button never claims a lock that isn't saved.
  async function toggleSectionLock() {
    const weekStart = activeWeekStart;
    const sectionKey = scheduleView;
    const key = lockKeyFor(weekStart, sectionKey);
    const next = !lockedSectionWeeks.has(key);
    setLockedSectionWeeks((prev) => {
      const s = new Set(prev);
      if (next) s.add(key); else s.delete(key);
      return s;
    });
    try {
      await setWeekSectionLocked(weekStart, sectionKey, next);
      addLog(`${SECTION_LABEL[sectionKey]} ${next ? "locked" : "unlocked"} — ${shortDate(weekStart)}`, next ? "warn" : "good");
    } catch (e) {
      console.error("Section lock failed:", e);
      setLockedSectionWeeks((prev) => {
        const s = new Set(prev);
        if (next) s.delete(key); else s.add(key);
        return s;
      });
      addLog(`Couldn't ${next ? "lock" : "unlock"} ${SECTION_LABEL[sectionKey]} — run migration 0013?`, "warn");
    }
  }

  // ---- Publish dialog (PUBLISH brief A1–A5) ---------------------------------
  // Publish is the one button that reaches every employee at once, so it opens
  // a confirmation instead of sending: the weeks, an editable subject, a
  // message, every recipient as a checkbox, a test send to yourself, then
  // Confirm & Send. One email per section (FOH; BOH & Kitchen) carries every
  // selected week — the inline table for phones plus one PDF per week from the
  // same sheet builder as Print.
  const [publishModal, setPublishModal] = useState(null);

  // Everyone a real send can reach, split the way the server splits them.
  // Addresses shown here are for the manager's eyes; the server re-reads them
  // from the DB by id and never trusts one from the page.
  const publishRecipients = useMemo(() => {
    const reachable = staffList.filter((s) => s.id && s.registered && s.active !== false && s.personal_email);
    const bySection = (secs) => reachable
      .filter((s) => secs.includes(String(s.section || "FOH").toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { foh: bySection(["foh"]), bk: bySection(["boh", "kitchen"]) };
  }, [staffList]);

  // "Schedule 11/09-11/15/26": first selected week's Monday through the last
  // selected week's Sunday.
  function publishSubjectFor(isos) {
    if (!isos.length) return "Schedule";
    const sorted = [...isos].sort();
    const start = new Date(`${sorted[0]}T00:00:00`);
    const end = new Date(`${sorted[sorted.length - 1]}T00:00:00`);
    end.setDate(end.getDate() + 6);
    const md = (d) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
    return `Schedule ${md(start)}-${md(end)}/${String(end.getFullYear()).slice(-2)}`;
  }

  function openPublishDialog() {
    const weeks = [...unpublishedFinalizedWeeks].sort();
    if (!weeks.length) { addLog("No finalized weeks waiting to be published", "warn"); return; }
    setPublishModal({
      weeks, picked: weeks,
      subject: publishSubjectFor(weeks), subjectEdited: false,
      notes: "", excluded: [],
      busy: null, error: null, testResult: null,
      sentSections: [], // sections already sent in THIS dialog — a retry won't resend them
    });
  }
  function togglePublishWeek(iso) {
    setPublishModal((m) => {
      const picked = m.picked.includes(iso) ? m.picked.filter((w) => w !== iso) : [...m.picked, iso].sort();
      return { ...m, picked, subject: m.subjectEdited ? m.subject : publishSubjectFor(picked) };
    });
  }
  function togglePublishRecipient(id) {
    setPublishModal((m) => ({
      ...m,
      excluded: m.excluded.includes(id) ? m.excluded.filter((x) => x !== id) : [...m.excluded, id],
    }));
  }

  // Render every PDF up front. If any fails, nothing is sent (A5).
  async function renderPublishPdfs(isos) {
    const weeks = isos.map((s) => buildWeekByOffset(weekOffsetFor(new Date(`${s}T00:00:00`))));
    const foh = [];
    const bk = [];
    for (let i = 0; i < weeks.length; i++) {
      // Named by the week's Monday so they sort correctly in a folder.
      const filename = `Haenyeo-Schedule-${isos[i]}.pdf`;
      foh.push({ filename, b64: await sheetNodePdfBase64(scheduleSheetNodeFor("FOH", weeks[i])) });
      bk.push({ filename, b64: await sheetNodePdfBase64(scheduleSheetNodeFor("BOHKITCHEN", weeks[i])) });
    }
    [...foh, ...bk].forEach((a) => {
      if (!String(a.b64 || "").startsWith("JVBERi0")) throw new Error(`${a.filename} didn't render`);
    });
    return { weeks, foh, bk };
  }

  // test=true: the identical emails, to the signed-in manager only, "[TEST]"
  // subject. Never marks anything published, never touches the publish count,
  // never writes a timestamp — setWeekPublished is only reachable from the
  // real-send branch below.
  async function sendPublish(test) {
    const m = publishModal;
    if (!m || m.busy) return;
    const token = session?.access_token;
    if (!token) { setPublishModal((p) => ({ ...p, error: "Sign in to publish." })); return; }
    const isos = m.weeks.filter((w) => m.picked.includes(w)).sort();
    if (!isos.length) return;
    setPublishModal((p) => ({ ...p, busy: test ? "test" : "send", error: null, testResult: null }));

    let pdfs;
    try {
      pdfs = await renderPublishPdfs(isos);
    } catch (e) {
      console.error("Publish PDF render failed:", e);
      setPublishModal((p) => ({ ...p, busy: null, error: `A schedule PDF couldn't be made (${e.message || e}) — nothing was sent. Try again.` }));
      return;
    }

    const shared = { subject: m.subject.trim(), notes: m.notes.trim() };
    const sections = [
      { key: "foh", label: "Front of House", people: publishRecipients.foh, payload: { weeks: pdfs.weeks.map(buildSchedulePayload), sections: ["FOH"], attachments: pdfs.foh } },
      { key: "bk", label: "BOH & Kitchen", people: publishRecipients.bk, payload: { weeks: pdfs.weeks.map(buildBohKitchenPayload), sections: ["BOH", "Kitchen"], attachments: pdfs.bk } },
    ].map((sec) => ({ ...sec, ids: sec.people.filter((r) => !m.excluded.includes(r.id)).map((r) => r.id) }));

    const jobs = test
      ? sections
      : sections.filter((sec) => sec.ids.length > 0 && !m.sentSections.includes(sec.key));
    const results = await Promise.all(jobs.map((sec) =>
      triggerSchedulePublish({ ...sec.payload, ...shared, ...(test ? { test: true } : { recipientIds: sec.ids }) }, token)
    ));

    const reconnect = results.some((r) => r?.needsReconnect);
    if (reconnect) refreshGmailStatus();
    const failed = jobs.filter((_, i) => results[i]?.error || reconnect);
    const failedText = failed.map((sec) => `${sec.label}: ${results[jobs.indexOf(sec)]?.error || "Gmail disconnected"}`).join("; ");
    const recipientMisses = results.flatMap((r) => r?.failures || []);

    if (test) {
      setPublishModal((p) => ({
        ...p, busy: null,
        error: failed.length ? `Test didn't go out — ${failedText}` : null,
        testResult: failed.length ? null
          : `Test sent to ${session?.user?.email || "you"} — ${jobs.length} emails (${jobs.map((s) => s.label).join(", ")}). Nothing was marked published.`,
      }));
      return;
    }

    const nowSent = [...m.sentSections, ...jobs.filter((sec) => !failed.includes(sec)).map((sec) => sec.key)];
    const pendingSections = sections.filter((sec) => sec.ids.length > 0 && !nowSent.includes(sec.key));
    if (pendingSections.length) {
      // Keep the dialog open; Confirm retries only the section(s) that failed.
      setPublishModal((p) => ({
        ...p, busy: null, sentSections: nowSent,
        error: `Couldn't send ${failedText}.${nowSent.length ? ` ${sections.filter((s) => nowSent.includes(s.key)).map((s) => s.label).join(" and ")} already went out and won't be re-sent.` : ""} Nothing is marked published yet — press Confirm & Send to retry.`,
      }));
      return;
    }

    // Every section with recipients went out: now (and only now) mark published.
    const publishedAt = new Date().toISOString();
    await Promise.all(isos.map((s) => setWeekPublished(s).catch(() => {})));
    setPublishedWeekStarts((prev) => new Set([...prev, ...isos]));
    setPublishedAtByWeek((prev) => {
      const next = { ...prev };
      isos.forEach((s) => { next[s] = publishedAt; });
      return next;
    });
    const sentCount = results.reduce((n, r) => n + (r?.sent || 0), 0);
    addLog(`Published ${isos.length} week${isos.length === 1 ? "" : "s"} (${isos.map(shortDate).join(", ")}) — ${sentCount} emails${recipientMisses.length ? `; not delivered: ${recipientMisses.join("; ")}` : ""}`, recipientMisses.length ? "warn" : "good");
    setPublishModal(null);
  }

  // Re-pull rail requests from the DB (used after a manual Gmail poll so new
  // auto-created pending entries show up without a full reload).
  function reloadRail() {
    const idToName = {};
    staffList.forEach((s) => { if (s.id) idToName[s.id] = s.name; });
    return fetchRailRequests(idToName)
      .then((rail) => { setPending(rail.pending); setResolvedReqs(rail.resolved); setArchivedReqs(rail.archived || []); })
      .catch((e) => console.error("Rail reload failed:", e));
  }

  async function checkGmailNow() {
    if (gmailChecking) return;
    setGmailChecking(true);
    try {
      await triggerGmailPoll(session?.access_token);
      await reloadRail();
      const s = await fetchGmailStatus();
      setGmailStatus(s);
    } catch (e) {
      console.error("Gmail check failed:", e);
      setGmailStatus((prev) => ({ ...(prev || {}), connected: false, lastError: e.message }));
    } finally {
      setGmailChecking(false);
    }
  }

  // Manual Rail entry: submit the "+ Add Request" form. The server inserts the
  // pending row and sends the paper-trail + staff confirmation emails; the
  // reload pulls the new entry into the pending queue.
  async function submitManualEntry() {
    const f = manualForm;
    if (manualBusy || !f.staffId || !f.dates.trim() || !f.loggedBy) return;
    setManualBusy(true);
    setManualError(null);
    const res = await submitManualRail(
      { staffId: f.staffId, type: f.type, dates: f.dates.trim(), note: f.note.trim(), loggedBy: f.loggedBy },
      session?.access_token
    );
    if (res?.ok) {
      await reloadRail();
      setManualOpen(false);
      setManualForm({ staffId: "", type: "REQUEST OFF", dates: "", note: "", loggedBy: "" });
    } else {
      setManualError(res?.error || "Couldn't save the request. Try again.");
    }
    setManualBusy(false);
  }

  // Load the saved tip sheet for the selected date (or clear the form if none).
  useEffect(() => {
    let cancelled = false;
    fetchTipSheet(tipDateIso)
      .then((row) => {
        if (cancelled) return;
        const s = (v) => (v === null || v === undefined ? "" : String(v));
        setFloorCash(s(row?.floor_cash));
        setFloorCredit(s(row?.floor_credit));
        setBarCash(s(row?.bar_cash));
        setBarCredit(s(row?.bar_credit));
        setCovers(s(row?.covers));
        setOpeningCounts(row?.opening_counts || {});
        setClosingCounts(row?.closing_counts || {});
        setClosingSum(s(row?.closing_sum));
        setPayoutItems(Array.isArray(row?.payouts) ? row.payouts : []);
        setCashSales(s(row?.cash_sales));
        setSlotOverrides(row?.slot_overrides || {});
        setTipTimes(row?.time_entries || {});
        setBarTipOutOn(row?.bar_tip_out !== false); // null / no row → on
        setCustomMode(row?.slot_overrides && Object.keys(row.slot_overrides).length > 0);
        setTipSent(!!row?.sent);
        setTipSentAt(row?.sent_at || null);
        setTipFinalized(!!row?.finalized);
        setTipFinalizedAt(row?.finalized_at || null);
        setTipLocked(!!row?.locked);
        setTipLockedAt(row?.locked_at || null);
        // Bumped last, in the same batch as the setters above, so the autosave
        // baseline is re-taken from the values that just landed.
        setTipLoadSeq((n) => n + 1);
      })
      .catch((e) => console.error("Tip sheet load failed:", e));
    return () => { cancelled = true; };
  }, [tipDateIso]);
  // BOH / Kitchen dropdown cells write straight through; Management keeps the
  // click interaction but toggles Off <-> FM only.
  // Same per-week rule as writeCellShift: edits land on this week's own record.
  function writePlaceholderShift(groupKey, slotIdx, weekday, newType) {
    const ws = activeWeekStart;
    const base = weeklyPlaceholders[ws] || placeholderPatterns;
    const alreadySeeded = !!weeklyPlaceholders[ws];
    const rows = (base[groupKey] || []).map((row) => [...row]);
    while (rows.length <= slotIdx) rows.push([...ALL_OFF_WEEK]);
    rows[slotIdx][weekday] = newType;
    const nextWeek = { ...base, [groupKey]: rows };
    setWeeklyPlaceholders((prev) => ({ ...prev, [ws]: nextWeek }));
    const slotName = (groupRosters[groupKey] || [])[slotIdx] || "";
    setSchedSaveState("dirty");
    (async () => {
      schedSaveStart();
      let ok = false;
      try {
        if (!alreadySeeded) await seedWeeklyPlaceholders(ws, base, groupRosters);
        ok = await upsertWeeklyPlaceholder(ws, groupKey, slotIdx, slotName, weekday, newType);
      } catch (e) {
        console.error("Save weekly placeholder failed:", e);
        ok = false;
      }
      schedSaveEnd(ok);
    })();
  }
  function setPlaceholderShift(groupKey, slotIdx, weekday, newType) {
    if (schedulePastWeek || isSectionLocked(activeWeekStart, groupLockKey(groupKey))) return;
    const personName = (groupRosters[groupKey] || [])[slotIdx];
    const blk = newType !== "OFF" && personName ? approvedOffFor(personName, weekday) : null;
    if (blk) {
      setTimeOffBlock({
        name: personName, dayLabel: blk.dayLabel,
        onOverride: () => { writePlaceholderShift(groupKey, slotIdx, weekday, newType); overwriteApprovedOverride(personName, blk.iso, newType, blk.override.railId); },
      });
      return;
    }
    writePlaceholderShift(groupKey, slotIdx, weekday, newType);
  }
  // Cross-scheduling (item 2): a person can't be scheduled in two sections the
  // same day. Returns the label of another section where `name` is already
  // working that weekday, else null. Kitchen conflicts with BOH + Management(FM);
  // BOH conflicts with Kitchen; Management conflicts with Kitchen.
  function crossSectionBlock(name, thisGroup, weekday) {
    const checks =
      thisGroup === "kitchen" ? [["boh", "BOH"], ["management", "Management"]]
      : thisGroup === "boh" ? [["kitchen", "Kitchen"]]
      : thisGroup === "management" ? [["kitchen", "Kitchen"]]
      : [];
    for (const [grp, label] of checks) {
      const idx = (groupRosters[grp] || []).indexOf(name);
      if (idx < 0) continue;
      if (!isOffCell(activePlaceholders[grp]?.[idx]?.[weekday])) return label;
    }
    return null;
  }

  function toggleManagementCell(slotIdx, weekday) {
    if (schedulePastWeek || isSectionLocked(activeWeekStart, "management")) return;
    const name = (groupRosters.management || [])[slotIdx];
    const current = activePlaceholders.management?.[slotIdx]?.[weekday] || "OFF";
    if (current === "OFF") {
      const conflict = crossSectionBlock(name, "management", weekday);
      if (conflict) { window.alert(`${name} is already scheduled in ${conflict} that day — can't also be FM.`); return; }
    }
    setPlaceholderShift("management", slotIdx, weekday, current === "OFF" ? "FM" : "OFF");
  }

  // Render one BOH/Kitchen roster row (dropdown cells with cross-section blocking).
  function renderGroupRow(groupKey, personName, idx) {
    const row = activePlaceholders[groupKey]?.[idx] || ALL_OFF_WEEK;
    const isYesPerson = personName.startsWith("Jenny") || personName.startsWith("Ajuma");
    const opts = roleOptions[GROUP_ROLE[groupKey]] || [{ code: "OFF", label: "Off" }];
    return (
      <tr key={groupKey + personName + idx}>
        {schedNameCell(personName, personName.startsWith("Jenny") ? `${personName} — Head Chef` : personName)}
        {WEEKDAY_LABELS.map((w, wi) => {
          const realWeekday = WEEKDAY_ORDER[wi];
          const type = row[realWeekday] || "OFF";
          const value = opts.some((o) => o.code === type) ? type : "OFF";
          const workedRole = value === "OFF" ? null : roleForCell(value, GROUP_ROLE[groupKey]);
          const blockLabel = value === "OFF" ? crossSectionBlock(personName, groupKey, realWeekday) : null;
          if (blockLabel) {
            return (
              <td key={w} className="shift-cell">
                <div className="cell-blocked" title={`Already scheduled in ${blockLabel}`}>—</div>
              </td>
            );
          }
          const timeOff = approvedOffFor(personName, realWeekday);
          return (
            <td key={w} className="shift-cell">
              {timeOff && <span className="cell-timeoff-flag" title="Approved time off" />}
              {dayOfFlag(personName, realWeekday)}
              <select
                className="cell-select shift-select"
                value={value}
                disabled={scheduleFrozen}
                style={value === "OFF" ? undefined : roleCellStyle(workedRole)}
                onChange={(e) => setPlaceholderShift(groupKey, idx, realWeekday, e.target.value)}
              >
                {opts.map((o) => (
                  <option key={o.code} value={o.code}>
                    {groupKey === "kitchen" && o.code === "KITCHEN" && isYesPerson ? "Yes" : o.label}
                  </option>
                ))}
              </select>
              {workedRole && !isPrimaryRole(personName, workedRole) && (
                <div className="cross-role-label" style={{ color: ROLE_COLOR_MUTED[workedRole] }}>
                  {crossRoleLabelText(workedRole)}
                </div>
              )}
            </td>
          );
        })}
      </tr>
    );
  }
  const holidaysThisWeek = weekStrip
    .map((d) => { const name = holidayFor(d.iso); return name ? { date: d.iso, name } : null; })
    .filter(Boolean);

  // `at` is what the persistent Clear watermark filters on (brief item 1), so
  // every entry — DB-derived or added live — carries one.
  function addLog(text, tone) {
    setLog((l) => [
      { id: `l-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text, time: timeNow(), at: new Date().toISOString(), tone },
      ...l,
    ]);
  }

  // Approved time-off block (item 2): for a cell's weekday, map to the actual
  // date in the displayed week and return the override iff it's an APPROVED
  // Rail-sourced Off (type 'OFF' + railId). Manual Off / pending / non-Off → null.
  function approvedOffFor(name, weekday) {
    if (!activeWeek) return null;
    const day = activeWeek.find((d) => d.weekday === weekday);
    if (!day) return null;
    const ov = overrides[`${name}|${day.iso}`];
    if (ov && ov.type === "OFF" && ov.railId) {
      return { iso: day.iso, override: ov, dayLabel: day.date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) };
    }
    return null;
  }
  // Day-of change marker for a grid cell: a dated override with NO Rail request
  // behind it is one made on the day (Tip Sheet add/remove, Today at a Glance
  // swap / remove-only). The cell keeps showing the planned shift; this only
  // explains what happened. Rail approvals carry railId and keep their own flag.
  function dayOfChangeFor(name, weekday) {
    if (!activeWeek) return null;
    const day = activeWeek.find((d) => d.weekday === weekday);
    if (!day) return null;
    const ov = overrides[`${name}|${day.iso}`];
    if (!ov?.type || ov.railId) return null;
    const what = ov.type === "OFF" ? "Removed on the day"
      : ov.type === "GAP" ? "Marked as a coverage gap on the day"
      : `Added on the day — ${shiftLabelForType(ov.type)}`;
    return `${what} (${shortDate(day.iso)}). Planned shift shown — see this week's Notes.`;
  }
  function dayOfFlag(name, weekday) {
    const text = dayOfChangeFor(name, weekday);
    return text ? <span className="cell-dayof-flag screen-only" title={text} aria-label={text} /> : null;
  }

  // On "Override": replace the Off override with the chosen shift, keeping the
  // rail_request_id link (the request stays approved; no email is sent).
  async function overwriteApprovedOverride(name, isoStr, code, railId) {
    setOverrides((o) => ({ ...o, [`${name}|${isoStr}`]: { type: code, swap: false, railId: railId || null } }));
    const staffId = nameToId[name];
    if (staffId) {
      try { await upsertScheduleOverride({ staffId, dateIso: isoStr, overrideType: code, isSwap: false, railRequestId: railId || null }); }
      catch (e) { console.error("Override write failed:", e); }
    }
  }

  // Warn before clobbering an existing override on the same person+date.
  function confirmOverwrite(name, isoStr) {
    if (!overrides[`${name}|${isoStr}`]) return true;
    return window.confirm(`${name} already has a schedule override on ${isoStr}. Overwrite it with this request?`);
  }

  // Find the swap partner named in a SHIFT SWAP request's note.
  function findSwapPartner(item) {
    const note = item.note || "";
    const other = staffList.find(
      (s) => s.name && s.name !== item.name && new RegExp(`\\b${s.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(note)
    );
    return other ? { name: other.name, id: other.id || nameToId[other.name] } : null;
  }

  // Write an OFF override for each ISO date (shared by REQUEST OFF and TIME OFF).
  async function writeOffDates(item, staffId, isoDates) {
    for (const isoStr of isoDates) {
      if (!confirmOverwrite(item.name, isoStr)) continue;
      await upsertScheduleOverride({ staffId, dateIso: isoStr, overrideType: "OFF", isSwap: false, railRequestId: item.id });
      setOverrides((o) => ({ ...o, [`${item.name}|${isoStr}`]: { type: "OFF", swap: false, railId: item.id } }));
    }
  }

  // Apply the schedule side effects of an APPROVED request (item 1 of the brief).
  async function applyApprovalSchedule(item) {
    if (item.type === "TIME OFF") {
      const staffId = item.staffId || nameToId[item.name];
      if (!staffId) {
        window.alert(`Approved, but the schedule wasn't updated — no staff member matches "${item.name}".`);
        return;
      }
      const { dates } = timeOffDates(item.dates);
      if (!dates.length) { console.warn("No parseable dates on TIME OFF:", item.dates); return; }
      await writeOffDates(item, staffId, dates);
      await noteApproval(item, dates);
      return;
    }

    const dates = parseRailDates(item.dates);
    if (!dates.length) { console.warn("No parseable date on request:", item.dates); return; }

    if (item.type === "REQUEST OFF" || item.type === "COVERAGE REQUEST") {
      const staffId = item.staffId || nameToId[item.name];
      if (!staffId) {
        window.alert(`Approved, but the schedule wasn't updated — no staff member matches "${item.name}". Add them on the Staff tab, then set the day manually.`);
        return;
      }
      const overrideType = item.type === "REQUEST OFF" ? "OFF" : "GAP";
      for (const isoStr of dates) {
        if (!confirmOverwrite(item.name, isoStr)) continue;
        await upsertScheduleOverride({ staffId, dateIso: isoStr, overrideType, isSwap: false, railRequestId: item.id });
        setOverrides((o) => ({ ...o, [`${item.name}|${isoStr}`]: { type: overrideType, swap: false, railId: item.id } }));
      }
      await noteApproval(item, dates);
    } else if (item.type === "SHIFT SWAP") {
      const partner = findSwapPartner(item);
      const isoStr = dates[0];
      const aId = item.staffId || nameToId[item.name];
      const bId = partner?.id;
      if (!partner || !aId || !bId) {
        window.alert(`Approved, but couldn't identify both people to swap from the request note. Adjust ${item.name}'s schedule manually if needed.`);
        return;
      }
      if (!confirmOverwrite(item.name, isoStr) || !confirmOverwrite(partner.name, isoStr)) return;
      const di = dateInfoFromIso(isoStr);
      const swapPats = patternsForDate(di);
      const aShift = personShiftFor(item.name, di, swapPats, overrides).type;
      const bShift = personShiftFor(partner.name, di, swapPats, overrides).type;
      await upsertScheduleOverride({ staffId: aId, dateIso: isoStr, overrideType: bShift, isSwap: true, railRequestId: item.id });
      await upsertScheduleOverride({ staffId: bId, dateIso: isoStr, overrideType: aShift, isSwap: true, railRequestId: item.id });
      setOverrides((o) => ({
        ...o,
        [`${item.name}|${isoStr}`]: { type: bShift, swap: true, railId: item.id },
        [`${partner.name}|${isoStr}`]: { type: aShift, swap: true, railId: item.id },
      }));
      await noteApproval(item, [isoStr]);
    }
  }

  async function resolve(item, approved) {
    if (railBusy) return;
    const managerNote = (railNotes[item.id] || "").trim();
    setRailBusy(item.id);
    setPending((p) => p.filter((r) => r.id !== item.id));
    addLog(`${approved ? "Approved" : "Denied"} ${item.name} — ${TYPE_STYLES[item.type].label}, ${item.dates}`, approved ? "good" : "warn");

    try {
      await updateRailStatus(item.id, approved ? "approved" : "denied", managerNote);
    } catch (e) {
      console.error("Update request failed:", e);
    }

    if (approved) {
      try {
        await applyApprovalSchedule(item);
      } catch (e) {
        console.error("Schedule auto-update failed:", e);
        addLog(`Schedule auto-update failed for ${item.name} — set the day manually`, "warn");
      }
    }

    // Auto-reply to the original email thread (best-effort; skipped for manual entries).
    const reply = await sendRailReply(item.id, approved, managerNote, session?.access_token);
    if (reply?.sent) addLog(`Email reply sent to ${item.name}`, "good");
    else if (reply?.needsReconnect && reply.error !== "gmail_not_connected") { addLog(`Email reply to ${item.name} not sent — Gmail disconnected, reconnect`, "warn"); refreshGmailStatus(); }
    else if (reply?.error && reply.error !== "gmail_not_connected") addLog(`Email reply not sent (${reply.error})`, "warn");

    setRailNotes((n) => { const next = { ...n }; delete next[item.id]; return next; });
    setRailBusy(null);
  }

  /* ---- Rail: archive / restore / delete a pending request ---- */

  // Archive keeps the row and its email thread, just flips the status so it
  // leaves the queue. No reply is sent and no schedule override is written —
  // this is housekeeping, not a decision.
  async function archiveRequest(item) {
    if (railActionBusy) return;
    setRailActionBusy(true);
    setPending((p) => p.filter((r) => r.id !== item.id));
    setArchivedReqs((a) => [item, ...a.filter((r) => r.id !== item.id)]);
    if (selectedRailId === item.id) setSelectedRailId(null);
    try {
      await setRailArchived(item.id, true);
      addLog(`Archived ${item.name} — ${TYPE_STYLES[item.type]?.label || item.type}, ${item.dates}`, "warn");
    } catch (e) {
      console.error("Archive failed:", e);
      setArchivedReqs((a) => a.filter((r) => r.id !== item.id));
      setPending((p) => [...p, item]);
      addLog(`Couldn't archive ${item.name}'s request`, "warn");
    }
    setRailActionBusy(false);
  }

  async function restoreRequest(item) {
    if (railActionBusy) return;
    setRailActionBusy(true);
    setArchivedReqs((a) => a.filter((r) => r.id !== item.id));
    setPending((p) => [...p, item]);
    try {
      await setRailArchived(item.id, false);
      addLog(`Restored ${item.name}'s request to pending`, "good");
    } catch (e) {
      console.error("Restore failed:", e);
      setPending((p) => p.filter((r) => r.id !== item.id));
      setArchivedReqs((a) => [item, ...a]);
      addLog(`Couldn't restore ${item.name}'s request`, "warn");
    }
    setRailActionBusy(false);
  }

  // Permanent. Nothing to roll back to if the row is gone, so this waits on the
  // delete before touching the list rather than removing optimistically.
  async function deleteRequest(item) {
    if (railActionBusy) return;
    setRailActionBusy(true);
    try {
      await deleteRailRequest(item.id);
      setPending((p) => p.filter((r) => r.id !== item.id));
      setArchivedReqs((a) => a.filter((r) => r.id !== item.id));
      if (selectedRailId === item.id) setSelectedRailId(null);
      addLog(`Deleted ${item.name}'s request — ${item.dates}`, "warn");
    } catch (e) {
      console.error("Delete failed:", e);
      addLog(`Couldn't delete ${item.name}'s request`, "warn");
    }
    setRailActionBusy(false);
  }

  // Partial approval of a TIME OFF request: only the manager-specified dates get
  // an Off override; a manager note is required. The reply lists approved dates.
  async function resolvePartial(item) {
    if (railBusy) return;
    const managerNote = (railNotes[item.id] || "").trim();
    const approvedText = (partialDates[item.id] || "").trim();
    const isoDates = parseRailDates(approvedText);
    if (!managerNote) { window.alert("A manager note is required for a partial approval."); return; }
    if (!isoDates.length) { window.alert("Enter the approved dates (e.g. \"Jul 28, Jul 30\")."); return; }

    setRailBusy(item.id);
    setPending((p) => p.filter((r) => r.id !== item.id));
    addLog(`Partially approved ${item.name} — Time Off (${approvedText})`, "good");

    try { await updateRailStatus(item.id, "approved", managerNote); }
    catch (e) { console.error("Update request failed:", e); }

    const staffId = item.staffId || nameToId[item.name];
    if (staffId) {
      try { await writeOffDates(item, staffId, isoDates); }
      catch (e) { console.error("Partial schedule update failed:", e); addLog(`Schedule update failed for ${item.name}`, "warn"); }
    } else {
      window.alert(`Partially approved, but no staff match for "${item.name}" — set the days manually.`);
    }

    const reply = await sendRailReply(item.id, true, managerNote, session?.access_token, { partial: true, approvedDatesText: approvedText });
    if (reply?.sent) addLog(`Email reply sent to ${item.name}`, "good");
    else if (reply?.needsReconnect && reply.error !== "gmail_not_connected") { addLog(`Email reply to ${item.name} not sent — Gmail disconnected, reconnect`, "warn"); refreshGmailStatus(); }
    else if (reply?.error && reply.error !== "gmail_not_connected") addLog(`Email reply not sent (${reply.error})`, "warn");

    setRailNotes((n) => { const x = { ...n }; delete x[item.id]; return x; });
    setPartialDates((n) => { const x = { ...n }; delete x[item.id]; return x; });
    setPartialOpen((n) => { const x = { ...n }; delete x[item.id]; return x; });
    setRailBusy(null);
  }

  function zoomToWeek(idx) {
    setWeekIndex(idx);
    setCalView("week");
  }
  // Jump to a date's Tip Sheet from the Calendar (brief item 4). Remembers
  // where we came from so the sheet can offer a way back to the date page.
  function openTipSheetForDate(dateIso) {
    setTipDateIso(dateIso);
    setTipFromDayIso(dateIso);
    setTab("tips");
  }

  // Open a date's notes page (brief item 5). Keeps the month grid pointed at
  // that date's month so "Back to month" lands where you'd expect.
  function openDayPage(dateObj) {
    setCalDate(new Date(dateObj.getFullYear(), dateObj.getMonth(), 1));
    setCalDayIso(iso(dateObj));
    setCalNoteEditId(null);
    setCalNoteDraft("");
    setCalView("day");
  }

  // Item 6: the Calendar only shows schedules that are real — a week that has
  // already happened, or one a manager finalized in Set Schedule. Anything else
  // is still a draft being built, and showing it here would read as settled.
  // Set Schedule is unaffected; you can still build any week there.
  function isWeekViewable(weekStartIso) {
    if (!weekStartIso) return false;
    return weekStartIso < iso(mondayOf(new Date())) || finalizedWeeks.has(weekStartIso);
  }

  /* ---- staff & role management ---- */

  function staffRolesToRows(name, roles, primary, section) {
    // sort_order matters for the BOH/Kitchen/Management grids (row alignment
    // with the slot-indexed schedule data): keep an existing position, else append
    return roles.map((r) => {
      let sort = 0;
      const gk = Object.keys(GROUP_ROLE).find((k) => GROUP_ROLE[k] === r);
      if (gk) {
        const idx = (groupRosters[gk] || []).indexOf(name);
        sort = idx >= 0 ? idx : (groupRosters[gk] || []).length;
      }
      return { role: r, is_primary: r === primary, sort_order: sort };
    });
  }

  function applyStaffLocal(row, roles, primary, prevName) {
    const orderedRoles = [primary, ...roles.filter((r) => r !== primary)];
    setStaffList((l) => {
      const existing = l.some((s) => s.id === row.id && row.id != null) || l.some((s) => s.name === (prevName || row.name));
      if (!existing) return [...l, row];
      return l.map((s) => ((row.id != null && s.id === row.id) || s.name === prevName ? { ...s, ...row } : s));
    });
    if (row.id != null) setNameToId((m) => {
      const next = { ...m };
      if (prevName && prevName !== row.name) delete next[prevName];
      next[row.name] = row.id;
      return next;
    });
    setStaffRolesMap((m) => {
      const next = { ...m };
      if (prevName && prevName !== row.name) delete next[prevName];
      next[row.name] = orderedRoles;
      return next;
    });
    if (prevName && prevName !== row.name) {
      setPatterns((prev) => {
        if (!prev[prevName]) return prev;
        const next = { ...prev, [row.name]: prev[prevName] };
        delete next[prevName];
        return next;
      });
    }
    setGroupRosters((prev) => {
      const next = {};
      Object.entries(GROUP_ROLE).forEach(([gk, roleName]) => {
        let list = (prev[gk] || []).map((n) => (n === prevName ? row.name : n));
        const has = orderedRoles.includes(roleName);
        if (has && !list.includes(row.name)) list = [...list, row.name];
        // deactivated staff keep their row so slot indexes stay aligned
        next[gk] = list;
      });
      return next;
    });
  }

  async function handleAddStaff() {
    const name = newStaff.name.trim();
    setStaffMsg("");
    if (!name) { setStaffMsg("Name is required."); return; }
    if (staffList.some((s) => s.name === name)) { setStaffMsg(`${name} already exists.`); return; }
    let roles = newStaff.roles.filter((r) => SECTION_ROLES[newStaff.section].includes(r));
    if (roles.length === 0) {
      if (newStaff.section === "FOH") { setStaffMsg("Pick at least one role."); return; }
      roles = [SECTION_ROLES[newStaff.section][0]];
    }
    const primary = roles.includes(newStaff.primary) ? newStaff.primary : roles[0];
    try {
      const row = await insertStaff({ name, role: primary, section: newStaff.section });
      if (rolesTableReady) await replaceStaffRoles(row.id, staffRolesToRows(name, roles, primary, newStaff.section));
      applyStaffLocal({ ...row, active: true }, roles, primary, null);
      setNewStaff({ name: "", section: "FOH", roles: [], primary: "" });
      setStaffMsg(`Added ${name}.`);
    } catch (e) {
      console.error("Add staff failed:", e);
      setStaffMsg(`Couldn't add ${name}: ${e.message || e}`);
    }
  }

  function staffDraftFor(s) {
    return (
      staffDrafts[s.id || s.name] || {
        name: s.name,
        active: s.active !== false,
        roles: staffRolesMap[s.name] || [s.role],
        primary: (staffRolesMap[s.name] || [s.role])[0],
      }
    );
  }
  function setStaffDraft(s, patch) {
    const cur = staffDraftFor(s);
    const next = { ...cur, ...patch };
    if (!next.roles.includes(next.primary)) next.primary = next.roles[0] || "";
    setStaffDrafts((d) => ({ ...d, [s.id || s.name]: next }));
  }

  async function handleSaveStaff(s) {
    const d = staffDraftFor(s);
    const name = d.name.trim();
    setStaffMsg("");
    if (!name) { setStaffMsg("Name is required."); return; }
    if (d.roles.length === 0) { setStaffMsg(`${name}: pick at least one role.`); return; }
    if (!s.id) { setStaffMsg("Live data hasn't loaded — can't save yet."); return; }
    const primary = d.roles.includes(d.primary) ? d.primary : d.roles[0];
    try {
      await updateStaff(s.id, { name, role: primary, active: d.active });
      if (rolesTableReady) await replaceStaffRoles(s.id, staffRolesToRows(name, d.roles, primary, s.section));
      applyStaffLocal({ ...s, name, role: primary, active: d.active }, d.roles, primary, s.name);
      setStaffDrafts((drafts) => {
        const next = { ...drafts };
        delete next[s.id || s.name];
        return next;
      });
      setStaffMsg(`Saved ${name}.`);
    } catch (e) {
      console.error("Save staff failed:", e);
      setStaffMsg(`Couldn't save ${name}: ${e.message || e}`);
    }
  }

  async function handleSaveStaffProfile() {
    if (!editingStaffId) return;
    const email = editingStaffEmail.trim();
    const phone = editingStaffPhone.trim();
    try {
      // Save email, phone, and set registered=true
      const patch = { registered: true };
      if (email) patch.personal_email = email;
      if (phone) patch.phone = phone;
      await updateStaff(editingStaffId, patch);

      // Update local state
      setStaffList((list) =>
        list.map((st) =>
          st.id === editingStaffId
            ? { ...st, personal_email: email || null, phone: phone || null, registered: true }
            : st
        )
      );

      // Close modal
      setEditingStaffId(null);
      setStaffMsg("Contact info saved!");
    } catch (e) {
      console.error("Save profile failed:", e);
      setStaffMsg(`Couldn't save contact info: ${e.message || e}`);
    }
  }

  // every Rail request (pending or approved) touching a given date
  function railItemsForDate(isoStr) {
    const items = [];
    pending.forEach((it) => {
      if (railDatesMatch(it.dates, isoStr)) items.push({ ...it, status: "pending" });
    });
    resolvedReqs.forEach((it) => {
      if (it.status === "approved" && railDatesMatch(it.dates, isoStr)) items.push(it);
    });
    return items;
  }
  // staff off that date: approved schedule overrides + REQUEST OFF rail items
  function timeOffNamesForDate(isoStr) {
    const names = new Set();
    Object.entries(overrides).forEach(([key, ov]) => {
      if (ov.type === "OFF" && key.endsWith(`|${isoStr}`)) names.add(key.split("|")[0]);
    });
    railItemsForDate(isoStr).forEach((it) => {
      if (it.type === "REQUEST OFF") names.add(it.name);
    });
    return [...names];
  }

  // FOH dropdown cell: write the picked shift code (which carries its role) into
  // THIS WEEK's own record. The first edit of a week that has never been touched
  // snapshots the whole template week in first, so the week becomes a complete
  // independent record and later template changes can't leak into it.
  function writeCellShift(name, weekday, code) {
    const ws = activeWeekStart;
    const base = weeklyPatterns[ws] || patterns; // exactly what's on screen
    const alreadySeeded = !!weeklyPatterns[ws];
    const nextWeek = {
      ...base,
      [name]: (base[name] || ALL_OFF_WEEK).map((c, i) => (i === weekday ? code : c)),
    };
    setWeeklyPatterns((prev) => ({ ...prev, [ws]: nextWeek }));
    setCellRoleSel((prev) => {
      if (!(`${name}|${weekday}` in prev)) return prev;
      const next = { ...prev };
      delete next[`${name}|${weekday}`];
      return next;
    });
    const staffId = nameToId[name];
    setSchedSaveState("dirty");
    (async () => {
      schedSaveStart();
      // The cell's own write is what decides the indicator: a skipped write
      // (pre-migration tables, unknown staff member) returns false and shows as
      // "Not saved" rather than a save that never happened.
      let ok = false;
      try {
        if (!alreadySeeded) await seedWeeklySchedule(ws, base, nameToId);
        ok = staffId ? await upsertWeeklyShift(ws, staffId, weekday, code) : false;
      } catch (e) {
        console.error("Save weekly shift failed:", e);
        ok = false;
      }
      schedSaveEnd(ok);
    })();
  }
  function setCellShift(name, weekday, code) {
    if (schedulePastWeek || isSectionLocked(activeWeekStart, "foh")) return; // FOH grid, this week only

    const blk = code !== "OFF" ? approvedOffFor(name, weekday) : null;
    if (blk) {
      setTimeOffBlock({
        name, dayLabel: blk.dayLabel,
        onOverride: () => { writeCellShift(name, weekday, code); overwriteApprovedOverride(name, blk.iso, code, blk.override.railId); },
      });
      return;
    }
    writeCellShift(name, weekday, code);
  }
  // role picker changed: remember the choice and reset the cell's shift if the
  // current code belongs to a different role
  function setCellRole(name, weekday, role) {
    if (schedulePastWeek || isSectionLocked(activeWeekStart, "foh")) return;
    setCellRoleSel((prev) => ({ ...prev, [`${name}|${weekday}`]: role }));
    const current = (activePatterns[name] || ALL_OFF_WEEK)[weekday];
    if (current !== "OFF" && roleFromCode(current) !== role) {
      writeCellShift(name, weekday, "OFF");
      setCellRoleSel((prev) => ({ ...prev, [`${name}|${weekday}`]: role })); // writeCellShift clears it
    }
  }

  // code -> label for every option currently configured, so manager-added
  // shifts (which have no SHIFT_META entry) still render their label in the
  // calendar, the PDF sheet and the schedule email instead of a raw code.
  const optionLabels = useMemo(() => {
    const m = {};
    Object.values(roleOptions || {}).forEach((list) => {
      (list || []).forEach((o) => { if (o?.code) m[o.code] = o.label; });
    });
    return m;
  }, [roleOptions]);

  function shiftLabelForType(type) {
    if (!type || type === "OFF") return "Off";
    return SHIFT_META[type]?.label || optionLabels[type] || type;
  }
  function weekDayHeaders(week) {
    return week.map((d) => `${JS_WEEKDAY_NAMES[d.weekday]} ${d.date.getMonth() + 1}/${d.date.getDate()}`);
  }
  function weekRangeLabel(week) {
    return `${week[0].date.toLocaleDateString(undefined, MONTH_FMT)} – ${week[6].date.toLocaleDateString(undefined, MONTH_FMT)}`;
  }
  // Shared sheet/email metadata: MON–SUN day cells, index of today within the
  // week (-1 when outside it), and which managers are on per day (same rule as
  // the on-screen "Manager on" banner).
  function sheetDays(week) {
    return week.map((d) => ({ dow: JS_WEEKDAY_NAMES[d.weekday].toUpperCase(), date: `${d.date.getMonth() + 1}/${d.date.getDate()}` }));
  }
  function sheetTodayIdx(week) {
    return week.findIndex((d) => iso(d.date) === TODAY_ISO);
  }
  function buildManagerOn(week) {
    const ph = placeholdersForWeekStart(week?.[0]?.iso);
    return week.map((d) =>
      (groupRosters.management || []).filter(
        (_, idx) => !isOffCell(ph.management?.[idx]?.[d.weekday])
      )
    );
  }
  // Primary role per person for the cross-role label. FOH people: their roster
  // row's role (the group they sit under — DEFAULT_STAFF_ROLES first entry).
  // BOH+Kitchen: BOH membership wins (Freddy is in both rosters and is
  // BOH-primary), else Kitchen (covers Jon, who's Kitchen-primary here even
  // though his staff section is Management).
  function primaryRoleFor(name) {
    const foh = fohRoster.find((p) => p.name === name);
    if (foh) return foh.role;
    if ((groupRosters.boh || []).includes(name)) return "BOH";
    if ((groupRosters.kitchen || []).includes(name)) return "Kitchen";
    // Managers — so an Expo day on the Management grid gets its cross-role label.
    if ((groupRosters.management || []).includes(name)) return "Management";
    return null;
  }
  // No label when the person has no known primary or is working it.
  function isPrimaryRole(name, roleWorked) {
    const primary = primaryRoleFor(name);
    return !primary || !roleWorked || primary === roleWorked;
  }

  // FOH rows grouped by role, in the on-screen group order (for the branded
  // PDF sheet + HTML email). `roles` carries the role actually worked per day
  // (from the shift code, e.g. Akira's BAR_6CL day is "Bar") so cells color by
  // role worked, not by the section row.
  // FOH sheet group order matches the Tip Sheet and Glance (orderWorking):
  // Servers, Busser/Runner, Host, Bar — no Expo group, Expo is a cross-role
  // assignment, not anyone's home role. Anything else (Training) follows.
  function buildFohSheetGroups(week) {
    const wp = patternsForWeekStart(week?.[0]?.iso);
    const rank = (r) => { const i = WORK_GROUP_ORDER.indexOf(r); return i < 0 ? WORK_GROUP_ORDER.length : i; };
    return [...fohRoleGroups].sort((a, b) => rank(a) - rank(b)).map((role) => ({
      label: role,
      rows: fohRoster
        .filter((p) => p.role === role)
        .map((p) => {
          const types = week.map((d) => personShiftFor(p.name, d, wp, overrides).type);
          return {
            name: p.name,
            primaryRole: p.role,
            shifts: types.map(shiftLabelForType),
            roles: types.map((t) => roleForCell(t, p.role)),
          };
        }),
    }));
  }
  // FOH schedule-email payload: 7 day headers + per-person shifts. `rows` stays
  // flat for the preview modal; `groups`/`managerOn`/`todayIdx`/`days` feed the
  // redesigned HTML email (older payloads without them still render).
  function buildSchedulePayload(week) {
    const wp = patternsForWeekStart(week?.[0]?.iso);
    const rows = fohRoster.map((p) => ({
      name: p.name,
      shifts: week.map((d) => shiftLabelForType(personShiftFor(p.name, d, wp, overrides).type)),
    }));
    return {
      weekLabel: weekRangeLabel(week),
      dayHeaders: weekDayHeaders(week),
      rows,
      groups: buildFohSheetGroups(week),
      days: sheetDays(week),
      todayIdx: sheetTodayIdx(week),
      managerOn: buildManagerOn(week),
    };
  }
  // Display label for a placeholder (BOH/Kitchen) shift code, incl. the Jenny/
  // Ajuma "Yes" rule used on the grid.
  function placeholderShiftLabel(gk, personName, code) {
    if (!code || code === "OFF") return "Off";
    if (gk === "kitchen" && code === "KITCHEN" && (personName.startsWith("Jenny") || personName.startsWith("Ajuma"))) return "Yes";
    return SHIFT_META[code]?.label || optionLabels[code] || code;
  }
  function buildGroupRows(gk, week) {
    const ph = placeholdersForWeekStart(week?.[0]?.iso);
    return (groupRosters[gk] || []).map((personName, idx) => {
      const codes = week.map((d) => ph[gk]?.[idx]?.[d.weekday] || "OFF");
      return {
        name: personName,
        primaryRole: primaryRoleFor(personName),
        shifts: codes.map((c) => placeholderShiftLabel(gk, personName, c)),
        roles: codes.map((c) => roleForCell(c, GROUP_ROLE[gk])),
      };
    });
  }
  // BOH+Kitchen email payload: Kitchen group first, then BOH (rendered with a divider).
  function buildBohKitchenPayload(week) {
    return {
      weekLabel: weekRangeLabel(week),
      dayHeaders: weekDayHeaders(week),
      sectionLabel: "BOH & Kitchen",
      groups: [
        { label: "Kitchen", rows: buildGroupRows("kitchen", week) },
        { label: "BOH", rows: buildGroupRows("boh", week) },
      ],
      days: sheetDays(week),
      todayIdx: sheetTodayIdx(week),
      managerOn: buildManagerOn(week),
    };
  }


  const activeWeek = buildWeekByOffset(weekIndex);
  const weekIsFinalized = finalizedWeeks.has(activeWeekStart);
  const weekPublishedAt = publishedWeekStarts.has(activeWeekStart) ? publishedAtByWeek[activeWeekStart] : null;
  // Publish is gated on the week ON SCREEN being finalized — current or future,
  // not just this week (brief item 3) — and sends every finalized week that
  // hasn't gone out yet. Past weeks are excluded: Publish isn't offered there.
  const unpublishedFinalizedWeeks = useMemo(
    () => [...finalizedWeeks].filter((w) => !publishedWeekStarts.has(w)).sort(),
    [finalizedWeeks, publishedWeekStarts]
  );

  return (
    <div className="hub">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Manrope:wght@500;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');

        .hub { font-family: 'Manrope', sans-serif; background: radial-gradient(ellipse at top, #26241f 0%, #1a1815 60%, #151310 100%); color: #EDE7D9; min-height: 100vh; padding: 32px 24px 60px; box-sizing: border-box; }
        .hub * { box-sizing: border-box; }

        .hub-header { display: flex; align-items: baseline; justify-content: space-between; max-width: 1180px; margin: 0 auto 8px; padding-bottom: 18px; flex-wrap: wrap; gap: 10px; }
        .hub-brand { display: flex; align-items: center; gap: 12px; }
        .hub-icon { height: 30px; width: auto; }
        .template-icon { height: 46px; width: auto; display: block; margin: 4px 0 10px; }
        .hub-title { font-family: 'Space Mono', monospace; font-weight: 700; font-size: 22px; letter-spacing: 4px; color: #EDE7D9; }
        .hub-date { font-family: 'Space Mono', monospace; font-size: 12px; letter-spacing: 1px; color: #A79E8C; }

        .tabs { max-width: 1180px; margin: 0 auto 28px; display: flex; gap: 22px; border-bottom: 1px solid rgba(237,231,217,0.14); }
        .tab-btn { background: none; border: none; cursor: pointer; font-family: 'Space Mono', monospace; font-size: 11.5px; letter-spacing: 2px; text-transform: uppercase; color: #7d7666; padding: 0 2px 12px; border-bottom: 2px solid transparent; }
        .tab-btn.active { color: #C98A3E; border-bottom-color: #C98A3E; }

        .subtabs { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
        .subtab-btn { font-family: 'Manrope', sans-serif; font-weight: 700; font-size: 11.5px; padding: 6px 13px; border-radius: 20px; border: 1px solid rgba(43,42,37,0.15); background: transparent; color: #6b6355; cursor: pointer; }
        .subtab-btn.active { background: #2B2A25; color: #F5F0E3; border-color: #2B2A25; }
        .subtab-btn:hover:not(.active) { background: rgba(43,42,37,0.06); }

        .hub-grid { max-width: 1180px; margin: 0 auto; display: grid; grid-template-columns: 1.6fr 1fr; gap: 28px; align-items: start; }
        @media (max-width: 860px) { .hub-grid { grid-template-columns: 1fr; } }

        /* ---- Rail "Option 2" — clean design pulled from the Haenyeo brand mark ---- */
        .nr-wrap { max-width: 1180px; margin: 0 auto; font-family: 'Plus Jakarta Sans', sans-serif; }
        .nr-card { background: #EAEBE7; border-radius: 20px; padding: 28px 30px 34px; color: #2F3432; box-shadow: 0 20px 50px rgba(0,0,0,0.35); }
        .nr-grid { display: grid; grid-template-columns: 1.6fr 1fr; gap: 30px; }
        @media (max-width: 860px) { .nr-grid { grid-template-columns: 1fr; } }

        .nr-label { font-size: 12px; font-weight: 700; letter-spacing: 0.4px; color: #85897F; text-transform: uppercase; margin-bottom: 12px; display: flex; align-items: center; gap: 6px; }
        .nr-count { background: #DFE1DB; color: #2F3432; border-radius: 20px; padding: 1px 9px; font-size: 11px; }

        .nr-item { background: #F0F0EC; border-radius: 16px; padding: 18px 20px; margin-bottom: 12px; box-shadow: 0 1px 2px rgba(47,52,50,0.05); border: 1px solid rgba(47,52,50,0.06); }
        .nr-item-top { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
        .nr-hex { width: 30px; height: 30px; flex-shrink: 0; clip-path: polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0% 50%); display: flex; align-items: center; justify-content: center; }
        .nr-hex span { color: #fff; font-weight: 700; font-size: 12px; }
        .nr-item-name { font-weight: 700; font-size: 16px; }
        .nr-item-type { font-size: 11.5px; color: #85897F; font-weight: 500; }
        .nr-item-dates { margin-left: auto; font-weight: 700; font-size: 14.5px; color: #2F3432; }
        .nr-urgent { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; font-weight: 700; color: #B3695E; background: #F1DFDB; padding: 2px 9px; border-radius: 20px; margin-left: 6px; white-space: nowrap; }
        .nr-unmatched { display: inline-flex; align-items: center; gap: 3px; font-size: 9.5px; font-weight: 700; color: #9a5a1f; background: #F5E6CE; padding: 2px 8px; border-radius: 20px; margin-left: 8px; vertical-align: 2px; white-space: nowrap; }
        .nr-item-note { font-size: 13px; color: #5c625f; line-height: 1.5; margin: 6px 0 14px; padding-left: 40px; }

        /* Gmail connection status bar (top of the Rail card) */
        .nr-item-reply { padding-left: 40px; }
        .nr-manager-note { width: 100%; box-sizing: border-box; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 12.5px; padding: 8px 11px; border: 1px solid rgba(47,52,50,0.14); border-radius: 9px; background: #FBFBF9; color: #2F3432; margin-bottom: 10px; }
        .nr-manager-note::placeholder { color: #a7aba2; }
        .nr-manager-note:focus { outline: none; border-color: #8FA396; background: #fff; }
        .nr-item-actions { display: flex; gap: 10px; }

        .nr-btn { display: flex; align-items: center; gap: 6px; font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 12.5px; padding: 7px 15px; border-radius: 9px; border: none; cursor: pointer; }
        .nr-btn-approve { background: #2F3432; color: #F0F0EC; }
        .nr-btn-partial { background: #E7EAF2; color: #33425C; border: 1px solid #b9c2d4; }
        .nr-btn-deny { background: #E8E9E4; color: #5c625f; }
        .nr-btn:hover:not(:disabled) { opacity: 0.88; }
        .nr-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .nr-empty { text-align: center; padding: 40px 20px; color: #9a9e95; font-size: 13.5px; background: #F0F0EC; border-radius: 16px; border: 1px dashed rgba(47,52,50,0.15); }

        .nr-panel { background: #F0F0EC; border-radius: 16px; padding: 16px 18px; margin-bottom: 18px; border: 1px solid rgba(47,52,50,0.06); }
        .nr-row { display: flex; justify-content: space-between; align-items: center; padding: 7px 0; border-bottom: 1px solid #E8E9E4; font-size: 13.5px; }
        .nr-row:last-child { border-bottom: none; }
        .nr-dot { width: 7px; height: 7px; border-radius: 50%; background: #8FA396; display: inline-block; margin-right: 9px; }
        .nr-row-status { color: #85897F; font-size: 12px; }
        /* Today at a Glance group labels — same small-caps label treatment as
           the Tip Sheet's section labels; no rule line. */
        .rs-glance-group { font-family: 'Space Mono', monospace; font-size: 9px; letter-spacing: 1.5px; text-transform: uppercase; color: #666; padding: 10px 0 2px; }
        .rs-glance-group:first-child { padding-top: 0; }
        .rs-glance-swing { margin-left: 5px; font-size: 10.5px; color: #666; }

        .nr-log-row { padding: 7px 0; border-bottom: 1px solid #E8E9E4; font-size: 12px; }
        .nr-log-row:last-child { border-bottom: none; }
        .nr-log-time { color: #9a9e95; font-size: 10.5px; margin-left: 6px; }
        .nr-log-good { color: #6d8a76; } .nr-log-warn { color: #B3695E; } .nr-log-neutral { color: #5c625f; }

        .nr-week-panel { padding: 14px 12px; }
        .nr-week-strip { display: flex; justify-content: space-between; gap: 4px; }
        .nr-day { flex: 1; text-align: center; padding: 6px 2px; border-radius: 8px; }
        .nr-day-name { font-size: 9.5px; letter-spacing: 0.5px; text-transform: uppercase; color: #9a9e95; font-weight: 600; }
        .nr-day-num { font-weight: 700; font-size: 13px; color: #2F3432; margin-top: 2px; }
        .nr-day-today { background: #DFE1DB; }
        .nr-day-today .nr-day-name, .nr-day-today .nr-day-num { color: #2F3432; }
        .nr-holiday-dot { width: 5px; height: 5px; border-radius: 50%; background: #B3695E; margin: 3px auto 0; }
        .nr-holiday-note { margin-top: 10px; padding-top: 8px; border-top: 1px solid #E8E9E4; font-size: 10.5px; color: #85897F; text-align: center; }

        .col-label { font-family: 'Space Mono', monospace; font-size: 11px; letter-spacing: 2.5px; text-transform: uppercase; color: #A79E8C; margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }
        .count-pill { background: rgba(201,138,63,0.18); color: #C98A3E; border-radius: 20px; padding: 1px 9px; font-size: 11px; }

        .decision-list { display: flex; flex-direction: column; gap: 14px; }
        .empty-decisions { font-family: 'Space Mono', monospace; color: #7d7666; font-size: 13px; text-align: center; padding: 40px 10px; border: 1px dashed rgba(237,231,217,0.15); border-radius: 10px; }
        .decision-card { background: #F5F0E3; color: #2B2A25; border-radius: 8px; border-left: 4px solid; padding: 16px 18px; box-shadow: 0 3px 12px rgba(0,0,0,0.28); }
        .decision-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 10px; }
        .decision-main { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 4px; }
        .decision-name { font-weight: 800; font-size: 16px; }
        .decision-dates { font-family: 'Space Mono', monospace; font-weight: 700; font-size: 15px; color: #4a473d; white-space: nowrap; }
        .decision-notice { font-size: 11px; color: #6b6355; margin-bottom: 8px; }
        .decision-note { font-size: 12.5px; color: #4a473d; line-height: 1.4; padding-top: 8px; border-top: 1px dashed rgba(43,42,37,0.2); margin-bottom: 12px; }
        .decision-actions { display: flex; gap: 8px; }

        .rail { background: repeating-linear-gradient(180deg, #1e1c18 0px, #1e1c18 2px, #201e19 2px, #201e19 4px); border-radius: 10px; padding: 20px 18px 28px; min-height: 200px; box-shadow: inset 0 2px 10px rgba(0,0,0,0.5); }
        .empty-rail { font-family: 'Space Mono', monospace; color: #6b6355; font-size: 13px; text-align: center; padding: 30px 10px; }

        .ticket { background: #F5F0E3; color: #2B2A25; border-radius: 3px; padding: 16px 18px 14px; margin-bottom: 22px; position: relative; box-shadow: 0 6px 14px rgba(0,0,0,0.35); transform: rotate(var(--r, 0deg)); }
        .ticket:last-child { margin-bottom: 4px; }
        .ticket::before { content: ""; position: absolute; top: -8px; left: 22px; width: 14px; height: 14px; border-radius: 50%; background: #16140f; box-shadow: 0 2px 3px rgba(0,0,0,0.4); border: 3px solid #8c8574; }
        .ticket::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 8px; background: radial-gradient(circle at 6px 0, transparent 5px, #F5F0E3 5.5px) repeat-x; background-size: 12px 8px; }
        .ticket-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; gap: 10px; }
        .type-badge { font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; color: #fff; padding: 3px 8px; border-radius: 3px; white-space: nowrap; }
        .urgent-flag { display: flex; align-items: center; gap: 4px; font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: 1px; color: #B23A2F; text-transform: uppercase; }
        .ticket-name { font-weight: 800; font-size: 17px; margin: 2px 0 6px; }
        .ticket-dates { font-family: 'Space Mono', monospace; font-size: 20px; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 6px; }
        .ticket-notice { font-size: 11px; color: #6b6355; margin-bottom: 8px; }
        .ticket-note { font-size: 12.5px; color: #4a473d; line-height: 1.4; padding-top: 8px; border-top: 1px dashed rgba(43,42,37,0.25); margin-bottom: 12px; }
        .ticket-actions { display: flex; gap: 8px; }
        .btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; font-family: 'Manrope', sans-serif; font-weight: 700; font-size: 12.5px; padding: 8px 0; border-radius: 4px; border: none; cursor: pointer; transition: transform 0.12s ease, opacity 0.12s ease; }
        .btn:hover { transform: translateY(-1px); }
        .btn:active { transform: translateY(0); opacity: 0.85; }
        .btn-approve { background: #4C6B4F; color: #F5F0E3; }
        .btn-deny { background: transparent; color: #7a4238; border: 1.5px solid #a35a4c; }

        .side-card { background: rgba(237,231,217,0.05); border: 1px solid rgba(237,231,217,0.1); border-radius: 10px; padding: 18px; margin-bottom: 22px; }
        .mini-week-card { padding: 14px 12px; }
        .mini-week-strip { display: flex; justify-content: space-between; gap: 4px; }
        .mini-day { flex: 1; text-align: center; padding: 6px 2px; border-radius: 6px; position: relative; }
        .mini-day-name { font-family: 'Space Mono', monospace; font-size: 9px; letter-spacing: 0.5px; text-transform: uppercase; color: #7d7666; }
        .mini-day-num { font-family: 'Space Mono', monospace; font-weight: 700; font-size: 13px; color: #EDE7D9; margin-top: 2px; }
        .mini-day.mini-today { background: rgba(201,138,63,0.18); }
        .mini-day.mini-today .mini-day-name, .mini-day.mini-today .mini-day-num { color: #C98A3E; }
        .mini-holiday-dot { width: 5px; height: 5px; border-radius: 50%; background: #C1442E; margin: 3px auto 0; }
        .mini-holiday-note { margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(237,231,217,0.08); font-size: 11px; color: #A79E8C; text-align: center; }
        .roster-row { display: flex; align-items: center; justify-content: space-between; padding: 7px 0; border-bottom: 1px solid rgba(237,231,217,0.06); font-size: 13.5px; }
        .log-row { align-items: flex-start; gap: 10px; }
        .log-row span:first-child { flex: 1; line-height: 1.4; }
        .log-row .dot { margin-top: 5px; }
        .log-row .roster-status { flex-shrink: 0; }
        .roster-row:last-child { border-bottom: none; }
        .dot { width: 7px; height: 7px; border-radius: 50%; margin-right: 8px; display: inline-block; }
        .dot-in { background: #6E9B72; } .dot-gap { background: #C1442E; } .dot-off { background: #6b6355; }
        .roster-status { color: #A79E8C; font-size: 12px; font-family: 'Space Mono', monospace; }

        /* -------- calendar -------- */
        @keyframes zoomIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        .cal-wrap { max-width: 1180px; margin: 0 auto; animation: zoomIn 0.28s ease; }

        .cal-card { background: #F5F0E3; border-radius: 10px; padding: 18px 18px 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.35); color: #2B2A25; }
        .cal-legend { display: flex; gap: 16px; flex-wrap: wrap; margin: 0 0 16px 2px; }
        .legend-item { display: flex; align-items: center; gap: 6px; font-family: 'Space Mono', monospace; font-size: 10.5px; color: #6b6355; text-transform: uppercase; letter-spacing: 0.5px; }
        .legend-swatch { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }

        .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
        /* 3-month view: three side-by-side month grids, flat/open (no card backgrounds) */
        .cal-grid.multi-month { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 22px; }
        .cal-grid.multi-month .cal-month { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; align-content: start; }
        .cal-grid.multi-month .cal-month-label { grid-column: 1 / -1; font-family: 'Space Mono', monospace; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; font-weight: 700; color: #8c8574; text-align: center; margin-bottom: 3px; }
        .cal-grid.multi-month .cal-month-label.current { color: #C98A3E; }
        .cal-grid.multi-month .cal-weekday { font-size: 8.5px; padding-bottom: 3px; min-height: 15px; letter-spacing: 0.5px; }
        .cal-grid.multi-month .cal-day { min-height: 46px; padding: 4px 3px 5px; font-size: 11px; }
        .cal-grid.multi-month .cal-day-num { font-size: 11px; }
        .cal-grid.multi-month .cal-day.today .cal-day-num { width: 18px; height: 18px; }
        @media (max-width: 900px) { .cal-grid.multi-month { grid-template-columns: 1fr; } }
        .cal-weekday { font-family: 'Space Mono', monospace; font-size: 10.5px; letter-spacing: 1.5px; text-transform: uppercase; color: #8c8574; text-align: center; padding-bottom: 6px; }
        .cal-day { background: #FBF8EF; border: 1px solid rgba(43,42,37,0.08); border-radius: 6px; padding: 8px 8px 10px; min-height: 84px; cursor: pointer; transition: transform 0.12s ease, box-shadow 0.12s ease; position: relative; }
        .cal-day:hover { transform: translateY(-2px); box-shadow: 0 6px 14px rgba(0,0,0,0.18); }
        .cal-day.dim { opacity: 0.38; }
        .cal-day.today { border: 1.5px solid #C98A3E; }
        .cal-day-num { font-family: 'Space Mono', monospace; font-weight: 700; font-size: 13px; color: #2B2A25; }
        /* filled accent circle behind today's number (calendar month view) */
        .cal-day.today .cal-day-num { background: #C98A3E; color: #2B2A25; width: 22px; height: 22px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; }
        .today-pill { font-family: 'Manrope', sans-serif; font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #2B2A25; background: #C98A3E; border-radius: 12px; padding: 2px 9px; }
        .cal-day-meta { margin-top: 10px; font-size: 10.5px; color: #6b6355; line-height: 1.5; }
        .cal-gap-flag { position: absolute; top: 7px; right: 7px; color: #B23A2F; }

        .week-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 40px; }
        .back-btn { display: flex; align-items: center; gap: 4px; background: none; border: none; cursor: pointer; font-family: 'Space Mono', monospace; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #6b6355; padding: 0; }
        .back-btn:hover { color: #2B2A25; }
        .week-range { font-family: 'Space Mono', monospace; font-weight: 700; font-size: 14px; color: #2B2A25; letter-spacing: 1px; }

        .week-table { width: 100%; border-collapse: collapse; }
        .week-table th { font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: #8c8574; padding: 6px 4px; text-align: center; font-weight: 400; }
        .week-table th.today-col, .week-table td.today-col { background: rgba(201,138,63,0.08); }
        .week-table th.today-col { color: #8a5a20; border-bottom: 2px solid #C98A3E; }
        .emp-name { font-size: 12.5px; font-weight: 700; color: #2B2A25; padding: 8px 8px 8px 2px; white-space: nowrap; border-top: 1px solid rgba(43,42,37,0.08); }
        .role-header { font-family: 'Space Mono', monospace; font-size: 10.5px; letter-spacing: 2px; text-transform: uppercase; color: #C98A3E; padding: 14px 2px 4px; border-bottom: 1px solid rgba(43,42,37,0.12); }
        .week-table td.shift-cell { border-top: 1px solid rgba(43,42,37,0.08); padding: 6px 4px; text-align: center; }
        .shift-chip { display: inline-block; width: 100%; padding: 5px 2px; border-radius: 4px; font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; border: 1px solid; position: relative; }
        .swap-ribbon { position: absolute; top: -6px; right: -4px; background: #5B7C99; color: #fff; font-size: 8px; padding: 1px 4px; border-radius: 3px; letter-spacing: 0.5px; }

        .chip-btn { cursor: pointer; transition: transform 0.1s ease, box-shadow 0.1s ease; }
        .chip-btn:hover { transform: scale(1.04); box-shadow: 0 2px 6px rgba(0,0,0,0.15); }
        .chip-btn:active { transform: scale(0.97); }

        .publish-btn { background: #4C6B4F; color: #F5F0E3; border: none; border-radius: 5px; padding: 8px 16px; font-family: 'Manrope', sans-serif; font-weight: 700; font-size: 12px; cursor: pointer; }
        .publish-btn:hover { transform: translateY(-1px); }
        .published-badge { display: flex; align-items: center; gap: 5px; color: #4C6B4F; font-family: 'Space Mono', monospace; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; }

        .template-note { margin-top: 14px; font-size: 12px; color: #6b6355; font-style: italic; }

        .tip-inputs { display: flex; gap: 24px; flex-wrap: wrap; margin-bottom: 10px; align-items: flex-end; }
        .tip-field { display: flex; flex-direction: column; gap: 5px; }
        .tip-field label { font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: #8c8574; }
        .tip-field input { font-family: 'Space Mono', monospace; font-size: 13px; padding: 7px 9px; border: 1px solid rgba(43,42,37,0.15); border-radius: 4px; width: 110px; background: #FBF8EF; color: #2B2A25; }
        .tip-stat { font-family: 'Space Mono', monospace; font-size: 15px; color: #2B2A25; padding: 6px 0; }
        .tip-stat b { color: #C98A3E; }
        .tip-table-input { width: 52px; font-family: 'Space Mono', monospace; font-size: 11px; padding: 4px; border: 1px solid rgba(43,42,37,0.15); border-radius: 3px; background: #FBF8EF; color: #2B2A25; text-align: center; }
        .tip-time-input { width: 88px; font-family: 'Manrope', sans-serif; font-size: 12px; padding: 6px 4px; border: none; border-bottom: 1.5px solid rgba(43,42,37,0.25); background: transparent; color: #2B2A25; text-align: center; }
        .tip-time-input:focus { outline: none; border-bottom-color: #C98A3E; }
        .tip-time-input::placeholder { color: #c7bfa9; }
        .tip-time-input:disabled { opacity: 0.3; border-bottom-style: dotted; }
        .tip-name-input { width: 100%; min-width: 110px; font-family: 'Manrope', sans-serif; font-weight: 700; font-size: 14px; padding: 5px 7px; border: 1px solid rgba(201,138,63,0.4); border-radius: 3px; background: #FFFDF7; color: #2B2A25; }
        .tip-name-display { font-weight: 700; font-size: 14px; }
        .tip-position { font-size: 11px; color: #2B2A25; padding: 8px 8px 8px 2px; white-space: nowrap; border-top: 1px solid rgba(43,42,37,0.08); }
        .slot-empty { color: #c7bfa9; font-family: 'Space Mono', monospace; }

        .tip-finalized-banner { display: flex; align-items: center; gap: 8px; background: #E6F0E6; border: 1px solid #7BA37E; color: #2f5232; font-family: 'Space Mono', monospace; font-weight: 700; font-size: 13px; letter-spacing: 1px; padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; }
        .tip-finalized-sub { font-family: 'Manrope', sans-serif; font-weight: 500; font-size: 11.5px; letter-spacing: 0; color: #5c705d; margin-left: 6px; }
        .tip-locked input, .tip-locked .add-payout-btn, .tip-locked .remove-payout-btn, .tip-locked .custom-toggle { pointer-events: none; opacity: 0.6; background: #f1ece0; }
        /* Same shape as the finalized banner, red instead of green — a locked
           date is frozen, not sent. */
        .tip-locked-banner { display: flex; align-items: center; gap: 8px; background: #F6E7E5; border: 1px solid #B23A2F; color: #8a2b22; font-family: 'Space Mono', monospace; font-weight: 700; font-size: 13px; letter-spacing: 1px; padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; flex-wrap: wrap; }
        .tip-locked-banner .tip-finalized-sub { color: #8a5049; }
        .tip-page-split { display: flex; gap: 22px; align-items: stretch; }
        .tip-left-col { width: 300px; flex-shrink: 0; display: flex; flex-direction: column; }
        .tip-right-col { flex: 1; min-width: 0; }
        @media screen and (max-width: 860px) { .tip-page-split { flex-direction: column; } .tip-left-col { width: 100%; } } /* screen only — printing must never stack the sheet */

        .tip-logo-space { min-height: 170px; display: flex; align-items: center; justify-content: center; }
        .tip-logo-img { max-width: 300px; max-height: 165px; object-fit: contain; }

        .cash-recon { background: #FBF8EF; border: 1px solid rgba(43,42,37,0.12); border-radius: 8px; padding: 14px 16px; }
        .recon-title { font-family: 'Space Mono', monospace; font-size: 13px; letter-spacing: 2px; text-transform: uppercase; color: #8c8574; margin-bottom: 10px; text-align: center; }
        .recon-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 1px dashed rgba(43,42,37,0.1); }
        .recon-row label { font-size: 11.5px; color: #4a473d; }
        .recon-row input { width: 80px; font-family: 'Space Mono', monospace; font-size: 11.5px; padding: 4px 6px; border: 1px solid rgba(43,42,37,0.15); border-radius: 3px; background: #FFFDF7; color: #2B2A25; text-align: right; }
        .recon-row.computed span { font-family: 'Space Mono', monospace; font-size: 11.5px; color: #6b6355; }
        .recon-row.final { border-bottom: none; border-top: 2px solid rgba(43,42,37,0.2); margin-top: 4px; padding-top: 8px; }
        .recon-row.final label { font-weight: 700; color: #2B2A25; }
        .recon-row.final span { font-family: 'Space Mono', monospace; font-weight: 700; font-size: 13.5px; color: #C98A3E; }
        .recon-note { font-size: 10.5px; color: #8c8574; font-style: italic; margin-top: 8px; line-height: 1.4; text-align: center; }
        /* Amber, not red: the sheet is correct, the manager just needs to know
           a name they may have expected isn't on it. */
        .tip-off-note { display: flex; align-items: flex-start; gap: 7px; margin-top: 14px; padding: 9px 12px; border: 1px solid #C98A3E; background: #FBF0DE; color: #8a5a20; border-radius: 7px; font-size: 11.5px; line-height: 1.45; }

        .denom-table { margin-bottom: 10px; border-bottom: 1px solid rgba(43,42,37,0.15); padding-bottom: 8px; }
        .denom-header { display: grid; grid-template-columns: 44px 1fr 1fr; gap: 6px; font-family: 'Space Mono', monospace; font-size: 9.5px; letter-spacing: 1px; text-transform: uppercase; color: #8c8574; padding-bottom: 3px; }
        .denom-row { display: grid; grid-template-columns: 44px 1fr 1fr; gap: 6px; align-items: center; padding: 2px 0; }
        .denom-label { font-family: 'Space Mono', monospace; font-size: 11.5px; color: #4a473d; }
        .denom-row input { width: 100%; font-family: 'Space Mono', monospace; font-size: 11px; padding: 3px 4px; border: 1px solid rgba(43,42,37,0.15); border-radius: 3px; background: #FFFDF7; color: #2B2A25; text-align: center; }
        .denom-row.totals { margin-top: 4px; padding-top: 5px; border-top: 1px solid rgba(43,42,37,0.15); font-family: 'Space Mono', monospace; font-size: 11.5px; font-weight: 700; color: #2B2A25; }
        .denom-row.totals span:not(.denom-label) { text-align: center; }

        .payouts-block { margin: 6px 0; padding: 8px 0; border-bottom: 1px dashed rgba(43,42,37,0.1); }
        .payouts-header { display: flex; justify-content: space-between; align-items: center; font-size: 11.5px; color: #4a473d; margin-bottom: 6px; }
        .add-payout-btn { font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: 0.5px; background: none; border: 1px solid rgba(201,138,63,0.5); color: #8a5a20; border-radius: 4px; padding: 3px 8px; cursor: pointer; }
        .add-payout-btn:hover { background: rgba(201,138,63,0.1); }
        .tip-out-toggle { margin-left: 6px; font-family: 'Space Mono', monospace; font-size: 9px; letter-spacing: 0.5px; background: none; border: 1px solid rgba(178,58,47,0.5); color: #B23A2F; border-radius: 4px; padding: 1px 6px; cursor: pointer; vertical-align: middle; }
        .tip-out-toggle.on { border-color: rgba(201,138,63,0.5); color: #8a5a20; }
        .tip-out-toggle:disabled { cursor: not-allowed; opacity: 0.5; }
        /* Same red as a coverage gap on Today at a Glance; bold because it is small text on the dark card. */
        .tip-out-na { color: #B23A2F; font-weight: 700; }
        .payout-empty { font-size: 10.5px; color: #c7bfa9; font-style: italic; padding: 2px 0 4px; }
        .payout-row { display: flex; gap: 5px; margin-bottom: 5px; align-items: center; }
        .payout-row input[type="text"] { flex: 1; min-width: 0; font-size: 11px; padding: 4px 6px; border: 1px solid rgba(43,42,37,0.15); border-radius: 3px; background: #FFFDF7; color: #2B2A25; }
        .payout-row input[type="number"] { width: 62px; font-family: 'Space Mono', monospace; font-size: 11px; padding: 4px 6px; border: 1px solid rgba(43,42,37,0.15); border-radius: 3px; background: #FFFDF7; color: #2B2A25; text-align: right; }
        .remove-payout-btn { background: none; border: none; color: #B23A2F; cursor: pointer; padding: 2px; flex-shrink: 0; }

        .floor-check-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: 18px 0 4px; flex-wrap: wrap; }
        .check-box { border-radius: 7px; padding: 8px 14px; border: 1px solid; }
        .check-box.match { background: #E6F0E6; border-color: #7BA37E; }
        .check-box.mismatch { background: #FBEDE3; border-color: #C98A3E; }
        .check-label { font-family: 'Space Mono', monospace; font-size: 9.5px; letter-spacing: 1px; text-transform: uppercase; color: #55503f; }
        .check-value { font-family: 'Space Mono', monospace; font-weight: 700; font-size: 16px; color: #2B2A25; }
        .check-sub { font-size: 10.5px; color: #4a473d; }
        .custom-toggle { font-family: 'Space Mono', monospace; font-size: 10.5px; letter-spacing: 1px; text-transform: uppercase; padding: 7px 12px; border-radius: 4px; border: 1px solid rgba(43,42,37,0.2); background: #FBF8EF; color: #6b6355; cursor: pointer; white-space: nowrap; }
        .tip-staff-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        /* .print-only is the counterpart of .screen-only: hidden on screen, shown
           on paper (@media print below) and in the PDF capture (.tip-pdf-mode). */
        .print-only { display: none !important; }
        .tip-sheet-date { font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: #8c8574; text-align: left; margin: -4px 0 10px; }
        /* Manager sign-off: same writing rule as the cash box (1px #d0d0d0, no
           verticals), filling the gap right of the floor check. */
        .tip-signoff { flex: 1 1 auto; align-self: flex-end; align-items: flex-end; gap: 22px; margin-left: 18px; }
        .tip-sign-main { flex: 1 1 auto; }
        .tip-sign-date { flex: 0 0 130px; }
        .tip-sign-rule { height: 28px; border-bottom: 1px solid #d0d0d0; }
        .tip-sign-label { font-family: 'Space Mono', monospace; font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: #8c8574; margin-top: 4px; }
        .add-staff-btn { font-family: 'Space Mono', monospace; font-size: 10.5px; letter-spacing: 1px; text-transform: uppercase; padding: 7px 12px; border-radius: 4px; border: 1px solid rgba(43,42,37,0.2); background: #FBF8EF; color: #6b6355; cursor: pointer; white-space: nowrap; }
        .add-staff-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .tip-name-display { display: inline-flex; align-items: center; gap: 6px; }
        .slot-remove-btn { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: #a39a88; cursor: pointer; opacity: 0.55; }
        tr:hover .slot-remove-btn, .slot-remove-btn:focus-visible { opacity: 1; }
        .slot-remove-btn:hover { color: #B23A2F; background: #F6E7E5; }
        .dayof-mode { display: flex; gap: 6px; margin-bottom: 10px; }
        .custom-toggle.on { background: #4C6B4F; border-color: #4C6B4F; color: #F5F0E3; }

        .print-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
        .print-btn { display: flex; align-items: center; gap: 6px; font-family: 'Manrope', sans-serif; font-weight: 700; font-size: 12px; background: #2B2A25; color: #F5F0E3; border: none; border-radius: 5px; padding: 7px 14px; cursor: pointer; }
        .print-btn:hover { transform: translateY(-1px); }
        .print-btn.lock-active { background: #B23A2F; }

        .schedule-locked .chip-btn, .schedule-locked .cell-select { pointer-events: none; opacity: 0.55; cursor: not-allowed; filter: grayscale(0.3); }
        .print-week-range { display: flex; align-items: center; gap: 8px; font-family: 'Space Mono', monospace; font-weight: 700; font-size: 13px; color: #2B2A25; letter-spacing: 0.5px; }
        .print-week-range .back-btn { color: #8c8574; padding: 2px; }
        .print-week-range .back-btn:hover { color: #2B2A25; }
        .today-btn { font-family: 'Manrope', sans-serif; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; padding: 4px 11px; border-radius: 14px; border: 1px solid #C98A3E; background: #C98A3E; color: #2B2A25; cursor: pointer; margin-right: 4px; }
        .today-btn:hover:not(:disabled) { background: #d89a4e; }
        .today-btn:disabled { background: transparent; color: #b8b0a0; border-color: rgba(43,42,37,0.18); cursor: default; }
        .week-range-text { padding: 3px 8px; border-radius: 6px; }
        .week-range-current { background: rgba(201,138,63,0.2); color: #8a5a20; }


        @media print {
          /* The dark skin is screen-only: restore light surfaces + dark ink for
             everything that actually prints. Deliberately enumerated rather than
             a blanket "hub descendant" rule, which would use !important to
             stomp the inline colors on the branded schedule sheet and QR sheet. */
          .hub { background: #fff !important; color: #2B2A25 !important; padding: 0 !important; }
          .cal-card, .nr-card, .nr-item, .nr-panel, .decision-card,
          .notes-modal, .delete-modal { background: #fff !important; color: #2B2A25 !important; border-color: rgba(43,42,37,0.2) !important; }
          .emp-name, .tip-stat, .check-value, .week-range, .print-week-range,
          .tip-name-display, .tip-position, .cal-day-num, .recon-row.final label,
          .denom-row.totals { color: #2B2A25 !important; }
          .week-table th, .tip-field label, .recon-title, .denom-header,
          .check-label, .cal-weekday { color: #8c8574 !important; }
          .recon-row label, .denom-label, .check-sub, .legend-item { color: #4a473d !important; }
          .tip-out-na { color: #B23A2F !important; }
          .cal-day { background: #fff !important; border-color: rgba(43,42,37,0.12) !important; }
          .tip-field input, .tip-table-input, .recon-row input, .denom-row input,
          .payout-row input[type="text"], .payout-row input[type="number"],
          .tip-time-input { background: #fff !important; color: #2B2A25 !important; border-color: rgba(43,42,37,0.2) !important; }
          .role-header { color: #8a5a20 !important; }
          .recon-row.final span { color: #8a5a20 !important; }
          .tabs, .hub-header, .print-btn, .custom-toggle, .publish-btn, .published-badge, .back-btn, .subject-preview,
          .save-status, .day-popup-backdrop { display: none !important; }
          .cal-card { box-shadow: none !important; }
          /* Tip Sheet print: hide helper text, buttons, navigation, finalized banner; outline-only boxes; fit one page */
          .footer-note, .recon-note, .fm-banner, .week-header, .screen-only { display: none !important; }
          .print-only { display: block !important; }
          .tip-signoff.print-only { display: flex !important; }
          .tip-staff-actions { display: none !important; } /* its buttons are all hidden on paper */
          /* A locked sheet dims + greys its inputs on screen; on paper it must
             read like any other sheet. */
          /* Extra class: the dark skin's own .tip-locked input rule is also
             !important and comes later in this sheet, so it would win a tie. */
          .tip-page-split.tip-locked input { opacity: 1 !important; background: #fff !important; }
          .check-box { background: transparent !important; }
          .check-box.match { border-color: #7BA37E; }
          .check-box.mismatch { border-color: #C98A3E; }
          .cash-recon { background: transparent !important; border: 1px solid rgba(43,42,37,0.2) !important; }
          /* Print fills landscape page: expand fonts + spacing to use ~90% of
             page height, leaving small margin. Scales to ~700pt at print width */
          .tip-page-split { font-size: 92%; gap: 22px !important; }
          .tip-left-col { width: 340px !important; }
          .week-table { font-size: 11px !important; }
          .week-table td { padding: 5px 4px !important; }
          .point-reference { font-size: 9.5px !important; }
          .tip-top-row { gap: 16px !important; flex-wrap: nowrap !important; }
          .tip-inputs { gap: 13px !important; margin-bottom: 8px !important; }
          /* Top row (floor/bar cash + CC, covers) stays on one line: at 110px
             inputs COVERS wrapped to its own line, which also cost a row of
             height. 92px still holds a value like 1234.56. */
          .tip-top-row .tip-inputs { flex-wrap: nowrap !important; }
          .tip-top-row .tip-field input { width: 92px !important; }
          .tip-top-row .tip-field:last-child input { width: 58px !important; }
          .tip-field label { font-size: 10px !important; }
          .tip-stat { font-size: 14px !important; }
          .denom-table { font-size: 10.5px !important; }
          /* Cash box writing rules (brief item 2) — matches .tip-pdf-mode so a
             printed sheet and a saved PDF look the same. */
          .denom-row input {
            border: 0 !important; border-bottom: 1px solid #d0d0d0 !important;
            border-radius: 0 !important; background: transparent !important;
            display: block !important; min-height: 15px !important; padding: 0 2px 1px !important;
          }
          /* Nothing to click on paper. */
          .add-payout-btn, .remove-payout-btn { display: none !important; }
          .recon-row { padding: 5px 0 !important; }
          .hero-stat { gap: 13px !important; margin: 13px 0 !important; }
          /* amber summary boxes -> outline only (amber border, white bg) */
          .hero-item { padding: 12px 14px !important; background: transparent !important; border-color: #C98A3E !important; }
          .hero-value { font-size: 21px !important; }
          .hero-label { margin-bottom: 3px !important; font-size: 9px !important; }
          /* Logo breathing room for landscape */
          .tip-logo-space { min-height: 95px !important; margin-bottom: 14px !important; }
          .tip-logo-img { max-height: 91px !important; }
          /* One landscape page: at 100% the sheet overflows Letter landscape
             (Chrome prints 988px wide; the sheet needs ~900px of height against
             ~749px). 86% is what the manager had set in Chrome's print dialog;
             zooming the whole Tip Sheet wrapper reproduces that exactly, so
             print dialogs can stay at Default. Tip Sheet only — the Set
             Schedule print and the PDF (not @media print) are unaffected. */
          .tip-wrap { zoom: 0.86; }
          /* Set Schedule print: swap the live interactive grid for the branded
             sheet node (same renderer as the PDF). Only the portal shows. */
          body.printing-schedule .hub > *:not(.schedule-print-portal) { display: none !important; }
          body.printing-schedule .schedule-print-portal { display: block !important; page: scheduleLandscape; }
          /* FOH schedule print: the sheet's compact spacing (built into the
             sheet, shared with the PDF) fits one landscape page at full type
             size. A group never splits across pages; the date row (thead)
             repeats if a page break happens. */
          .schedule-print-portal [data-sheet="foh"] .sh-group { break-inside: avoid; page-break-inside: avoid; }
          body.printing-qr .hub > *:not(.qr-print-sheet) { display: none !important; }
          body.printing-qr .qr-print-sheet { display: block !important; }
        }
        /* Tip sheet + schedule print landscape by default; the QR sheet keeps its
           branded portrait layout via a named page. */
        @page { size: landscape; margin: 0.35in; }
        @page scheduleLandscape { size: landscape; margin: 0.35in; }
        @page qrPortrait { size: portrait; margin: 0.4in; }
        body.printing-qr .qr-print-sheet { page: qrPortrait; }
        .schedule-print-portal { display: none; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        /* PDF capture (html2canvas on the live card) doesn't see @media print, so
           this class provides outline-only boxes + compaction for one landscape page
           at the fixed 1280px capture width. Rules are independent, not relying on
           @media print or base styles. */
        /* html2canvas doesn't evaluate @media print, so the Tip Sheet PDF needs
           its own light restore — same reason the rules above exist. */
        .tip-pdf-mode, .tip-pdf-mode .cal-card { background: #fff !important; color: #2B2A25 !important; }
        .tip-pdf-mode .emp-name, .tip-pdf-mode .tip-stat, .tip-pdf-mode .check-value,
        .tip-pdf-mode .tip-name-display, .tip-pdf-mode .tip-position,
        .tip-pdf-mode .denom-row.totals, .tip-pdf-mode .recon-row.final label { color: #2B2A25 !important; }
        .tip-pdf-mode .week-table th, .tip-pdf-mode .tip-field label,
        .tip-pdf-mode .recon-title, .tip-pdf-mode .denom-header,
        .tip-pdf-mode .check-label { color: #8c8574 !important; }
        .tip-pdf-mode .recon-row label, .tip-pdf-mode .denom-label,
        .tip-pdf-mode .check-sub { color: #4a473d !important; }
        .tip-pdf-mode .tip-out-na { color: #B23A2F !important; }
        .tip-pdf-mode .print-only { display: block !important; }
        .tip-pdf-mode .tip-signoff.print-only { display: flex !important; }
        .tip-pdf-mode .tip-staff-actions { display: none !important; }
        .tip-pdf-mode input { background: #fff !important; color: #2B2A25 !important; border-color: rgba(43,42,37,0.2) !important; }
        .tip-pdf-mode .recon-row.final span { color: #8a5a20 !important; }
        /* Cash box writing rules (brief item 2): each denomination row gets a
           thin rule under its Opening and Closing cells, so the empty box reads
           as a form to write on instead of a grid of empty outlines. No vertical
           borders, no boxes. .pdf-field is the span html2canvas's onclone swaps
           each input for — without it the rules would vanish in the PDF.
           (No backticks in here: this whole stylesheet is a template literal.) */
        .tip-pdf-mode .denom-row input,
        .tip-pdf-mode .denom-row .pdf-field {
          border: 0 !important; border-bottom: 1px solid #d0d0d0 !important;
          border-radius: 0 !important; background: transparent !important;
          display: block !important; min-height: 15px !important; padding: 0 2px 1px !important;
        }
        .tip-pdf-mode .check-box, .tip-pdf-mode .cash-recon, .tip-pdf-mode .hero-item { background: transparent !important; }
        .tip-pdf-mode .cash-recon { border: 1px solid rgba(43,42,37,0.2) !important; }
        .tip-pdf-mode .hero-item { border-color: #C98A3E !important; padding: 10px 12px !important; }
        .tip-pdf-mode .hero-stat { gap: 10px !important; margin: 10px 0 !important; }
        /* Sizes below were shrunk to squeeze the sheet onto one page when the
           capture was pinned at 1280px and only width-fitted — which is exactly
           what left the empty band at the bottom. exportTipSheetPdf now picks the
           capture width to match the page's aspect ratio, so these go back up to
           near their on-screen size: the content is taller, the type is bigger,
           and it still lands on one landscape page (brief item 4). */
        .tip-pdf-mode .hero-value { font-size: 20px !important; }
        .tip-pdf-mode .hero-label { margin-bottom: 3px !important; font-size: 9px !important; }
        .tip-pdf-mode .tip-logo-space { min-height: 84px !important; margin-bottom: 12px !important; }
        .tip-pdf-mode .tip-logo-img { max-height: 80px !important; }
        .tip-pdf-mode .tip-page-split { font-size: 100%; gap: 20px !important; }
        .tip-pdf-mode .tip-left-col { width: 320px !important; }
        .tip-pdf-mode .week-table { font-size: 12px !important; }
        .tip-pdf-mode .week-table td { padding: 7px 5px !important; }
        .tip-pdf-mode .tip-stat { font-size: 14px !important; }
        .tip-pdf-mode .denom-table { font-size: 11.5px !important; }
        .tip-pdf-mode .recon-row { padding: 5px 0 !important; }
        .tip-pdf-mode .tip-inputs { gap: 14px !important; margin-bottom: 10px !important; }
        .tip-pdf-mode .tip-top-row { gap: 16px !important; }

        /* QR print sheet — branded single portrait page. Colors are accents on
           white (B&W friendly); color-adjust keeps the dark band + pills from
           being stripped by the browser's print defaults. */
        .qr-print-sheet { font-family: 'Manrope', sans-serif; color: #1a1a1a; max-width: 760px; margin: 0 auto; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .qrs-band { background: #1a1a1a; border-radius: 12px; padding: 16px 20px 13px; text-align: center; }
        .qrs-band-row { display: flex; align-items: center; justify-content: center; gap: 13px; }
        .qrs-band-icon { width: 34px; height: 34px; object-fit: contain; }
        .qrs-band-word { font-family: 'Space Mono', monospace; font-weight: 700; font-size: 23px; letter-spacing: 8px; color: #fff; }
        .qrs-band-sub { font-family: 'Space Mono', monospace; font-weight: 700; font-size: 9.5px; letter-spacing: 2.2px; color: #c8956c; margin-top: 7px; }
        .qrs-register { display: flex; align-items: center; gap: 20px; background: #fff8f4; border: 2px solid #c8956c; border-radius: 10px; padding: 12px 18px; margin: 13px 0; }
        .qrs-register-qr { width: 96px; height: 96px; flex-shrink: 0; }
        .qrs-start-pill { display: inline-block; background: #c8956c; color: #fff; border-radius: 999px; padding: 3px 13px; font-weight: 800; font-size: 10px; letter-spacing: 1.5px; }
        .qrs-register-title { font-weight: 800; font-size: 16px; margin-top: 6px; }
        .qrs-register-text { font-size: 11.5px; line-height: 1.45; margin-top: 4px; color: #333; }
        .qrs-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 11px; }
        .qrs-card { border: 1px solid #d8d8d8; border-top: 3px solid #8a8a8a; border-radius: 8px; padding: 9px 8px 8px; text-align: center; break-inside: avoid; page-break-inside: avoid; }
        .qrs-card-qr { width: 78px; height: 78px; }
        .qrs-card-title { font-weight: 800; font-size: 12px; margin-top: 3px; }
        .qrs-card-text { font-size: 9.5px; line-height: 1.4; color: #444; margin-top: 3px; }
        .qrs-footer { display: flex; justify-content: space-between; gap: 12px; border-top: 1px solid #cfcfcf; margin-top: 13px; padding-top: 8px; font-size: 9.5px; color: #333; }
        .qrs-footer-right { white-space: nowrap; }

        .point-reference { width: fit-content; margin: 0; text-align: right; font-family: 'Space Mono', monospace; font-weight: 700; font-size: 9.5px; letter-spacing: 0.3px; color: #B23A2F; line-height: 1.4; flex-shrink: 0; }

        .tip-top-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
        .subject-preview { font-family: 'Space Mono', monospace; font-size: 12px; background: #FBF0DE; border: 1px dashed #C98A3E; padding: 8px 12px; border-radius: 5px; color: #8a5a20; }
        .footer-note { margin-top: 14px; font-size: 12px; color: #6b6355; font-style: italic; line-height: 1.5; }

        /* ---- compact schedule dropdowns ---- */
        .cell-stack { display: flex; flex-direction: column; gap: 3px; align-items: center; }
        /* small role name under a cross-role shift (color set inline per role) */
        .cross-role-label { font-family: 'Manrope', sans-serif; font-size: 9px; font-weight: 700; line-height: 1.05; margin-top: 1px; letter-spacing: 0.2px; text-align: center; }
        .cell-select { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; padding: 4px 3px; border-radius: 4px; border: 1px solid #d6cfbb; background: #FBF8EF; color: #8c8574; cursor: pointer; max-width: 100%; width: auto; }
        .cell-select:disabled { opacity: 0.55; cursor: not-allowed; }
        .role-select { font-size: 9px; padding: 2px 2px; color: #6b6355; background: #F1EFE6; border-color: rgba(43,42,37,0.18); }
        .cell-blocked { font-family: 'Space Mono', monospace; font-size: 11px; color: #b0a892; text-align: center; padding: 5px 2px; border-radius: 4px; background: repeating-linear-gradient(45deg, rgba(43,42,37,0.04), rgba(43,42,37,0.04) 4px, transparent 4px, transparent 8px); cursor: not-allowed; }
        .section-divider { height: 10px; border-bottom: 2px solid rgba(201,138,63,0.35); padding: 0 !important; }
        /* approved time-off passive indicator (item 2) */
        .week-table td.shift-cell { position: relative; }
        .cell-timeoff-flag { position: absolute; top: 2px; right: 2px; width: 8px; height: 8px; border-radius: 50%; background: #7B93A3; box-shadow: 0 0 0 2px rgba(123,147,163,0.25); pointer-events: none; z-index: 1; }
        /* Day-of change (Tip Sheet add/remove, glance swap): top-LEFT so it never
           collides with the time-off dot. Hoverable, unlike that dot, because the
           tooltip is the whole explanation. */
        .cell-dayof-flag { position: absolute; top: 2px; left: 2px; width: 8px; height: 8px; border-radius: 50%; background: #C98A3E; box-shadow: 0 0 0 2px rgba(201,138,62,0.3); cursor: help; z-index: 1; }

        /* ---- manager-on-shift banner (FOH) ---- */
        .fm-banner { display: flex; gap: 6px; align-items: stretch; margin: 2px 0 16px; flex-wrap: wrap; }
        .fm-banner-label { font-family: 'Space Mono', monospace; font-size: 9.5px; letter-spacing: 1px; text-transform: uppercase; color: #8c8574; align-self: center; margin-right: 4px; }
        .fm-chip { flex: 1; min-width: 74px; text-align: center; background: #E7EAF2; border: 1px solid #4A5C7A; border-radius: 6px; padding: 4px 6px; }
        .fm-chip-day { display: block; font-family: 'Space Mono', monospace; font-size: 8.5px; letter-spacing: 1px; text-transform: uppercase; color: #55617a; }
        .fm-chip-name { display: block; font-weight: 800; font-size: 11.5px; color: #33425C; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .fm-chip-empty { background: #F1EFE6; border-color: rgba(43,42,37,0.15); }
        .fm-chip-empty .fm-chip-day { color: #a79e8c; }
        .fm-chip-empty .fm-chip-name { color: #c7bfa9; font-weight: 600; }

        /* ---- calendar day extras + popup ---- */
        .cal-holiday-label { margin-top: 4px; font-size: 9px; font-weight: 700; color: #B3695E; line-height: 1.2; }
        .cal-off-chips { margin-top: 4px; display: flex; flex-wrap: wrap; gap: 2px; }
        .cal-off-chip { font-size: 8.5px; font-weight: 700; background: #E3E8EC; color: #4a5a66; border-radius: 6px; padding: 1px 5px; white-space: nowrap; }
        .cal-off-more { background: #d9dfe4; }
        .cal-rail-dot { position: absolute; bottom: 6px; right: 7px; width: 6px; height: 6px; border-radius: 50%; background: #8FA396; }
        .day-popup-backdrop { position: fixed; inset: 0; background: rgba(20,18,14,0.55); display: flex; align-items: center; justify-content: center; z-index: 60; }
        .day-popup { background: #F5F0E3; color: #2B2A25; border-radius: 10px; padding: 18px 20px; width: min(400px, 92vw); max-height: 80vh; overflow-y: auto; box-shadow: 0 18px 48px rgba(0,0,0,0.45); animation: zoomIn 0.18s ease; }
        .staff-edit-modal { background: #F5F0E3; color: #2B2A25; border-radius: 10px; padding: 22px 24px; width: min(420px, 92vw); box-shadow: 0 18px 48px rgba(0,0,0,0.45); animation: zoomIn 0.18s ease; }
        .day-popup-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 4px; }
        .day-popup-date { font-family: 'Space Mono', monospace; font-weight: 700; font-size: 14px; }
        .day-popup-close { background: none; border: none; cursor: pointer; color: #6b6355; padding: 2px; }
        .day-popup-close:hover { color: #2B2A25; }
        .day-popup-holiday { font-size: 12px; font-weight: 700; color: #B3695E; margin-bottom: 6px; }
        .day-popup-section { font-family: 'Space Mono', monospace; font-size: 9.5px; letter-spacing: 1.5px; text-transform: uppercase; color: #8c8574; margin: 12px 0 6px; }
        .day-popup-empty { font-size: 12px; color: #9a9385; font-style: italic; padding: 4px 0; }
        .day-popup-item { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 1px dashed rgba(43,42,37,0.12); font-size: 12.5px; }
        .day-popup-item:last-of-type { border-bottom: none; }
        .day-popup-badge { font-family: 'Space Mono', monospace; font-size: 8.5px; letter-spacing: 0.5px; text-transform: uppercase; color: #fff; padding: 2px 7px; border-radius: 3px; white-space: nowrap; }
        .day-popup-name { font-weight: 700; }
        .day-popup-status { margin-left: auto; font-family: 'Space Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
        .day-popup-status-pending { color: #C98A3E; }
        .day-popup-status-approved { color: #4C6B4F; }

        /* publish preview modal */

        /* ---- staff & roles screen ---- */
        .staff-msg { font-family: 'Space Mono', monospace; font-size: 11px; color: #4C6B4F; }
        .staff-add { background: #FBF8EF; border: 1px solid rgba(43,42,37,0.12); border-radius: 8px; padding: 12px 14px; margin-bottom: 6px; }
        .staff-add-title { font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; color: #8c8574; margin-bottom: 8px; }
        .staff-add-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .staff-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 7px 2px; border-top: 1px solid rgba(43,42,37,0.08); }
        .staff-row-inactive { opacity: 0.5; }
        .staff-name-input { font-family: 'Manrope', sans-serif; font-weight: 700; font-size: 13px; padding: 6px 9px; border: 1px solid rgba(43,42,37,0.15); border-radius: 4px; background: #FFFDF7; color: #2B2A25; width: 150px; }
        .staff-section-select, .staff-primary-select { font-size: 11px; padding: 5px 6px; }
        .staff-role-checks { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .staff-role-check { display: flex; align-items: center; gap: 4px; font-size: 12px; color: #4a473d; cursor: pointer; white-space: nowrap; }
        .staff-role-check input { accent-color: #4C6B4F; cursor: pointer; }
        .staff-active-check { margin-left: auto; }
        .staff-save-btn { padding: 6px 14px; }
        .staff-delete-btn { font-family: 'Manrope', sans-serif; font-weight: 700; font-size: 11.5px; padding: 6px 12px; border-radius: 6px; border: 1px solid #d9a59e; background: #FBEDEA; color: #B23A2F; cursor: pointer; }
        .staff-delete-btn:hover { background: #f6ddd8; }

        /* delete confirmation modal */
        .delete-modal { background: #F5F0E3; color: #2B2A25; border-radius: 12px; padding: 20px 22px; width: min(400px, 92vw); box-shadow: 0 18px 48px rgba(0,0,0,0.45); animation: zoomIn 0.18s ease; }
        .delete-modal-title { font-family: 'Space Mono', monospace; font-weight: 700; font-size: 15px; margin-bottom: 8px; }
        .delete-modal-body { font-size: 13.5px; color: #4a473d; line-height: 1.5; }
        .delete-modal-warn { font-size: 12.5px; color: #B23A2F; background: #FBEDEA; border: 1px solid #e6c3bc; border-radius: 7px; padding: 8px 11px; margin: 12px 0 4px; line-height: 1.45; }
        .delete-modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
        .manual-add-btn { margin-left: auto; font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 11.5px; padding: 5px 12px; border-radius: 8px; border: 1px solid rgba(47,52,50,0.15); background: #2F3432; color: #F5F0E3; cursor: pointer; text-transform: none; letter-spacing: 0; }
        .manual-field-label { display: block; font-family: 'Space Mono', monospace; font-size: 10.5px; letter-spacing: 0.6px; text-transform: uppercase; color: #85897F; margin: 12px 0 4px; }
        .manual-field { width: 100%; box-sizing: border-box; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 13px; color: #2B2A25; background: #FDFBF4; border: 1px solid #d8d2c2; border-radius: 7px; padding: 8px 10px; }
        textarea.manual-field { resize: vertical; min-height: 64px; }
        .delete-confirm-btn { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 12.5px; padding: 8px 18px; border-radius: 9px; border: none; background: #B23A2F; color: #fff; cursor: pointer; }
        .delete-confirm-btn:hover:not(:disabled) { background: #9c3128; }
        .delete-confirm-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .qr-print-btn { background: #2B2A25; color: #F5F0E3; border-color: #2B2A25; display: inline-flex; align-items: center; gap: 5px; }
        .qr-print-btn:hover { background: #3a3831; }

        /* QR print sheet — hidden on screen, shown only when printing it */
        .qr-print-sheet { display: none; }

        /* QR row + modal */
        .qr-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
        .qr-row-label { font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: #8c8574; }
        .qr-btn { font-family: 'Manrope', sans-serif; font-weight: 700; font-size: 11.5px; padding: 6px 12px; border-radius: 20px; border: 1px solid rgba(43,42,37,0.18); background: #FBF8EF; color: #4a473d; cursor: pointer; }
        .qr-btn:hover { background: #F1EAD9; }
        .qr-modal { background: #F5F0E3; color: #2B2A25; border-radius: 12px; padding: 18px 20px; width: min(380px, 92vw); text-align: center; box-shadow: 0 18px 48px rgba(0,0,0,0.45); animation: zoomIn 0.18s ease; }

        /* ---- per-week notes panel ---- */
        .notes-modal { background: #F5F0E3; color: #2B2A25; border-radius: 12px; padding: 18px 20px; width: min(560px, 94vw); max-height: 82vh; overflow-y: auto; box-shadow: 0 18px 48px rgba(0,0,0,0.45); animation: zoomIn 0.18s ease; }
        .notes-add { display: flex; gap: 8px; margin: 12px 0 14px; }
        .notes-input { flex: 1; font-family: 'Manrope', sans-serif; font-size: 12.5px; padding: 8px 10px; border: 1px solid #cfc7b4; border-radius: 7px; background: #fffdf7; color: #2B2A25; }
        .notes-input:focus { outline: none; border-color: #c8956c; }
        .notes-empty { font-size: 12px; color: #7d7666; font-style: italic; padding: 10px 2px 4px; }
        .notes-list { display: flex; flex-direction: column; gap: 8px; }
        .notes-row { display: flex; align-items: flex-start; gap: 8px; background: #fffdf7; border: 1px solid #e2dbc9; border-radius: 8px; padding: 9px 10px; }
        .notes-row-body { flex: 1; min-width: 0; }
        .notes-row-text { font-size: 12.5px; line-height: 1.4; word-break: break-word; }
        .notes-row-meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; font-family: 'Space Mono', monospace; font-size: 9.5px; letter-spacing: 0.5px; text-transform: uppercase; color: #8c8574; }
        .notes-tag { color: #a06a34; font-weight: 700; }
        .notes-row-actions { display: flex; gap: 5px; flex-shrink: 0; }

        /* finalized week: green button + a small dot on the date range */
        .print-btn.finalized-active { background: #5a8a6a; border-color: #5a8a6a; color: #fff; }
        .week-finalized-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #5a8a6a; margin-left: 6px; vertical-align: middle; }
        .week-range-finalized { color: #5a8a6a; }
        /* Past week on Set Schedule — read-only, no edit controls (item 2). */
        .past-week-tag {
          display: inline-flex; align-items: center; gap: 6px;
          font-family: 'Space Mono', monospace; font-size: 10.5px; letter-spacing: 1px;
          text-transform: uppercase; color: #8c8574;
          background: rgba(140,133,116,0.12); border-radius: 20px; padding: 5px 12px;
        }
        .qr-img { width: 260px; height: 260px; max-width: 100%; background: #fff; border-radius: 8px; padding: 8px; }
        .qr-loading { height: 260px; display: flex; align-items: center; justify-content: center; color: #8c8574; }
        .qr-caption { font-size: 12px; color: #5c625f; margin-top: 10px; }
        .qr-subject { font-family: 'Space Mono', monospace; font-size: 10.5px; color: #8a5a20; background: #FBF0DE; border-radius: 6px; padding: 6px 9px; margin-top: 8px; word-break: break-word; }
        .qr-warn { font-size: 11px; color: #B23A2F; margin-top: 8px; }

        /* pending info updates */
        .info-updates { background: #FBF0DE; border: 1px solid rgba(201,138,63,0.4); border-radius: 8px; padding: 12px 14px; margin-bottom: 14px; }
        .info-updates-title { font-family: 'Space Mono', monospace; font-size: 10.5px; letter-spacing: 1px; text-transform: uppercase; color: #8a5a20; margin-bottom: 8px; }
        .info-update-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 6px 0; border-top: 1px solid rgba(201,138,63,0.25); }
        .info-update-row:first-of-type { border-top: none; }
        .info-update-body { font-size: 13px; color: #4a473d; }
        .info-update-field { color: #6b6355; }

        /* registration dot + profile panel */
        .staff-reg-dot { width: 11px; height: 11px; border-radius: 50%; border: none; cursor: pointer; padding: 0; flex-shrink: 0; }
        .staff-reg-dot.reg-yes { background: #6E9B72; }
        .staff-reg-dot.reg-no { background: #d8b24a; box-shadow: 0 0 0 3px rgba(216,178,74,0.2); }
        .staff-profile { margin: 2px 0 8px 23px; padding: 10px 14px; background: #FBF8EF; border: 1px solid rgba(43,42,37,0.12); border-radius: 8px; max-width: 420px; }
        .staff-profile-row { display: flex; align-items: center; gap: 12px; padding: 4px 0; font-size: 13px; }
        .staff-profile-key { font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: #8c8574; width: 56px; flex-shrink: 0; }
        .staff-profile-val { font-family: 'Manrope', sans-serif; font-size: 13px; color: #2B2A25; background: #fff; border: 1px solid rgba(43,42,37,0.15); border-radius: 5px; padding: 3px 8px; cursor: pointer; }
        .staff-profile-val:hover { border-color: #8FA396; }
        .staff-profile-empty { color: #b0a892; font-size: 12.5px; font-style: italic; }
        .staff-profile-status.reg-yes { color: #4C6B4F; font-weight: 700; }
        .staff-profile-status.reg-no { color: #9a7a1f; font-weight: 700; }
        .staff-profile-value-container { flex: 1; display: flex; align-items: center; }
        .staff-profile-input { font-family: 'Manrope', sans-serif; font-size: 13px; padding: 6px 9px; border: 1px solid rgba(43,42,37,0.15); border-radius: 4px; background: #FFFDF7; color: #2B2A25; flex: 1; max-width: 260px; }
        .staff-profile-note { font-size: 11px; color: #8c8574; font-style: italic; margin-top: 6px; margin-left: 56px; }

        .hero-stat { display: flex; gap: 14px; margin-bottom: 20px; }
        .hero-item { flex: 1; background: #FBF0DE; border: 1px solid rgba(201,138,63,0.35); border-radius: 8px; padding: 22px 18px; }
        .hero-label { font-family: 'Space Mono', monospace; font-size: 10.5px; letter-spacing: 1.5px; text-transform: uppercase; color: #8a5a20; margin-bottom: 4px; }
        .hero-value { font-family: 'Space Mono', monospace; font-weight: 700; font-size: 28px; color: #C98A3E; }

        @media (max-width: 700px) {
          .cal-grid { gap: 3px; }
          .cal-day { min-height: 62px; padding: 5px; }
          .cal-day-meta { font-size: 9px; }
          .week-table { font-size: 10px; }
        }

        /* Dark Split skin lives at the END of the sheet so it wins over every
           base rule above it. The @media print and .tip-pdf-mode restores use
           !important, so they still beat these regardless of order. */
        /* ==================================================================
           DARK SPLIT SKIN (DARK-SPLIT-REDESIGN-BRIEF item 1)
           Screen-only. Everything above is the original light-card baseline,
           which the print + PDF paths still rely on — that's why this block
           sits BEFORE @media print rather than replacing the rules above.
           Layout/behaviour is untouched here; colors and surfaces only.
           ================================================================== */
        .hub {
          --bg: #0c0c0c; --s1: #111111; --s2: #141414;
          --line: #1e1e1e; --line2: #222222;
          --txt: #ffffff; --txt2: #aaaaaa; --muted: #555555;
          --accent: #c8956c;
          background: #0c0c0c; color: #ffffff; padding: 0 0 60px;
        }

        /* ---- global header + tab bar ---- */
        .hub-header {
          background: var(--s1); border-bottom: 1px solid var(--line);
          max-width: none; margin: 0; padding: 16px 28px; align-items: center;
        }
        .hub-title { color: var(--txt); font-size: 15px; letter-spacing: 3px; }
        .hub-date { color: var(--txt2); }
        .hub-icon { height: 26px; }
        .tabs {
          max-width: none; margin: 0 0 26px; padding: 0 28px; gap: 26px;
          background: var(--s1); border-bottom: 1px solid var(--line);
        }
        .tab-btn { color: var(--muted); padding: 12px 2px; }
        .tab-btn:hover { color: var(--txt2); }
        .tab-btn.active { color: var(--txt); border-bottom-color: var(--accent); }
        .hub-signout { border-color: var(--line2) !important; color: var(--txt2) !important; }
        /* .hub lost its own side padding to let the header/tab bars run full
           width, so the tab content supplies its own. */
        .nr-wrap, .cal-wrap, .hub-grid { padding: 0 28px; }

        /* ---- panels, cards, surfaces ---- */
        .nr-card, .cal-card, .decision-card, .ticket { background: var(--s1); color: var(--txt); box-shadow: none; border: 1px solid var(--line); }
        .nr-item, .nr-panel, .nr-empty, .side-card { background: var(--s2); border-color: var(--line); color: var(--txt); box-shadow: none; }
        .nr-count { background: var(--line); color: var(--txt2); }
        .nr-item-name, .nr-item-dates, .gmail-label, .decision-name, .week-range, .emp-name,
        .tip-stat, .check-value, .tip-name-display, .print-week-range { color: var(--txt); }
        .nr-item-type, .nr-item-note, .nr-row-status, .gmail-sub, .decision-notice,
        .decision-note, .template-note, .legend-item, .cal-day-meta, .recon-note,
        .check-sub, .tip-position, .denom-label, .recon-row label { color: var(--txt2); }
        .nr-label, .col-label, .cal-weekday, .week-table th, .tip-field label,
        .recon-title, .denom-header, .check-label, .nr-day-name { color: var(--muted); }
        .nr-row, .nr-log-row, .roster-row { border-color: var(--line); }
        .nr-day-num { color: var(--txt); }
        .nr-day-today { background: rgba(200,149,108,0.14); }
        .nr-day-today .nr-day-name, .nr-day-today .nr-day-num { color: var(--accent); }
        .nr-holiday-note, .nr-log-time { color: var(--muted); }
        .nr-log-neutral { color: var(--txt2); }

        /* ---- controls ---- */
        .nr-manager-note, .cell-select, .cell-role-select, .manual-field,
        .tip-field input, .tip-table-input, .recon-row input, .denom-row input,
        .payout-row input[type="text"], .payout-row input[type="number"],
        .notes-input, .staff-input, .staff-select {
          background: var(--s2); border-color: var(--line2); color: var(--txt);
        }
        .nr-manager-note::placeholder, .notes-input::placeholder, .tip-time-input::placeholder { color: var(--muted); }
        .nr-manager-note:focus, .notes-input:focus, .cell-select:focus { border-color: var(--accent); background: var(--s2); }
        .tip-time-input { color: var(--txt); border-bottom-color: var(--line2); }
        .nr-btn-approve { background: var(--accent); color: #0c0c0c; }
        .nr-btn-deny { background: var(--line); color: var(--txt2); }
        .nr-btn-partial { background: var(--line); color: var(--txt2); border-color: var(--line2); }
        .print-btn { background: var(--s2); color: var(--txt); border: 1px solid var(--line2); }
        .print-btn:hover { background: var(--line); }
        .print-btn.lock-active { background: #B23A2F; color: #fff; border-color: #B23A2F; }
        .print-btn.finalized-active { background: #5a8a6a; color: #fff; border-color: #5a8a6a; }
        .subtab-btn { border-color: var(--line2); color: var(--txt2); }
        .subtab-btn.active { background: var(--accent); color: #0c0c0c; border-color: var(--accent); }
        .subtab-btn:hover:not(.active) { background: var(--line); color: var(--txt); }
        .back-btn { color: var(--txt2); }
        .back-btn:hover { color: var(--txt); }
        .today-btn { background: var(--accent); border-color: var(--accent); color: #0c0c0c; }
        .today-btn:disabled { background: transparent; color: var(--muted); border-color: var(--line2); }
        .custom-toggle { background: var(--s2); border-color: var(--line2); color: var(--txt2); }
        .add-staff-btn { background: var(--s2); border-color: var(--line2); color: var(--txt2); }
        .add-staff-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
        .slot-remove-btn { color: var(--muted); }
        .slot-remove-btn:hover { color: #e79289; background: rgba(178,58,47,0.16); }
        .custom-toggle.on { background: var(--accent); border-color: var(--accent); color: #0c0c0c; }
        .add-payout-btn { color: var(--accent); border-color: var(--line2); }
        .tip-out-toggle.on { color: var(--accent); border-color: var(--line2); }
        .tip-out-toggle:not(.on) { color: #e79289; }
        /* Lighter tint on the dark screen (#B23A2F is ~3.2:1 there); print and
           the PDF keep #B23A2F via their !important rules. */
        .tip-out-na { color: #e79289; }
        .week-range-current { background: rgba(200,149,108,0.18); color: var(--accent); }

        /* ---- calendar ---- */
        .cal-day { background: var(--s2); border-color: var(--line); }
        .cal-day:hover { box-shadow: 0 6px 14px rgba(0,0,0,0.5); }
        .cal-day-num { color: var(--txt); }
        .cal-day.today { border-color: var(--accent); }
        .cal-day.today .cal-day-num { background: var(--accent); color: #0c0c0c; }
        .today-pill { background: var(--accent); color: #0c0c0c; }
        .cal-grid.multi-month .cal-month-label { color: var(--txt2); }
        .cal-grid.multi-month .cal-month-label.current { color: var(--accent); }
        .week-table th.today-col, .week-table td.today-col { background: rgba(200,149,108,0.10); }
        .week-table th.today-col { color: var(--accent); border-bottom-color: var(--accent); }
        .emp-name, .week-table td.shift-cell { border-color: var(--line); }
        .role-header { color: var(--accent); border-color: var(--line); }
        .tip-position { border-color: var(--line); }

        /* ---- tip sheet + misc panels ---- */
        .cash-recon { background: var(--s2); border-color: var(--line); }
        .recon-row { border-color: var(--line); }
        .recon-row.final { border-top-color: var(--line2); }
        .recon-row.final label { color: var(--txt); }
        .recon-row.final span { color: var(--accent); }
        .denom-table, .denom-row.totals { border-color: var(--line); color: var(--txt); }
        .payouts-block { border-color: var(--line); }
        .check-box.match { background: rgba(90,138,106,0.14); border-color: #5a8a6a; }
        .check-box.mismatch { background: rgba(200,149,108,0.14); border-color: var(--accent); }
        .tip-finalized-banner { background: rgba(90,138,106,0.14); border-color: #5a8a6a; color: #8fce9f; }
        .tip-locked-banner { background: rgba(178,58,47,0.16); border-color: #B23A2F; color: #e79289; }
        .tip-off-note { background: rgba(200,149,108,0.14); border-color: var(--accent); color: var(--accent); }
        .tip-locked-banner .tip-finalized-sub { color: var(--txt2); }
        .tip-finalized-sub { color: var(--txt2); }
        .tip-locked input, .tip-locked .add-payout-btn, .tip-locked .custom-toggle { background: var(--line) !important; }
        .slot-empty, .payout-empty { color: var(--muted); }
        .tip-name-input { background: var(--s2); border-color: var(--line2); color: var(--txt); }

        /* ---- modals ---- */
        .notes-modal, .qr-modal, .delete-modal, .day-popup {
          background: var(--s1); color: var(--txt); border: 1px solid var(--line2);
        }
        .notes-row { background: var(--s2); border-color: var(--line); }
        .notes-row-meta, .notes-empty { color: var(--muted); }
        .day-popup-date, .delete-modal-title, .notes-row-text { color: var(--txt); }
        .day-popup-empty, .delete-modal-body, .day-popup-section { color: var(--txt2); }
        .manual-field-label { color: var(--muted); }
        .published-badge { color: #5a8a6a; }

        /* ---- Dark Split Rail: queue | detail | log+notes ---- */
        .rs-card { padding: 0; overflow: hidden; }
        .rs-head { display: flex; align-items: center; gap: 10px; padding: 16px 20px 14px; border-bottom: 1px solid var(--line); }
        .rs-head-icon { height: 22px; width: auto; }
        .rs-head-word { font-family: 'Space Mono', monospace; font-weight: 700; font-size: 14px; letter-spacing: 4px; color: var(--txt); }

        /* Gmail status, top-right of the Rail card (brief item 3). Dot + "Gmail",
           with the last-checked line only when the connection is actually
           healthy. The whole thing is the Check-now button. */
        .rs-gmail {
          margin-left: auto; display: flex; align-items: center; gap: 8px;
          background: none; border: none; padding: 2px 4px; cursor: pointer; font-family: inherit;
        }
        .rs-gmail:disabled { cursor: default; }
        .rs-gmail:hover:not(:disabled) .rs-gmail-label { color: var(--txt); }
        .rs-gmail-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .rs-gmail-ok .rs-gmail-dot { background: #5a8a6a; }
        .rs-gmail-bad .rs-gmail-dot { background: #B23A2F; }
        .rs-gmail-body { display: flex; flex-direction: column; align-items: flex-start; line-height: 1.2; }
        .rs-gmail-label { font-family: 'Space Mono', monospace; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: var(--txt2); }
        .rs-gmail-sub { font-size: 9.5px; color: var(--muted); }
        .rs-gmail-bad .rs-gmail-sub { color: #e79289; }
        /* Shown only when Google rejected the stored token (or there is none). */
        .rs-gmail-reconnect { font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: #e79289; border: 1px solid #B23A2F; border-radius: 5px; padding: 3px 7px; text-decoration: none; white-space: nowrap; }
        .rs-gmail-reconnect:hover { background: rgba(178,58,47,0.16); }
        /* Lets the Reconnect link drop below on a phone instead of overflowing. */
        .rs-head { flex-wrap: wrap; row-gap: 6px; }
        .send-reconnect { display: flex; align-items: flex-start; gap: 7px; margin: 0 0 12px; padding: 9px 12px; border: 1px solid #B23A2F; background: rgba(178,58,47,0.16); color: #e79289; border-radius: 7px; font-size: 12px; line-height: 1.45; }
        .send-reconnect a { color: inherit; font-weight: 700; }

        /* Date Note quick-add strip (brief item 3), where the Gmail bar was. */
        .rs-quicknote {
          display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
          padding: 12px 20px 14px; border-bottom: 1px solid var(--line);
        }
        .rs-quicknote-label {
          display: inline-flex; align-items: center; gap: 6px;
          font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: 1px;
          text-transform: uppercase; color: var(--muted); flex-shrink: 0;
        }
        .rs-quicknote-date, .rs-quicknote-text {
          font-family: inherit; font-size: 12.5px; padding: 6px 9px;
          background: var(--s2); border: 1px solid var(--line); border-radius: 7px; color: var(--txt);
        }
        .rs-quicknote-date { flex-shrink: 0; color-scheme: dark; }
        .rs-quicknote-text { flex: 1; min-width: 180px; }
        .rs-quicknote-date:focus, .rs-quicknote-text:focus { outline: none; border-color: var(--accent); }
        .rs-quicknote-text::placeholder { color: var(--muted); }
        .rs-quicknote-msg { font-size: 11px; color: #5a8a6a; }

        /* ---- Calendar date notes page (brief item 5) ---- */
        .day-page-head { gap: 12px; }
        .day-page-icon {
          display: inline-flex; align-items: center; justify-content: center;
          width: 32px; height: 32px; border-radius: 8px; cursor: pointer;
          background: var(--s2); border: 1px solid var(--line); color: var(--txt2);
        }
        .day-page-icon:hover { color: var(--accent); border-color: var(--line2); }
        .day-page-split { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: 28px; margin-top: 18px; }
        @media (max-width: 860px) { .day-page-split { grid-template-columns: 1fr; gap: 20px; } }
        /* Roomier than the Rail's narrow column — this page has the width. */
        .day-page-notes { max-height: none; }
        .day-page-notes .rs-note-text, .day-page-notes .rs-note-edit { font-size: 13.5px; }
        .day-page-add { margin-top: 10px; }
        .day-page-col .day-popup-item { margin-bottom: 6px; }

        /* Item 6 blank state: a week the Calendar won't show yet. */
        .week-not-final {
          display: flex; flex-direction: column; align-items: center; gap: 6px;
          padding: 54px 20px; text-align: center; color: var(--muted);
        }
        .week-not-final-title { font-family: 'Space Mono', monospace; font-size: 13px; letter-spacing: 1px; color: var(--txt2); }
        .week-not-final-sub { font-size: 12px; max-width: 380px; }

        .rs-strip { display: flex; gap: 4px; padding: 12px 20px; border-bottom: 1px solid var(--line); }
        /* Each day is a button now (brief item 7) — reset the button chrome so
           it still reads as a strip, not a row of controls. */
        .rs-day { flex: 1; text-align: center; padding: 7px 2px 5px; border-radius: 8px; background: none; border: none; font-family: inherit; cursor: pointer; }
        .rs-day:hover:not(.rs-day-today) { background: var(--s2); }
        .rs-day-today { background: rgba(200,149,108,0.12); }
        .rs-day-name { font-family: 'Space Mono', monospace; font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: var(--muted); }
        .rs-day-num { font-family: 'Space Mono', monospace; font-weight: 700; font-size: 14px; color: var(--txt); margin-top: 2px; }
        .rs-day-today .rs-day-name, .rs-day-today .rs-day-num { color: var(--accent); }
        .rs-day-marks { display: flex; justify-content: center; gap: 3px; height: 8px; margin-top: 3px; }
        .rs-mark { width: 5px; height: 5px; border-radius: 50%; display: inline-block; }
        .rs-mark-today { background: var(--accent); }
        .rs-mark-pending { background: #4a7a9b; }
        .rs-mark-holiday { background: #B23A2F; }
        .rs-holiday-note { padding: 8px 20px 0; font-size: 10.5px; color: var(--muted); text-align: center; }

        /* Today at a Glance | Notes (+ selected request) | Pending + log.
           Notes takes the flexible middle because it's the column that grows;
           the two fixed columns are sized to their content (a roster row, a
           request card). */
        .rs-grid { display: grid; grid-template-columns: 260px minmax(0,1fr) 320px; gap: 20px; padding: 18px 20px 24px; align-items: start; }
        @media (max-width: 1180px) { .rs-grid { grid-template-columns: 220px minmax(0,1fr) 270px; gap: 14px; } }
        @media (max-width: 980px) { .rs-grid { grid-template-columns: 1fr; } }
        /* The log sits directly under the pending queue, not in its own column. */
        .rs-col-right .rs-log { max-height: 300px; }
        /* Pending Decisions carries the count (brief item 3) and the Add Request
           button in a 320px column — let it wrap instead of squeezing. */
        .rs-col-right .nr-label { flex-wrap: wrap; row-gap: 6px; }
        .rs-col-right .manual-add-btn { white-space: nowrap; }
        /* The log header sits under the queue, so it needs its own top gap. */
        .rs-col-right .rs-log-label { margin-top: 20px; }
        .rs-col-left, .rs-col-mid, .rs-col-right { min-width: 0; }
        .rs-label-resolved { margin-top: 18px; }

        .rs-q { display: flex; width: 100%; text-align: left; gap: 9px; align-items: center; background: var(--s2); border: 1px solid var(--line); border-left: 3px solid transparent; border-radius: 10px; padding: 9px 10px; margin-bottom: 7px; cursor: pointer; font-family: inherit; }
        .rs-q:hover { border-color: var(--line2); }
        .rs-q-sel { background: #181818; border-left-width: 3px; border-left-style: solid; }
        .rs-q-done { opacity: 0.45; cursor: default; }
        .rs-q-avatar { width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; color: #0c0c0c; font-weight: 800; font-size: 12px; }
        .rs-q-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
        .rs-q-name { font-size: 13px; font-weight: 700; color: var(--txt); display: flex; align-items: center; gap: 5px; }
        .rs-q-urgent { width: 6px; height: 6px; border-radius: 50%; background: #B23A2F; flex-shrink: 0; }
        .rs-q-type { font-size: 10.5px; font-weight: 700; }
        .rs-q-done .rs-q-type { color: var(--muted) !important; }
        .rs-q-dates { font-family: 'Space Mono', monospace; font-size: 10.5px; color: var(--txt2); }
        .rs-empty { padding: 24px 12px; font-size: 12.5px; }

        /* ---- rail card ••• menu (delete / archive) ---- */
        /* The wrapper is the positioning context; the card keeps its own margin
           so the queue spacing is unchanged. */
        .rs-q-wrap { position: relative; }
        .rs-q-wrap .rs-q { padding-right: 30px; }
        .rs-q-menu-btn { position: absolute; top: 8px; right: 6px; z-index: 2; border: none; background: transparent; color: var(--muted); font-size: 13px; line-height: 1; letter-spacing: 1px; padding: 3px 5px; border-radius: 5px; cursor: pointer; }
        .rs-q-menu-btn:hover, .rs-q-menu-btn[aria-expanded="true"] { color: var(--txt); background: var(--line); }
        .rs-q-menu-scrim { position: fixed; inset: 0; z-index: 3; }
        .rs-q-menu { position: absolute; top: 26px; right: 6px; z-index: 4; min-width: 132px; background: var(--s2); border: 1px solid var(--line2); border-radius: 9px; padding: 4px; box-shadow: 0 8px 20px rgba(0,0,0,0.25); }
        .rs-q-menu-item { display: block; width: 100%; text-align: left; background: none; border: none; cursor: pointer; font-family: inherit; font-size: 12.5px; font-weight: 600; color: var(--txt); padding: 7px 9px; border-radius: 6px; }
        .rs-q-menu-item:hover { background: var(--line); }
        .rs-q-menu-danger { color: #B23A2F; }
        .rs-q-menu-danger:hover { background: rgba(178,58,47,0.12); }

        /* ---- archived section ---- */
        .rs-archived { margin-top: 18px; }
        .rs-archived-toggle { display: flex; align-items: center; gap: 7px; width: 100%; background: none; border: none; cursor: pointer; padding: 4px 0; font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--muted); }
        .rs-archived-toggle:hover { color: var(--txt2); }
        .rs-archived-caret { display: inline-block; transition: transform 0.15s ease; }
        .rs-archived-caret.open { transform: rotate(90deg); }
        /* Archived rows reuse the dimmed resolved styling but stay interactive
           enough to reach Restore. */
        .rs-q-archived { opacity: 0.6; margin-top: 7px; }
        .rs-restore-btn { margin-left: auto; flex-shrink: 0; background: none; border: 1px solid var(--line2); border-radius: 7px; cursor: pointer; font-family: 'Space Mono', monospace; font-size: 9.5px; letter-spacing: 1px; text-transform: uppercase; color: var(--txt2); padding: 5px 8px; }
        .rs-restore-btn:hover:not(:disabled) { color: var(--txt); border-color: var(--txt2); }
        .rs-restore-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .rs-detail { background: var(--s2); border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px 20px; }
        .rs-detail-top { display: flex; align-items: flex-start; gap: 11px; }
        .rs-detail-avatar { width: 34px; height: 34px; font-size: 15px; }
        .rs-detail-name { font-size: 18px; font-weight: 800; color: var(--txt); }
        .rs-detail-type { display: flex; align-items: center; gap: 7px; margin-top: 5px; flex-wrap: wrap; }
        .rs-type-badge { font-family: 'Space Mono', monospace; font-size: 9.5px; letter-spacing: 1px; text-transform: uppercase; color: #0c0c0c; padding: 2px 8px; border-radius: 20px; font-weight: 700; }
        .rs-detail-dates { margin-left: auto; font-family: 'Space Mono', monospace; font-weight: 700; font-size: 16px; color: var(--txt); white-space: nowrap; }
        .rs-detail-meta { font-size: 11px; color: var(--muted); margin: 10px 0 0; text-transform: uppercase; letter-spacing: 0.5px; font-family: 'Space Mono', monospace; }
        .rs-detail-note { font-size: 13px; color: var(--txt2); line-height: 1.55; margin: 12px 0 14px; padding: 11px 13px; background: #101010; border-radius: 9px; border: 1px solid var(--line); white-space: pre-wrap; }

        .rs-clear { margin-left: auto; background: none; border: none; cursor: pointer; font-family: 'Space Mono', monospace; font-size: 9.5px; letter-spacing: 1px; text-transform: uppercase; color: var(--muted); padding: 0; }
        .rs-clear:hover { color: var(--txt2); }
        .rs-log { max-height: 240px; overflow-y: auto; }
        .rs-log-empty { font-size: 11px; color: var(--muted); font-style: italic; }
        .rs-log .nr-log-row { font-size: 11px; }
        /* Notes box (brief item 2): taller, full-size text, no dates, and edited
           in place. The list scrolls; the add-field is pinned under it. */
        /* Fixed, comfortable height rather than growing down the whole column
           (brief item 6) — the list scrolls inside, the add-field stays pinned
           under it so it never scrolls out of reach. */
        .rs-notes { display: flex; flex-direction: column; gap: 8px; height: 268px; }
        .rs-note-list { display: flex; flex-direction: column; gap: 6px; overflow-y: auto; flex: 1; min-height: 0; padding-right: 2px; }
        /* Empty state takes the same space, so the add-field doesn't jump up. */
        .rs-notes > .rs-log-empty { flex: 1; }
        .rs-note-row { display: flex; align-items: flex-start; gap: 4px; }
        .rs-note-text {
          flex: 1; min-width: 0; text-align: left; font-family: inherit; font-size: 13px; line-height: 1.45;
          color: var(--txt); background: var(--s1); border: 1px solid var(--line); border-radius: 7px;
          padding: 7px 9px; cursor: text; white-space: pre-wrap; word-break: break-word;
        }
        .rs-note-text:hover { border-color: var(--line2); }
        .rs-note-edit {
          flex: 1; min-width: 0; font-family: inherit; font-size: 13px; line-height: 1.45; resize: vertical;
          color: var(--txt); background: var(--s1); border: 1px solid var(--accent); border-radius: 7px; padding: 7px 9px;
        }
        .rs-note-edit:focus { outline: none; }
        .rs-note-actions { display: flex; flex-direction: column; gap: 4px; flex-shrink: 0; }
        .rs-note-btn {
          display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px;
          background: var(--s1); border: 1px solid var(--line); border-radius: 6px; color: var(--txt2); cursor: pointer; padding: 0;
        }
        .rs-note-btn:hover:not(:disabled) { color: var(--txt); border-color: var(--line2); }
        .rs-note-btn:disabled { opacity: 0.4; cursor: default; }
        .rs-note-del:hover:not(:disabled) { color: #e79289; border-color: #B23A2F; }
        .rs-note-add { display: flex; gap: 6px; align-items: center; border-top: 1px solid var(--line); padding-top: 8px; }
        .rs-note-input {
          flex: 1; min-width: 0; font-family: inherit; font-size: 12.5px; padding: 7px 9px;
          color: var(--txt); background: var(--s1); border: 1px solid var(--line); border-radius: 7px;
        }
        .rs-note-input:focus { outline: none; border-color: var(--accent); }
        .rs-note-input::placeholder { color: var(--muted); }

        /* ---- remaining light surfaces ---- */
        .fm-chip { background: rgba(74,122,155,0.16); border-color: rgba(74,122,155,0.5); }
        .fm-chip-day { color: #79a8c7; }
        .fm-chip-name { color: #cfe2ee; }
        .fm-chip-empty { background: var(--s2); border-color: var(--line2); }
        .fm-chip-empty .fm-chip-day { color: var(--muted); }
        .fm-chip-empty .fm-chip-name { color: var(--muted); }
        .cell-blocked { color: var(--muted); background: repeating-linear-gradient(45deg, rgba(255,255,255,0.04), rgba(255,255,255,0.04) 4px, transparent 4px, transparent 8px); }
        .staff-edit-modal { background: var(--s1); color: var(--txt); }
        .day-popup-close { color: var(--txt2); }
        .day-popup-close:hover { color: var(--txt); }
        .day-popup-item { border-color: var(--line); }
        .day-popup-status-pending { color: var(--accent); }
        .day-popup-status-approved { color: #7fb392; }
        /* Set Schedule grid dropdowns. The option list needs styling explicitly:
           an unstyled <option> computes to a transparent background and Chrome
           then paints the popup with the OS light default, which is where the
           white was coming from. Role-tinted selects keep their inline
           background (inline wins) — only the popup list is forced dark. */
        .cell-select, .cell-select.shift-select, .cell-select.role-select {
          background: #141414; border-color: #2a2a2a; color: #ffffff;
        }
        .cell-select option, .manual-field option, .staff-section-select option,
        .staff-primary-select option, select.cell-select option {
          background: #141414; color: #ffffff;
        }
        .cell-select:disabled { color: var(--txt2); }
        .nr-empty { border-color: var(--line2); }
        .empty-decisions, .empty-rail { color: var(--muted); }
        .manual-add-btn { color: var(--accent); border-color: var(--line2); background: var(--s2); }
        .hero-item { background: rgba(200,149,108,0.12); border-color: rgba(200,149,108,0.35); }
        .hero-label { color: var(--accent); }
        .hero-value { color: var(--accent); }
        .subject-preview { background: rgba(200,149,108,0.10); border-color: rgba(200,149,108,0.45); color: var(--accent); }
        .footer-note { color: var(--txt2); }
        .point-reference { color: #e08a7d; }

        /* ---- staff tab ---- */
        .staff-add, .staff-profile { background: var(--s2); border-color: var(--line); }
        .staff-add-title, .staff-profile-key { color: var(--muted); }
        .staff-row { border-color: var(--line); }
        .staff-name-input { background: var(--s2); border-color: var(--line2); color: var(--txt); }
        .staff-note-input { font-family: 'Inter', sans-serif; font-size: 12px; padding: 6px 9px; border: 1px solid var(--line2); border-radius: 4px; background: var(--s2); color: var(--txt); width: 210px; }
        .staff-note-input::placeholder { color: var(--muted); }
        .staff-note-input:focus { outline: none; border-color: var(--accent); }
        .staff-role-check { color: var(--txt2); }

        /* ---- Set Schedule notes: ⚑ flags + side pad (migration 0018) ----
           Everything here is out of flow: the flag, tooltip and editor are
           absolute inside the name, and the pad is absolute in the margin
           beside the card, so the grid lays out exactly as it did before. */
        .sched-name { position: relative; display: inline-block; cursor: default; }
        .sched-name.has-note { cursor: help; }
        .sched-flag { position: absolute; left: 100%; top: 50%; transform: translateY(-50%); margin-left: 3px; padding: 0 1px; background: none; border: 0; font-size: 9px; line-height: 1; color: #c8956c; cursor: pointer; }
        .sched-flag-add { opacity: 0; transition: opacity 0.12s; }
        .emp-name:hover .sched-flag-add { opacity: 0.35; }
        .sched-flag-add:hover, .sched-flag-add:focus-visible { opacity: 1 !important; }
        .sched-note-tip, .sched-note-editor {
          position: absolute; left: 0; top: calc(100% + 5px); z-index: 60;
          background: #1a1a1a; border: 0.5px solid #c8956c; border-radius: 6px; padding: 7px 10px;
          font-family: 'Inter', sans-serif; font-size: 10.5px; font-weight: 400; letter-spacing: 0; text-transform: none;
          color: #ddd; white-space: nowrap; box-shadow: 0 4px 12px rgba(0,0,0,0.5); text-align: left;
        }
        .sched-note-tip { display: none; pointer-events: none; }
        .sched-name:hover .sched-note-tip { display: block; }
        .sched-note-editor { display: flex; flex-direction: column; gap: 5px; }
        .sched-note-editor input { width: 380px; background: #0f0f0f; border: 0.5px solid #2a2a2a; border-radius: 4px; padding: 5px 7px; color: #fff; font-family: inherit; font-size: 11px; outline: none; }
        .sched-note-editor input:focus { border-color: #c8956c; }
        .sched-note-hint { font-size: 9.5px; color: #666; }

        .sched-wrap { position: relative; }
        /* Card's right edge sits 28px inside the wrap (its side padding); the
           pad starts 14px past it, in what was empty margin. */
        .sched-pad { position: absolute; top: 0; left: calc(100% - 14px); width: 160px; box-sizing: border-box; background: #141414; border: 0.5px solid #2a2a2a; border-radius: 10px; padding: 10px; font-family: 'Inter', sans-serif; }
        .sched-pad.collapsed { width: 20px; padding: 0; border-radius: 6px; }
        .sched-pad-tab { display: flex; flex-direction: column; align-items: center; gap: 6px; width: 100%; padding: 8px 0; background: none; border: 0; color: #c8956c; cursor: pointer; }
        .sched-pad-count { font-size: 10px; color: #aaa; font-family: 'Space Mono', monospace; }
        .sched-pad-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: #c8956c; }
        .sched-pad-head span { display: inline-flex; align-items: center; gap: 5px; }
        .sched-pad-collapse { background: none; border: 0; padding: 2px; color: #666; cursor: pointer; display: inline-flex; }
        .sched-pad-collapse:hover { color: #c8956c; }
        .sched-pad-input { width: 100%; box-sizing: border-box; background: #0f0f0f; border: 0.5px solid #2a2a2a; border-radius: 6px; padding: 6px 8px; color: #fff; font-family: inherit; font-size: 10.5px; outline: none; margin-bottom: 8px; }
        .sched-pad-input:focus { border-color: #c8956c; }
        .sched-pad-input::placeholder { color: #555; }
        .sched-pad-msg { font-size: 10px; color: #e79289; margin-bottom: 8px; line-height: 1.4; }
        .sched-pad-list { display: flex; flex-direction: column; gap: 5px; }
        .sched-pad-chip { position: relative; background: #1a1a1a; border-radius: 4px; padding: 6px 16px 6px 8px; font-size: 10.5px; line-height: 1.4; color: #aaa; cursor: text; overflow-wrap: anywhere; }
        .sched-pad-edit { width: 100%; box-sizing: border-box; border: 0.5px solid #c8956c; font-family: inherit; resize: vertical; outline: none; padding-right: 8px; }
        .sched-pad-x { position: absolute; top: 3px; right: 3px; background: none; border: 0; padding: 0 2px; color: #666; font-size: 12px; line-height: 1; cursor: pointer; opacity: 0; }
        .sched-pad-chip:hover .sched-pad-x, .sched-pad-x:focus-visible { opacity: 1; }
        .sched-pad-x:hover { color: #e79289; }
        .staff-role-check input { accent-color: var(--accent); }
        .staff-delete-btn { background: rgba(178,58,47,0.15); border-color: rgba(178,58,47,0.5); color: #e0796c; }
        .staff-delete-btn:hover { background: rgba(178,58,47,0.28); }
        .staff-profile-val { background: var(--s1); border-color: var(--line2); color: var(--txt); }
        .staff-profile-val:hover { border-color: var(--accent); }
        .staff-profile-empty { color: var(--muted); }
        .staff-profile-status.reg-yes { color: #7fb392; }
        .qr-btn { background: var(--s2); border-color: var(--line2); color: var(--txt2); }
        .qr-btn:hover { background: var(--line); color: var(--txt); }
        .qr-caption { color: var(--txt2); }
        .qr-subject { background: rgba(200,149,108,0.12); color: var(--accent); }
        .info-updates { background: rgba(200,149,108,0.10); border-color: rgba(200,149,108,0.35); }
        .info-updates-title { color: var(--accent); }
        .info-update-row { border-color: rgba(200,149,108,0.22); }
        .cal-off-chip { background: rgba(74,122,155,0.20); color: #9dc0d6; }

        /* ================= MIDNIGHT SOLID (brief item 1) =================
           Calendar week view + Rail move to a near-black base where chips are a
           single solid tone and role identity lives in the text color only. */
        .hub { --bg: #0a0a0a; background: #0a0a0a; }

        /* ---- calendar week view ---- */
        .cal-week-view { background: #0a0a0a; border-color: #141414; }
        .cal-week-view .week-table th,
        .cal-week-view .week-table td { border-color: #141414; }
        .cal-week-view .week-table td.shift-cell,
        .cal-week-view .emp-name { border-top: 0.5px solid #141414; }
        .cal-week-view .role-header { border-bottom: 0.5px solid #141414; letter-spacing: 2.5px; font-size: 10px; }
        .cal-week-view .shift-chip { border-width: 0.5px; border-radius: 20px; font-size: 10px; padding: 5px 4px; }
        .cal-week-off { display: inline-block; width: 100%; text-align: center; color: #222222; font-size: 15px; line-height: 1.4; user-select: none; }
        /* Today: orange underline on the header, faint warm tint down the column */
        .cal-week-view .week-table th.today-col { border-bottom: 2px solid var(--accent); color: var(--accent); background: transparent; }
        .cal-week-view .week-table td.today-col { background: #131108; }
        .cal-week-view .week-range { color: #ffffff; }

        /* ---- Rail ---- */
        .rs-card { background: #0f0f0f; border-color: #141414; }
        .rs-head, .rs-strip { border-color: #141414; }
        .rs-q { background: #141414; border-color: #1a1a1a; }
        .rs-q-sel { background: #1a1a1a; }
        .rs-q-menu-btn:hover, .rs-q-menu-btn[aria-expanded="true"] { background: #1f1f1f; }
        .rs-q-menu { background: #1a1a1a; border-color: #262626; box-shadow: 0 10px 24px rgba(0,0,0,0.6); }
        .rs-q-menu-item:hover { background: #262626; }
        .rs-q-menu-danger { color: #e07668; }
        .rs-restore-btn { border-color: #262626; }
        .rs-detail { background: #141414; border-color: #1a1a1a; }
        .rs-detail-note { background: #0f0f0f; border-color: #1a1a1a; }
        .rs-card .nr-panel { background: #141414; border-color: #1a1a1a; }
        /* Neutral chips only — the type badge and avatar keep their inline
           request-type color, which is the whole signal in the queue. */
        .rs-card .nr-count { background: #1a1a1a; }
        .rs-card .nr-row, .rs-card .nr-log-row { border-color: #1a1a1a; }
        .rs-card .nr-empty { background: #141414; border-color: #1a1a1a; }
        .rs-clear-block { display: block; margin: 8px 0 0 auto; }
        .rs-clear:disabled { opacity: 0.45; cursor: default; }

        /* ---- Save / autosave indicator (brief item 3) ---- */
        .save-status {
          font-family: 'Space Mono', monospace; font-size: 9.5px; letter-spacing: 1px;
          text-transform: uppercase; white-space: nowrap; color: var(--muted);
        }
        .save-status-saved { color: #5a8a6a; }
        .save-status-saving { color: var(--accent); }
        .save-status-dirty { color: #d9a441; }
        .save-status-error { color: #e79289; }

        /* Tip Sheet action row — Save · Lock · Send · Save as PDF · Print. */
        .tip-actions { margin-top: 16px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .tip-actions .save-status { margin-right: 2px; }
        /* A sheet that already went out: green, so "send again" reads as a
           deliberate act rather than the default next step. */
        .publish-btn-sent { background: #4C6B4F; border-color: #4C6B4F; display: inline-flex; align-items: center; gap: 6px; }

        /* ---- Send Tip Sheet confirmation (brief item 5) ---- */
        .send-modal {
          background: var(--s1); color: var(--txt); border: 1px solid var(--line2); border-radius: 12px;
          padding: 18px 20px; width: min(660px, 94vw); max-height: 86vh; overflow-y: auto;
          box-shadow: 0 18px 48px rgba(0,0,0,0.45); animation: zoomIn 0.18s ease;
        }
        .send-section-label {
          display: flex; align-items: center; gap: 8px; margin: 14px 0 6px;
          font-family: 'Space Mono', monospace; font-size: 10.5px; letter-spacing: 0.6px;
          text-transform: uppercase; color: var(--muted);
        }
        .send-recipients { display: flex; flex-direction: column; gap: 4px; max-height: 260px; overflow-y: auto; }
        .send-rcpt {
          display: grid; grid-template-columns: 16px minmax(72px, auto) minmax(84px, auto) 1fr auto;
          align-items: center; gap: 10px; padding: 7px 9px; border-radius: 7px;
          background: var(--s2); border: 1px solid var(--line); cursor: pointer; font-size: 12.5px;
        }
        .send-rcpt:hover { border-color: var(--line2); }
        .send-rcpt-name { font-weight: 700; color: var(--txt); }
        .send-rcpt-pos, .send-rcpt-email { color: var(--txt2); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .send-rcpt-payout { font-family: 'Space Mono', monospace; font-size: 11.5px; color: var(--accent); }
        /* Still listed, so the manager can see who won't get it. */
        .send-rcpt-noemail { opacity: 0.55; cursor: default; }
        .send-rcpt-noemail .send-rcpt-email { color: #e79289; font-style: italic; }
        .send-error { margin-top: 12px; font-size: 12px; color: #e79289; }
        .send-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
        .publish-group-label { font-family: 'Space Mono', monospace; font-size: 9.5px; letter-spacing: 1px; text-transform: uppercase; color: var(--muted); margin: 10px 0 4px; }
        .publish-sent-tag { color: #7fb392; }
        .publish-test-ok { display: flex; align-items: center; gap: 6px; margin-top: 12px; font-size: 12px; color: #7fb392; }

        /* ---- Manage Shifts (item 3) ---- */
        .shift-mgmt { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
        .shift-mgmt-row { display: flex; align-items: flex-start; gap: 12px; padding: 8px 2px; border-top: 1px solid var(--line); flex-wrap: wrap; }
        .shift-mgmt-role { font-family: 'Space Mono', monospace; font-size: 10.5px; letter-spacing: 1.5px; text-transform: uppercase; font-weight: 700; width: 120px; flex-shrink: 0; padding-top: 4px; }
        .shift-mgmt-opts { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; flex: 1; min-width: 0; }
        .shift-mgmt-chip { display: inline-flex; align-items: center; gap: 3px; background: #1a1a1a; border: 1px solid var(--line2); border-radius: 20px; padding: 3px 5px 3px 11px; font-family: 'Space Mono', monospace; font-size: 10.5px; color: var(--txt2); }
        .shift-mgmt-chip.is-off { border-style: dashed; }
        .shift-off-check { display: inline-flex; align-items: center; gap: 3px; margin-left: 6px; padding-left: 7px; border-left: 1px solid var(--line2); font-size: 9px; letter-spacing: 0.3px; color: var(--muted); cursor: pointer; white-space: nowrap; }
        .shift-mgmt-chip.is-off .shift-off-check { color: var(--accent); }
        .shift-off-check input { accent-color: var(--accent); margin: 0; width: 11px; height: 11px; cursor: pointer; }
        .shift-off-hint { font-size: 9px; color: #e0b36c; margin-left: 4px; white-space: nowrap; }
        .shift-mgmt-x { background: none; border: none; cursor: pointer; color: var(--muted); padding: 0 2px; display: inline-flex; align-items: center; }
        .shift-mgmt-x:hover { color: #e0796c; }
        .shift-mgmt-add { background: rgba(90,138,106,0.16); border: 1px solid rgba(90,138,106,0.5); color: #7fb392; border-radius: 20px; padding: 4px 12px; font-family: 'Manrope', sans-serif; font-weight: 700; font-size: 11px; cursor: pointer; }
        .shift-mgmt-add:hover { background: rgba(90,138,106,0.28); }
        .shift-mgmt-input { max-width: 190px; padding: 4px 10px; border-radius: 20px; font-size: 11.5px; }

        /* ---- Today at a Glance swap (item 5) ---- */
        .swap-icon-btn { background: none; border: none; cursor: pointer; color: var(--muted); font-size: 13px; line-height: 1; padding: 0 0 0 8px; }
        .swap-icon-btn:hover { color: var(--accent); }
        .manual-field:disabled { opacity: 0.75; cursor: default; }

        /* ---- item 8: schedule cells read as pills ---- */
        .cell-select, .cell-select.shift-select, .cell-select.role-select { border-radius: 20px; padding: 4px 8px; }
        .shift-chip, .cell-blocked { border-radius: 20px; }

        /* ---- item 7: calendar date notes ---- */
        .cal-note-dot { position: absolute; top: 7px; right: 7px; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
        .cal-day.today .cal-note-dot, .cal-gap-flag ~ .cal-note-dot { right: 20px; }
        .cal-note-row { display: flex; align-items: flex-start; gap: 8px; padding: 5px 0; border-bottom: 1px dashed var(--line); font-size: 12.5px; }
        .cal-note-text { flex: 1; color: var(--txt2); line-height: 1.4; word-break: break-word; }
        .cal-note-del { background: none; border: none; cursor: pointer; color: var(--muted); padding: 2px; flex-shrink: 0; }
        .cal-note-del:hover { color: #e0796c; }
        .cal-note-add { display: flex; gap: 7px; margin-top: 9px; }

        /* ---- item 6: two-step delete arm ---- */
        .staff-delete-arm { display: flex; align-items: center; gap: 10px; margin: 14px 0 4px; flex-wrap: wrap; }
        .staff-delete-arm-on { background: rgba(178,58,47,0.15) !important; border-color: rgba(178,58,47,0.5) !important; color: #e0796c !important; }
        .staff-delete-arm-note { font-size: 11.5px; color: var(--txt2); font-style: italic; }

        /* ---- item 10: readable 3-month cells ---- */
        .cal-grid.multi-month { gap: 26px; }
        .cal-grid.multi-month .cal-day { min-height: 74px; padding: 7px 6px 8px; font-size: 12.5px; }
        .cal-grid.multi-month .cal-day-num { font-size: 13px; }
        .cal-grid.multi-month .cal-day.today .cal-day-num { width: 22px; height: 22px; }
        .cal-grid.multi-month .cal-weekday { font-size: 10px; padding-bottom: 5px; min-height: 18px; }
        .cal-grid.multi-month .cal-month-label { font-size: 12px; margin-bottom: 6px; }
        .cal-grid.multi-month .cal-day-meta { font-size: 10px; margin-top: 7px; }
        /* Readability wins over fitting three months on a narrow screen: below
           this width the wrapper scrolls sideways instead of shrinking cells. */
        @media (max-width: 1180px) {
          .cal-grid.multi-month { grid-template-columns: repeat(3, minmax(300px, 1fr)); }
          .cal-multi-scroll { overflow-x: auto; }
        }
      `}</style>

      <div className="hub-header">
        <div className="hub-brand">
          <img src={HAENYEO_ICON} alt="Haenyeo" className="hub-icon" />
          {/* Brand is the mark plus the name — nothing else (brief item 1). */}
          <div className="hub-title">HAENYEO</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div className="hub-date">TODAY — {TODAY_HEADER}</div>
          {session?.user?.email && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="hub-date" style={{ color: "#555555" }}>{session.user.email}</span>
              <button
                onClick={onSignOut}
                title="Sign out"
                className="hub-signout"
                style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "1px solid rgba(237,231,217,0.18)", borderRadius: 6, color: "#A79E8C", fontFamily: "'Space Mono', monospace", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", padding: "5px 9px", cursor: "pointer" }}
              >
                <LogOut size={12} /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
      {loadError && (
        <div style={{ maxWidth: 1180, margin: "0 auto 16px", padding: "10px 14px", borderRadius: 8, background: "rgba(178,58,47,0.12)", border: "1px solid rgba(178,58,47,0.4)", color: "#E0917F", fontSize: 12.5 }}>
          Couldn’t load live data from Supabase: {loadError} — showing seed data. Check that this account has access (RLS) and the tables are reachable.
        </div>
      )}

      <div className="tabs">
        {/* Order per brief: RAIL · CALENDAR · TIP SHEET · SET SCHEDULE · STAFF · INVOICES · MENU */}
        <button className={`tab-btn ${tab === "rail" ? "active" : ""}`} onClick={() => setTab("rail")}>Rail</button>
        <button className={`tab-btn ${tab === "calendar" ? "active" : ""}`} onClick={() => setTab("calendar")}>Calendar</button>
        <button className={`tab-btn ${tab === "tips" ? "active" : ""}`} onClick={() => setTab("tips")}>Tip Sheet</button>
        <button className={`tab-btn ${tab === "template" ? "active" : ""}`} onClick={() => setTab("template")}>Set Schedule</button>
        <button className={`tab-btn ${tab === "staff" ? "active" : ""}`} onClick={() => setTab("staff")}>Staff</button>
        <button className={`tab-btn ${tab === "invoices" ? "active" : ""}`} onClick={() => setTab("invoices")}>Invoices</button>
        <button className={`tab-btn ${tab === "menu" ? "active" : ""}`} onClick={() => setTab("menu")}>Menu</button>
      </div>

      {tab === "rail" && (
        <div className="nr-wrap">
          <div className="nr-card rs-card">
            {/* ---- brand row: icon + HAENYEO, Gmail status top-right ----
                 The pending count moved into the Pending Decisions header
                 (brief item 3), and Gmail took the corner it left behind. */}
            <div className="rs-head">
              <img src={HAENYEO_ICON} alt="" className="rs-head-icon" />
              <span className="rs-head-word">HAENYEO</span>
              {(() => {
                const st = gmailStatus;
                const connected = !!st?.connected;
                // Green only when the mailbox is actually connected. Anything
                // else — disconnected, never set up, still checking — is a
                // problem the manager should see, and shows no "last checked"
                // line because the time would be reassuring and wrong.
                const ok = connected;
                const last = ok && st?.lastPollAt ? new Date(st.lastPollAt) : null;
                const detail = st == null
                  ? "Checking Gmail…"
                  : connected
                  ? `Connected${st.email ? ` as ${st.email}` : ""}`
                  : st.configured
                  ? `Disconnected${st.lastError ? ` — ${st.lastError}` : ""}`
                  : "Not set up";
                return (
                  <>
                  <button
                    type="button"
                    className={`rs-gmail ${ok ? "rs-gmail-ok" : "rs-gmail-bad"}`}
                    onClick={checkGmailNow}
                    disabled={gmailChecking || !session?.access_token}
                    title={`${detail}${session?.access_token ? " · click to check now" : " · sign in to check"}`}
                  >
                    <span className="rs-gmail-dot" />
                    <span className="rs-gmail-body">
                      <span className="rs-gmail-label">Gmail</span>
                      {gmailChecking
                        ? <span className="rs-gmail-sub">checking…</span>
                        : gmailDisconnected
                        ? <span className="rs-gmail-sub">disconnected — reconnect</span>
                        : last && <span className="rs-gmail-sub">last checked {last.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}
                    </span>
                  </button>
                  {gmailDisconnected && (
                    <a
                      className="rs-gmail-reconnect"
                      href={gmailReconnectUrl}
                      target="_blank"
                      rel="noopener"
                      title="Sign into the scheduling Gmail account and grant access again"
                    >Reconnect</a>
                  )}
                  </>
                );
              })()}
            </div>

            {/* ---- 7-day strip: pick a day to load it below (brief item 7).
                 The selected day carries the highlight; today keeps its dot
                 whether or not it's the one selected, so you never lose track
                 of where today is. ---- */}
            <div className="rs-strip">
              {weekStrip.map((d, i) => {
                const holidayName = holidayFor(d.iso);
                const nPending = railItemsForDate(d.iso).filter((x) => x.status === "pending").length;
                const selected = d.iso === glanceIso;
                return (
                  <button
                    type="button"
                    className={`rs-day ${selected ? "rs-day-today" : ""}`}
                    key={d.iso}
                    onClick={() => setGlanceIso(d.iso)}
                    aria-pressed={selected}
                    title={[
                      `Show ${d.date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}`,
                      holidayName,
                      nPending ? `${nPending} pending` : "",
                    ].filter(Boolean).join(" · ")}
                  >
                    <div className="rs-day-name">{d.label}</div>
                    <div className="rs-day-num">{d.num}</div>
                    <div className="rs-day-marks">
                      {i === 0 && <span className="rs-mark rs-mark-today" />}
                      {nPending > 0 && <span className="rs-mark rs-mark-pending" />}
                      {holidayName && <span className="rs-mark rs-mark-holiday" />}
                    </div>
                  </button>
                );
              })}
            </div>
            {holidaysThisWeek.length > 0 && (
              <div className="rs-holiday-note">Holiday this week: {holidaysThisWeek.map((h) => h.name).join(", ")}</div>
            )}

            {/* Date Note quick-add (brief item 3), in the strip the Gmail status
                used to occupy. Writes to calendar_notes — the same rows the
                Calendar's date page reads, so a note added here shows up there
                and vice versa. */}
            {calendarNotesAvailable() && (
              <div className="rs-quicknote">
                {/* Icon only — the date picker and the placeholder already say
                    what this is (brief item 5). */}
                <span className="rs-quicknote-label" title="Add a note to a date on the Calendar"><Calendar size={15} /></span>
                <input
                  className="rs-quicknote-date"
                  type="date"
                  value={quickNoteDate}
                  onChange={(e) => setQuickNoteDate(e.target.value)}
                  title="Which date this note belongs to"
                />
                <input
                  className="rs-quicknote-text"
                  type="text"
                  placeholder="Add a note to this date on the Calendar…"
                  value={quickNoteDraft}
                  disabled={quickNoteBusy}
                  onChange={(e) => setQuickNoteDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addQuickDateNote(); }}
                />
                <button
                  className="publish-btn"
                  disabled={!quickNoteDraft.trim() || !quickNoteDate || quickNoteBusy}
                  onClick={addQuickDateNote}
                >{quickNoteBusy ? "Adding…" : "Add"}</button>
                {quickNoteMsg && <span className="rs-quicknote-msg">{quickNoteMsg}</span>}
              </div>
            )}
            {/* ---- Dark Split: queue | detail | log+notes ---- */}
            <div className="rs-grid">

              {/* LEFT — who is on the floor on the day picked in the strip */}
              <div className="rs-col-left">
                <div className="nr-label">
                  <Users size={13} /> {glanceHeading}
                  {!glanceIsToday && (
                    <button className="rs-clear" onClick={() => setGlanceIso(TODAY_ISO)} title="Back to today">Today</button>
                  )}
                </div>
                <div className="nr-panel">
                  {glanceView.count === 0 && (
                    <div className="rs-log-empty">
                      Nobody is scheduled {glanceIsToday ? "today" : `on ${shortDate(glanceIso)}`}.
                    </div>
                  )}
                  {/* Grouped in Tip Sheet order; a group with nobody in it gets no
                      label. Coverage gaps are holes, not people — they stay at
                      the end, outside any group. */}
                  {[...glanceView.groups.flatMap((g) => [{ label: g.key }, ...g.people]), ...glanceView.gaps].map((r) => r.label ? (
                    <div className="rs-glance-group" key={`grp-${r.label}`}>{r.label}</div>
                  ) : (
                    <div className="nr-row" key={r.name}>
                      <span>
                        <span className="nr-dot" style={r.code === "GAP" ? { background: "#B23A2F" } : undefined} />
                        {r.name}
                      </span>
                      <span className="nr-row-status">
                        {r.code === "GAP" ? "Coverage gap" : shiftLabelForType(r.code)}
                        {r.swing && <span className="rs-glance-swing">(swing)</span>}
                        <button
                          className="swap-icon-btn"
                          title={`Swap ${r.name} out for ${glanceIsToday ? "today" : shortDate(glanceIso)}`}
                          onClick={() => openSwap(r)}
                        >⇄</button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* CENTRE — the selected request, then the standing notes. The
                  detail sits ABOVE the notes rather than replacing them, so
                  reviewing a request never hides the note board. */}
              <div className="rs-col-mid">
                {(() => {
                  const item = pending.find((p) => p.id === selectedRailId);
                  if (!item) return null;
                    const style = TYPE_STYLES[item.type] || { badge: "#7B93A3", label: item.type };
                    const isTimeOff = item.type === "TIME OFF";
                    const to = isTimeOff ? timeOffDates(item.dates) : null;
                    const busy = railBusy === item.id;
                    return (
                      <div className="rs-detail">
                        <div className="rs-detail-top">
                          <span className="rs-q-avatar rs-detail-avatar" style={{ background: style.badge }}>{item.name[0]}</span>
                          <div>
                            <div className="rs-detail-name">
                              {item.name}
                              {item.unmatchedName && (
                                <span className="nr-unmatched" title="No staff member matches this name — approve after fixing, or add them on the Staff tab">
                                  <AlertTriangle size={10} /> Unmatched name
                                </span>
                              )}
                            </div>
                            <div className="rs-detail-type">
                              <span className="rs-type-badge" style={{ background: style.badge }}>{style.label}</span>
                              {item.urgent && <span className="nr-urgent"><AlertTriangle size={11} /> Short notice</span>}
                            </div>
                          </div>
                          <div className="rs-detail-dates">{item.dates}</div>
                        </div>

                        <div className="rs-detail-meta">
                          {isTimeOff && `${to.consecutive ? "Consecutive" : "Non-consecutive"}${to.dates.length ? ` · ${to.dates.length} day${to.dates.length > 1 ? "s" : ""}` : ""}`}
                          {!isTimeOff && (item.notice ? item.notice : item.source === "gmail" ? "via email" : "")}
                        </div>

                        {item.note && <div className="rs-detail-note">{item.note}</div>}

                        <input
                          className="nr-manager-note"
                          type="text"
                          placeholder={partialOpen[item.id] ? "Note to staff (required for partial approval)…" : "Optional note to staff (used in the email reply)…"}
                          value={railNotes[item.id] || ""}
                          onChange={(e) => setRailNotes((n) => ({ ...n, [item.id]: e.target.value }))}
                          disabled={busy}
                        />
                        {isTimeOff && partialOpen[item.id] && (
                          <input
                            className="nr-manager-note"
                            type="text"
                            placeholder='Approved dates only (e.g. "Jul 28, Jul 30")'
                            value={partialDates[item.id] || ""}
                            onChange={(e) => setPartialDates((n) => ({ ...n, [item.id]: e.target.value }))}
                            disabled={busy}
                          />
                        )}
                        <div className="nr-item-actions">
                          {isTimeOff && partialOpen[item.id] ? (
                            <>
                              <button className="nr-btn nr-btn-approve" disabled={busy} onClick={() => resolvePartial(item)}><Check size={14} /> Confirm partial</button>
                              <button className="nr-btn nr-btn-deny" disabled={busy} onClick={() => setPartialOpen((n) => ({ ...n, [item.id]: false }))}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button className="nr-btn nr-btn-approve" disabled={busy} onClick={() => resolve(item, true)}><Check size={14} /> Approve</button>
                              {isTimeOff && (
                                <button className="nr-btn nr-btn-partial" disabled={busy} onClick={() => setPartialOpen((n) => ({ ...n, [item.id]: true }))}>Partial</button>
                              )}
                              <button className="nr-btn nr-btn-deny" disabled={busy} onClick={() => resolve(item, false)}><X size={14} /> Deny</button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                })()}

                {/* General notes (brief item 2): standing notes, no dates, edited
                    in place. Taller and at full size so the box reads at a
                    glance without opening anything. Per-week notes still live
                    behind the Set Schedule Notes button. */}
                {generalNotesAvailable() && (
                  <>
                    <div className="nr-label">
                      Notes <span className="nr-count">{genNotes.length}</span>
                    </div>
                    <div className="nr-panel rs-notes">
                      {genNotes.length === 0 ? (
                        <div className="rs-log-empty">No notes yet</div>
                      ) : (
                        <div className="rs-note-list">
                          {genNotes.map((n) => (
                            <div className="rs-note-row" key={n.id}>
                              {genNoteEditId === n.id ? (
                                <>
                                  <textarea
                                    className="rs-note-edit"
                                    /* Grow with the note so editing doesn't hide
                                       the end of it. ~24 chars fit per line in
                                       this column; the +1 covers word wrapping
                                       landing short of a full line. */
                                    rows={Math.min(9, Math.max(3,
                                      Math.ceil(genNoteEditText.length / 24) + 1 + (genNoteEditText.match(/\n/g) || []).length))}
                                    autoFocus
                                    value={genNoteEditText}
                                    onChange={(e) => setGenNoteEditText(e.target.value)}
                                    onKeyDown={(e) => {
                                      // Enter saves, Shift+Enter keeps a line break.
                                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveGeneralNoteEdit(n.id); }
                                      if (e.key === "Escape") setGenNoteEditId(null);
                                    }}
                                  />
                                  <div className="rs-note-actions">
                                    <button className="rs-note-btn" title="Save" onClick={() => saveGeneralNoteEdit(n.id)}><Check size={13} /></button>
                                    <button className="rs-note-btn" title="Cancel" onClick={() => setGenNoteEditId(null)}><X size={13} /></button>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <button
                                    className="rs-note-text"
                                    title="Click to edit"
                                    onClick={() => { setGenNoteEditId(n.id); setGenNoteEditText(n.note); }}
                                  >{n.note}</button>
                                  <div className="rs-note-actions">
                                    <button className="rs-note-btn rs-note-del" title="Delete note" onClick={() => removeGeneralNote(n.id)}><X size={13} /></button>
                                  </div>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="rs-note-add">
                        <input
                          className="rs-note-input"
                          placeholder="Add a note…"
                          value={genNoteDraft}
                          disabled={genNoteBusy}
                          onChange={(e) => setGenNoteDraft(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") addGeneralNote(); }}
                        />
                        <button className="rs-note-btn" disabled={!genNoteDraft.trim() || genNoteBusy} onClick={addGeneralNote} title="Add note">
                          <Check size={13} />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* RIGHT — pending queue, with the auto-action log under it */}
              <div className="rs-col-right">
                <div className="nr-label">
                  <Clock size={13} /> Pending Decisions <span className="nr-count">{pending.length}</span>
                  <button className="manual-add-btn" onClick={() => { setManualError(null); setManualOpen(true); }} title="Manually log a scheduling request made in person">+ Add Request</button>
                </div>
                {pending.length === 0 && <div className="nr-empty rs-empty">Nothing waiting on you right now.</div>}
                {pending.map((item) => {
                  const style = TYPE_STYLES[item.type] || { badge: "#7B93A3", label: item.type };
                  const sel = selectedRailId === item.id;
                  const menuOpen = railMenuId === item.id;
                  return (
                    // The ••• control can't live inside the card button (nested
                    // buttons aren't valid), so the two are siblings in a wrapper.
                    <div className="rs-q-wrap" key={item.id}>
                      <button
                        type="button"
                        className={`rs-q ${sel ? "rs-q-sel" : ""}`}
                        style={sel ? { borderLeftColor: style.badge } : undefined}
                        onClick={() => setSelectedRailId(item.id)}
                      >
                        <span className="rs-q-avatar" style={{ background: style.badge }}>{item.name[0]}</span>
                        <span className="rs-q-body">
                          <span className="rs-q-name">
                            {item.name}
                            {item.urgent && <span className="rs-q-urgent" title="Short notice" />}
                          </span>
                          <span className="rs-q-type" style={{ color: style.badge }}>{style.label}</span>
                          <span className="rs-q-dates">{item.dates}</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="rs-q-menu-btn"
                        title="Delete or archive this request"
                        aria-label={`More actions for ${item.name}'s request`}
                        aria-expanded={menuOpen}
                        onClick={() => setRailMenuId(menuOpen ? null : item.id)}
                      >
                        •••
                      </button>
                      {menuOpen && (
                        <>
                          {/* Click-away layer — closes the menu without the card
                              underneath picking the click up as a selection. */}
                          <div className="rs-q-menu-scrim" onClick={() => setRailMenuId(null)} />
                          <div className="rs-q-menu" role="menu">
                            <button
                              type="button"
                              role="menuitem"
                              className="rs-q-menu-item"
                              onClick={() => { setRailMenuId(null); setRailConfirm({ mode: "archive", item }); }}
                            >
                              Archive
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className="rs-q-menu-item rs-q-menu-danger"
                              onClick={() => { setRailMenuId(null); setRailConfirm({ mode: "delete", item }); }}
                            >
                              Delete
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}

                {visibleResolved.length > 0 && (
                  <>
                    <div className="nr-label rs-label-resolved">Resolved</div>
                    {visibleResolved.slice(0, 12).map((r) => {
                      const style = TYPE_STYLES[r.type] || { badge: "#7B93A3", label: r.type };
                      return (
                        <div className="rs-q rs-q-done" key={r.id}>
                          <span className="rs-q-avatar" style={{ background: style.badge }}>{r.name[0]}</span>
                          <span className="rs-q-body">
                            <span className="rs-q-name">{r.name}</span>
                            <span className="rs-q-type">{style.label} · {r.status}</span>
                            <span className="rs-q-dates">{r.dates}</span>
                          </span>
                        </div>
                      );
                    })}
                    {/* Hide-only and GLOBAL (brief item 1): the watermark is
                        shared, so this clears the list for every manager and
                        survives a refresh. rail_requests is never touched. */}
                    <button
                      className="rs-clear rs-clear-block"
                      disabled={railClearBusy === RAIL_LISTS.resolved}
                      onClick={() => setRailClearWatermark(RAIL_LISTS.resolved, new Date().toISOString())}
                      title="Hide these entries for everyone (nothing is deleted)"
                    >Clear resolved</button>
                  </>
                )}
                {/* Undo for a mis-click — the rows are still in the DB, so
                    dropping the watermark brings them all back. */}
                {railCleared.resolved && visibleResolved.length === 0 && resolvedReqs.length > 0 && (
                  <button
                    className="rs-clear rs-clear-block"
                    disabled={railClearBusy === RAIL_LISTS.resolved}
                    onClick={() => setRailClearWatermark(RAIL_LISTS.resolved, null)}
                    title={`${resolvedReqs.length} hidden — show them again`}
                  >Show resolved ({resolvedReqs.length})</button>
                )}

                {/* Archived — collapsed by default, sits at the bottom so it
                    never competes with the queue for attention. */}
                {archivedReqs.length > 0 && (
                  <div className="rs-archived">
                    <button
                      type="button"
                      className="rs-archived-toggle"
                      aria-expanded={archivedOpen}
                      onClick={() => setArchivedOpen((o) => !o)}
                    >
                      <span className={`rs-archived-caret ${archivedOpen ? "open" : ""}`}>▸</span>
                      Archived <span className="nr-count">{archivedReqs.length}</span>
                    </button>
                    {archivedOpen && archivedReqs.map((r) => {
                      const style = TYPE_STYLES[r.type] || { badge: "#7B93A3", label: r.type };
                      return (
                        <div className="rs-q rs-q-done rs-q-archived" key={r.id}>
                          <span className="rs-q-avatar" style={{ background: style.badge }}>{r.name[0]}</span>
                          <span className="rs-q-body">
                            <span className="rs-q-name">{r.name}</span>
                            <span className="rs-q-type">{style.label} · archived</span>
                            <span className="rs-q-dates">{r.dates}</span>
                          </span>
                          <button
                            type="button"
                            className="rs-restore-btn"
                            disabled={railActionBusy}
                            title={`Move ${r.name}'s request back to the pending queue`}
                            onClick={() => restoreRequest(r)}
                          >
                            Restore
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="nr-label rs-log-label">
                  <Package size={13} /> Auto-Action Log
                  {visibleLog.length > 0 ? (
                    <button
                      className="rs-clear"
                      disabled={railClearBusy === RAIL_LISTS.log}
                      onClick={() => setRailClearWatermark(RAIL_LISTS.log, new Date().toISOString())}
                      title="Hide these entries for everyone (nothing is deleted)"
                    >Clear</button>
                  ) : railCleared.auto_log && log.length > 0 ? (
                    <button
                      className="rs-clear"
                      disabled={railClearBusy === RAIL_LISTS.log}
                      onClick={() => setRailClearWatermark(RAIL_LISTS.log, null)}
                      title={`${log.length} hidden — show them again`}
                    >Show all ({log.length})</button>
                  ) : null}
                </div>
                <div className="nr-panel rs-log">
                  {visibleLog.length === 0 ? (
                    <div className="rs-log-empty">{railCleared.auto_log ? "Cleared" : "Nothing logged yet"}</div>
                  ) : (
                    visibleLog.map((entry) => (
                      <div className={`nr-log-row nr-log-${entry.tone}`} key={entry.id}>
                        {entry.text}<span className="nr-log-time">{entry.time}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          {manualOpen && (
            <div className="day-popup-backdrop" onClick={() => !manualBusy && setManualOpen(false)}>
              <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
                <div className="delete-modal-title">Add Request</div>
                <div className="delete-modal-body">
                  Log a scheduling request made in person. A paper-trail copy goes to the scheduling inbox, and the staff member gets a confirmation email if they're registered.
                </div>
                <label className="manual-field-label" htmlFor="manual-staff">Staff member</label>
                <select id="manual-staff" className="manual-field" value={manualForm.staffId} disabled={manualBusy}
                  onChange={(e) => setManualForm((f) => ({ ...f, staffId: e.target.value }))}>
                  <option value="">Select staff…</option>
                  {staffList.filter((s) => s.id && s.active !== false).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <label className="manual-field-label" htmlFor="manual-type">Type</label>
                <select id="manual-type" className="manual-field" value={manualForm.type} disabled={manualBusy}
                  onChange={(e) => setManualForm((f) => ({ ...f, type: e.target.value }))}>
                  {["REQUEST OFF", "SHIFT SWAP", "COVERAGE REQUEST", "TIME OFF"].map((t) => (
                    <option key={t} value={t}>{TYPE_STYLES[t].label}</option>
                  ))}
                </select>
                <label className="manual-field-label" htmlFor="manual-dates">Dates</label>
                <input id="manual-dates" className="manual-field" type="text" disabled={manualBusy}
                  placeholder='e.g. "Jul 28", "Jul 28 to Aug 4", or "Jul 28, Jul 30"'
                  value={manualForm.dates}
                  onChange={(e) => setManualForm((f) => ({ ...f, dates: e.target.value }))} />
                <label className="manual-field-label" htmlFor="manual-note">Note</label>
                <textarea id="manual-note" className="manual-field" rows={3} disabled={manualBusy}
                  placeholder="Any context or details (optional)…"
                  value={manualForm.note}
                  onChange={(e) => setManualForm((f) => ({ ...f, note: e.target.value }))} />
                <label className="manual-field-label" htmlFor="manual-loggedby">Logged by</label>
                {(() => {
                  const mgrs = staffList
                    .filter((s) => (s.section || "") === "Management" && s.active !== false)
                    .map((s) => s.name);
                  const names = mgrs.length ? mgrs : ["Lenis", "Jon"];
                  return (
                    <select id="manual-loggedby" className="manual-field" value={manualForm.loggedBy} disabled={manualBusy}
                      onChange={(e) => setManualForm((f) => ({ ...f, loggedBy: e.target.value }))}>
                      <option value="">Select manager…</option>
                      {names.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  );
                })()}
                {manualError && <div className="delete-modal-warn">{manualError}</div>}
                <div className="delete-modal-actions">
                  <button className="nr-btn nr-btn-deny" disabled={manualBusy} onClick={() => setManualOpen(false)}>Cancel</button>
                  <button className="nr-btn nr-btn-approve" disabled={manualBusy || !manualForm.staffId || !manualForm.dates.trim() || !manualForm.loggedBy}
                    onClick={submitManualEntry}>
                    {manualBusy ? "Saving…" : "Submit"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "calendar" && calView === "month" && (
        <div className="cal-wrap" key="month">
          <div className="cal-card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid #e4e4e4" }}>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="back-btn" onClick={() => setCalDate((d) => new Date(d.getFullYear(), d.getMonth() - (calMonthView === 1 ? 1 : 3), 1))}><ChevronLeft size={14} /> Prev</button>
                <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, color: "#6b6355", alignSelf: "center", minWidth: 150 }}>
                  {calDate.toLocaleDateString(undefined, { month: "short", year: "numeric" })}
                  {calMonthView === 3 && " – 3 months"}
                </span>
                <button className="back-btn" onClick={() => setCalDate((d) => new Date(d.getFullYear(), d.getMonth() + (calMonthView === 1 ? 1 : 3), 1))}>Next <ChevronRight size={14} /></button>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className={`subtab-btn ${calMonthView === 1 ? "active" : ""}`} onClick={() => setCalMonthView(1)} style={{ padding: "5px 11px", fontSize: 11 }}>1 Month</button>
                <button className={`subtab-btn ${calMonthView === 3 ? "active" : ""}`} onClick={() => setCalMonthView(3)} style={{ padding: "5px 11px", fontSize: 11 }}>3 Months</button>
              </div>
            </div>
            <div className="cal-legend">
              <span className="legend-item"><span className="legend-swatch" style={{ background: "#B3695E" }}></span>Holiday</span>
              <span className="legend-item"><span className="legend-swatch" style={{ background: "#7B93A3" }}></span>Time off</span>
              <span className="legend-item"><AlertTriangle size={11} color="#B23A2F" />Open shift</span>
              <span className="legend-item" style={{ marginLeft: "auto" }}>Click a day for requests, time off & the week view</span>
            </div>
            <div className={calMonthView === 3 ? "cal-multi-scroll" : ""}>
            <div className={`cal-grid ${calMonthView === 3 ? "multi-month" : ""}`}>
              {calMonthView === 1 ? (
                <>
                  {WEEKDAY_LABELS.map((w) => <div className="cal-weekday" key={w}>{w}</div>)}
                  {weeks.flat().map((d, i) => {
                const s = daySummary(d, patternsForDate(d), overrides, fohRoster, isOffCell);
                const holiday = holidayFor(d.iso);
                const offNames = timeOffNamesForDate(d.iso);
                const hasOtherRail = railItemsForDate(d.iso).some((it) => it.type !== "REQUEST OFF");
                return (
                  <div
                    key={d.iso}
                    className={`cal-day ${!d.inMonth ? "dim" : ""} ${d.isToday ? "today" : ""}`}
                    onClick={() => openDayPage(d.date)}
                  >
                    {s.gap && <AlertTriangle size={13} className="cal-gap-flag" />}
                    {(calNotes[d.iso] || []).length > 0 && (
                      <span className="cal-note-dot" title={`${calNotes[d.iso].length} note(s)`} />
                    )}
                    <div className="cal-day-num">{d.day}</div>
                    {holiday && <div className="cal-holiday-label">{holiday}</div>}
                    {offNames.length > 0 && (
                      <div className="cal-off-chips">
                        {offNames.slice(0, 2).map((n) => <span className="cal-off-chip" key={n}>{n}</span>)}
                        {offNames.length > 2 && <span className="cal-off-chip cal-off-more">+{offNames.length - 2}</span>}
                      </div>
                    )}
                    {hasOtherRail && <div className="cal-rail-dot" title="Swap / coverage request touches this day" />}
                  </div>
                );
                  })}
                </>
              ) : (
                <>
                  {threeMonthWeeks.map((monthWeeks, monthIdx) => {
                    const firstInMonth = monthWeeks.flat().find((d) => d.inMonth) || monthWeeks[0]?.[0];
                    const monthLabel = firstInMonth?.date?.toLocaleDateString(undefined, { month: "long", year: "numeric" });
                    const isCurrentMonth = monthWeeks.flat().some((d) => d.iso === TODAY_ISO);
                    return (
                      <div className="cal-month" key={monthIdx}>
                        <div className={`cal-month-label ${isCurrentMonth ? "current" : ""}`}>{monthLabel}</div>
                        {WEEKDAY_LABELS.map((w) => <div className="cal-weekday" key={`${monthIdx}-${w}`}>{w}</div>)}
                        {monthWeeks.flat().map((d, i) => {
                          const s = daySummary(d, patternsForDate(d), overrides, fohRoster, isOffCell);
                          const holiday = holidayFor(d.iso);
                          const offNames = timeOffNamesForDate(d.iso);
                          const hasOtherRail = railItemsForDate(d.iso).some((it) => it.type !== "REQUEST OFF");
                          return (
                            <div
                              key={`${monthIdx}-${d.iso}`}
                              className={`cal-day ${!d.inMonth ? "dim" : ""} ${d.isToday ? "today" : ""}`}
                              onClick={() => openDayPage(d.date)}
                            >
                              {s.gap && <AlertTriangle size={10} className="cal-gap-flag" />}
                              {(calNotes[d.iso] || []).length > 0 && (
                                <span className="cal-note-dot" title={`${calNotes[d.iso].length} note(s)`} />
                              )}
                              <div className="cal-day-num">{d.day}</div>
                              {holiday && <div className="cal-holiday-label" style={{ fontSize: 7 }}>{holiday}</div>}
                              {offNames.length > 0 && (
                                <div className="cal-off-chips">
                                  {offNames.slice(0, 1).map((n) => <span className="cal-off-chip" key={n} style={{ fontSize: 7 }}>{n}</span>)}
                                  {offNames.length > 1 && <span className="cal-off-chip cal-off-more" style={{ fontSize: 7 }}>+{offNames.length - 1}</span>}
                                </div>
                              )}
                              {hasOtherRail && <div className="cal-rail-dot" title="Swap / coverage request touches this day" />}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- Date notes page (brief item 5) ----
           Replaces the old click-a-day popup: a full page for one date, showing
           its notes (add / edit / delete) and the same Rail activity the popup
           listed. The calendar icon at the top opens that date's week schedule,
           which has an icon to come back here. Notes are calendar_notes rows —
           the same ones the Rail's Date Note quick-add writes. */}
      {tab === "calendar" && calView === "day" && calDayIso && (() => {
        const dayObj = new Date(`${calDayIso}T00:00:00`);
        const holiday = holidayFor(calDayIso);
        const items = railItemsForDate(calDayIso);
        const railNames = new Set(items.filter((it) => it.type === "REQUEST OFF").map((it) => it.name));
        const scheduleOffs = timeOffNamesForDate(calDayIso).filter((n) => !railNames.has(n));
        const notes = calNotes[calDayIso] || [];
        return (
          <div className="cal-wrap" key={`day-${calDayIso}`}>
            <div className="cal-card">
              <div className="week-header day-page-head">
                <button className="back-btn" onClick={() => setCalView("month")}><ChevronLeft size={14} /> Back to month</button>
                <div className="week-range">
                  {dayObj.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                </div>
                <button
                  className="day-page-icon"
                  title="Open this date's week schedule"
                  onClick={() => zoomToWeek(weekOffsetFor(dayObj))}
                ><CalendarDays size={16} /></button>
                {/* This date's Tip Sheet (brief item 4). The sheet itself decides
                    whether it's editable — a sent or locked date is already
                    read-only there, so nothing extra is needed here. */}
                <button
                  className="day-page-icon"
                  title="Open this date's Tip Sheet"
                  onClick={() => openTipSheetForDate(calDayIso)}
                ><Receipt size={16} /></button>
              </div>

              {holiday && <div className="day-popup-holiday">★ {holiday}</div>}

              <div className="day-page-split">
                <div className="day-page-col">
                  <div className="nr-label"><StickyNote size={13} /> Notes <span className="nr-count">{notes.length}</span></div>
                  {!calendarNotesAvailable() ? (
                    <div className="day-popup-empty">Notes need migration 0011 — run it to start adding them.</div>
                  ) : (
                    <>
                      {notes.length === 0 && <div className="day-popup-empty">No notes on this date.</div>}
                      <div className="rs-note-list day-page-notes">
                        {notes.map((n) => (
                          <div className="rs-note-row" key={n.id}>
                            {calNoteEditId === n.id ? (
                              <>
                                <textarea
                                  className="rs-note-edit"
                                  rows={Math.min(9, Math.max(2,
                                    Math.ceil(calNoteEditText.length / 60) + 1 + (calNoteEditText.match(/\n/g) || []).length))}
                                  autoFocus
                                  value={calNoteEditText}
                                  onChange={(e) => setCalNoteEditText(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveCalendarNoteEdit(calDayIso, n.id); }
                                    if (e.key === "Escape") setCalNoteEditId(null);
                                  }}
                                />
                                <div className="rs-note-actions">
                                  <button className="rs-note-btn" title="Save" onClick={() => saveCalendarNoteEdit(calDayIso, n.id)}><Check size={13} /></button>
                                  <button className="rs-note-btn" title="Cancel" onClick={() => setCalNoteEditId(null)}><X size={13} /></button>
                                </div>
                              </>
                            ) : (
                              <>
                                <button
                                  className="rs-note-text"
                                  title="Click to edit"
                                  onClick={() => { setCalNoteEditId(n.id); setCalNoteEditText(n.note); }}
                                >{n.note}</button>
                                <div className="rs-note-actions">
                                  <button className="rs-note-btn rs-note-del" title="Delete note" onClick={() => removeCalendarNote(calDayIso, n.id)}><X size={13} /></button>
                                </div>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="rs-note-add day-page-add">
                        <input
                          className="rs-note-input"
                          placeholder="Add a note for this date…"
                          value={calNoteDraft}
                          onChange={(e) => setCalNoteDraft(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") addCalendarNote(calDayIso); }}
                        />
                        <button className="publish-btn" disabled={!calNoteDraft.trim()} onClick={() => addCalendarNote(calDayIso)}>Add</button>
                      </div>
                    </>
                  )}
                </div>

                <div className="day-page-col">
                  <div className="nr-label"><Clock size={13} /> Requests touching this date</div>
                  {items.length === 0 && <div className="day-popup-empty">No requests off, swaps, or coverage requests.</div>}
                  {items.map((it) => (
                    <div className="day-popup-item" key={`${it.id}-${it.status}`}>
                      <span className="day-popup-badge" style={{ background: TYPE_STYLES[it.type]?.badge || "#7B93A3" }}>
                        {TYPE_STYLES[it.type]?.label || it.type}
                      </span>
                      <span className="day-popup-name">{it.name}</span>
                      <span className={`day-popup-status day-popup-status-${it.status}`}>{it.status}</span>
                    </div>
                  ))}
                  {scheduleOffs.length > 0 && (
                    <>
                      <div className="day-popup-section">Time off on the schedule</div>
                      {scheduleOffs.map((n) => (
                        <div className="day-popup-item" key={n}>
                          <span className="day-popup-badge" style={{ background: "#7B93A3" }}>Day off</span>
                          <span className="day-popup-name">{n}</span>
                          <span className="day-popup-status day-popup-status-approved">approved</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {tab === "calendar" && calView === "week" && activeWeek && (
        <div className="cal-wrap" key={`week-${weekIndex}`}>
          {/* cal-week-view scopes the Midnight Solid treatment to this read-only
              sheet — .cal-card and .week-table are shared with Set Schedule and
              the Tip Sheet, which keep the standard dark skin. */}
          <div className="cal-card cal-week-view">
            <div className="week-header">
              <button className="back-btn" onClick={() => setCalView("month")}><ChevronLeft size={14} /> Back to month</button>
              <div className="week-range">{activeWeek[0].date.toLocaleDateString(undefined, MONTH_FMT)} – {activeWeek[6].date.toLocaleDateString(undefined, MONTH_FMT)}</div>
              {/* Back to the date page this week was opened from (brief item 5).
                  Only shown when we actually came from one. */}
              {calDayIso && (
                <button
                  className="day-page-icon"
                  title={`Back to ${shortDate(calDayIso)}'s notes`}
                  onClick={() => setCalView("day")}
                ><StickyNote size={16} /></button>
              )}
              {/* Publishing lives on Set Schedule only — the Calendar is read-only.
                  A published week still shows its badge here for reference. */}
              {publishedWeekStarts.has(activeWeek[0].iso) && (
                <span className="published-badge"><Check size={12} /> Published</span>
              )}
            </div>
            {!isWeekViewable(activeWeek[0].iso) ? (
              /* Item 6: an unfinalized future week is still a draft. Showing it
                 here would read as a settled schedule, so the Calendar shows
                 nothing until Set Schedule finalizes it (or the week passes). */
              <div className="week-not-final">
                <Calendar size={18} />
                <div className="week-not-final-title">Schedule not finalized yet.</div>
                <div className="week-not-final-sub">
                  Finalize the week of {shortDate(activeWeek[0].iso)} on Set Schedule and it will appear here.
                </div>
              </div>
            ) : (
            <table className="week-table">
              <thead>
                <tr>
                  <th></th>
                  {activeWeek.map((d) => (
                    <th key={d.iso} className={d.isToday ? "today-col" : ""}>{JS_WEEKDAY_NAMES[d.weekday]}<br />{d.day}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fohRoleGroups.map((role) => (
                  <React.Fragment key={role}>
                    <tr>
                      {/* Section header takes its own role color (Midnight Solid) */}
                      <td className="role-header" colSpan={8} style={{ color: ROLE_COLOR[role] || undefined }}>{role}</td>
                    </tr>
                    {fohRoster.filter((p) => p.role === role).map((p) => (
                      <tr key={p.name}>
                        <td className="emp-name">{p.name}</td>
                        {activeWeek.map((d) => {
                          const shift = personShiftFor(p.name, d, patternsForDate(d), overrides);
                          const meta = SHIFT_META[shift.type] || SHIFT_META.OFF;
                          // Off reads as a recessive dot rather than a chip;
                          // everything else is a solid #1a1a1a chip inked in the
                          // role actually worked (so Akira's bar cover reads as
                          // Bar, not Busser/Runner). GAP keeps its red warning.
                          const isOff = shift.type === "OFF";
                          const chipStyle =
                            shift.type === "GAP"
                              ? { color: "#e0796c", borderColor: "#5c2a24", background: MIDNIGHT.chip }
                              : calChipStyle(roleForCell(shift.type, p.role));
                          return (
                            <td key={d.iso} className={`shift-cell ${d.isToday ? "today-col" : ""}`}>
                              {isOff ? (
                                <span className="cal-week-off" aria-label="Off">·</span>
                              ) : (
                                <span className="shift-chip" style={chipStyle}>
                                  {meta.label}
                                  {shift.swap && <span className="swap-ribbon">SWAP</span>}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
            )}
          </div>

        </div>
      )}

      {tab === "template" && (
        <div className="cal-wrap sched-wrap" key="template">
          <div className="cal-card" ref={scheduleCardRef}>
            <div className="print-header">
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {/* Nothing on a past week can become dirty, so Save and its
                    status go with the other edit controls (brief item 2).
                    Print / PDF / Notes stay — those only read. */}
                {!schedulePastWeek && (
                  <>
                    <SaveStatus state={schedSaveState} />
                    <button
                      className="print-btn save-btn"
                      disabled={schedSaveState === "saving"}
                      onClick={saveScheduleNow}
                      title={`Write the week of ${shortDate(activeWeekStart)} to Supabase now (cells also save as you click them)`}
                    >
                      {schedSaveState === "saving" ? "Saving…" : "Save"}
                    </button>
                  </>
                )}
                <button className="print-btn" onClick={printSchedule}><Printer size={13} /> Print</button>
                <button className="print-btn" disabled={pdfBusy === "schedule"} onClick={exportSchedulePdf}>
                  <FileDown size={13} /> {pdfBusy === "schedule" ? "Saving…" : "Save as PDF"}
                </button>
                {/* Lock / Finalize / Publish are all edit-state controls, so a
                    past week shows none of them (brief item 2) — just a label
                    saying why the grid won't respond. */}
                {schedulePastWeek ? (
                  <span className="past-week-tag"><Lock size={12} /> Past week — view only</span>
                ) : (
                  <>
                    {/* Locks the sub-tab on screen for the week on screen only — the
                        other two sections, and every other week, are unaffected. */}
                    <button
                      className={`print-btn ${scheduleLocked ? "lock-active" : ""}`}
                      onClick={toggleSectionLock}
                      title={
                        scheduleLocked
                          ? `Unlock ${SECTION_LABEL[scheduleView]} for the week of ${shortDate(activeWeekStart)}`
                          : `Lock ${SECTION_LABEL[scheduleView]} for the week of ${shortDate(activeWeekStart)} only`
                      }
                    >
                      {scheduleLocked ? <Lock size={13} /> : <Unlock size={13} />}{" "}
                      {scheduleLocked
                        ? `Locked ✓ — ${shortDate(activeWeekStart)}`
                        : `Lock ${SECTION_LABEL[scheduleView]} — ${shortDate(activeWeekStart)}`}
                    </button>
                    {/* Finalize is purely a Calendar gate (brief item 3): it puts
                        the week on the Calendar and takes it off again. No email
                        is sent either way — that's Publish. */}
                    <button
                      className={`print-btn ${weekIsFinalized ? "finalized-active" : ""}`}
                      disabled={finalizeBusy}
                      onClick={toggleWeekFinalized}
                      title={
                        weekIsFinalized
                          ? "Un-finalize — removes this week from the Calendar and clears its published state so it can be sent again"
                          : "Mark this week final so it shows on the Calendar (sends no email)"
                      }
                    >
                      {finalizeBusy ? "Saving…" : weekIsFinalized ? "✓ Finalized" : "Finalize"}
                    </button>
                  </>
                )}
                {notesTableAvailable() && (
                  <button className="print-btn" onClick={() => setNotesWeek(activeWeekStart)} title="Notes for this week">
                    Notes ({weekNotes.length})
                  </button>
                )}
                {/* Publish lives here only, never on the Calendar. It opens the Publish
                    dialog for every finalized week that hasn't gone out yet; nothing is
                    emailed until Confirm & Send there. */}
                {!schedulePastWeek && (
                  weekPublishedAt && weekIsFinalized ? (
                    <span className="published-badge" title={`Schedule emails sent ${new Date(weekPublishedAt).toLocaleString()}`}>
                      <Check size={12} /> Published ✓ {new Date(weekPublishedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </span>
                  ) : (
                    <button
                      className="publish-btn"
                      disabled={!!publishModal || !weekIsFinalized || unpublishedFinalizedWeeks.length === 0}
                      onClick={openPublishDialog}
                      title={
                        !weekIsFinalized
                          ? "Finalize this week before publishing"
                          : unpublishedFinalizedWeeks.length === 0
                          ? "Every finalized week has already been published"
                          : `Send schedule emails for ${unpublishedFinalizedWeeks.length} finalized week${unpublishedFinalizedWeeks.length === 1 ? "" : "s"}`
                      }
                    >
                      {`Publish (${unpublishedFinalizedWeeks.length})`}
                    </button>
                  )
                )}
              </div>
              <div className="print-week-range">
                <button
                  className="today-btn"
                  disabled={onCurrentWeek}
                  title="Jump to the current week"
                  onClick={() => setWeekIndex(0)}
                >
                  Today
                </button>
                {/* Stops 2 weeks back (brief item 2) — older weeks are on the
                    Calendar, not here. Forward is unlimited. */}
                <button
                  className="back-btn"
                  disabled={atOldestScheduleWeek}
                  title={atOldestScheduleWeek
                    ? `Set Schedule goes back ${SCHEDULE_LOOKBACK_WEEKS} weeks — use the Calendar for anything older`
                    : "Previous week"}
                  onClick={() => setWeekIndex((i) => Math.max(-SCHEDULE_LOOKBACK_WEEKS, i - 1))}
                ><ChevronLeft size={13} /></button>
                <span className={`week-range-text ${onCurrentWeek ? "week-range-current" : ""} ${weekIsFinalized ? "week-range-finalized" : ""}`}>
                  {formatWeekRange(activeWeek)}
                  {weekIsFinalized && <span className="week-finalized-dot" title="Finalized" />}
                </span>
                <button className="back-btn" onClick={() => setWeekIndex((i) => i + 1)}><ChevronRight size={13} /></button>
              </div>
            </div>
            {schedNoteMsg && (
              <div className="staff-msg screen-only" style={{ display: "block", marginBottom: 10 }}>{schedNoteMsg}</div>
            )}
            {scheduleLocked && (
              <div className="template-note" style={{ marginBottom: 14, marginTop: -8 }}>
                🔒 {SECTION_LABEL[scheduleView]} is locked for the week of {shortDate(activeWeekStart)} — its cells won't respond to clicks. Other sections, and other weeks, are unaffected. Hit "Locked ✓" above to unlock.
              </div>
            )}

            <div className="subtabs">
              <button className={`subtab-btn ${scheduleView === "foh" ? "active" : ""}`} onClick={() => setScheduleView("foh")}>Front of House</button>
              <button className={`subtab-btn ${scheduleView === "bohkitchen" ? "active" : ""}`} onClick={() => setScheduleView("bohkitchen")}>BOH &amp; Kitchen</button>
              <button className={`subtab-btn ${scheduleView === "management" ? "active" : ""}`} onClick={() => setScheduleView("management")}>Management</button>
            </div>

            {scheduleView === "foh" && (
              <>
                <div className="cal-legend">
                  <span className="legend-item">This is the default that fills every week automatically.</span>
                  <span className="legend-item" style={{ marginLeft: "auto" }}>Pick a shift from each cell's dropdown — people with more than one role pick the role first. (FC = first cut, SC = second cut, CL = close)</span>
                </div>
                <img src={HAENYEO_ICON} alt="Haenyeo" className="template-icon" />

                <div className="fm-banner">
                  <span className="fm-banner-label">Manager on</span>
                  {WEEKDAY_LABELS.map((w, wi) => {
                    const weekday = WEEKDAY_ORDER[wi];
                    const names = (groupRosters.management || []).filter(
                      (_, idx) => !isOffCell(activePlaceholders.management?.[idx]?.[weekday])
                    );
                    return (
                      <div className={`fm-chip ${names.length === 0 ? "fm-chip-empty" : ""}`} key={w}>
                        <span className="fm-chip-day">{w}</span>
                        <span className="fm-chip-name">{names.length ? names.join(" + ") : "—"}</span>
                      </div>
                    );
                  })}
                </div>

                <table className={`week-table ${scheduleFrozen ? "schedule-locked" : ""}`}>
                  <thead>
                    <tr>
                      <th></th>
                      {WEEKDAY_LABELS.map((w, wi) => {
                        const day = activeWeek?.[wi];
                        return (
                          <th key={w} className={day?.isToday ? "today-col" : ""}>
                            {w} {day ? day.day : ""}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {fohRoleGroups.map((role) => (
                      <React.Fragment key={role}>
                        <tr>
                          <td className="role-header" colSpan={8}>{role}</td>
                        </tr>
                        {fohRoster.filter((p) => p.role === role).map((p) => {
                          const personRoles = staffRolesMap[p.name] || [p.role];
                          return (
                            <tr key={p.name}>
                              {schedNameCell(p.name)}
                              {WEEKDAY_LABELS.map((w, wi) => {
                                const weekday = WEEKDAY_ORDER[wi];
                                const code = (activePatterns[p.name] || ALL_OFF_WEEK)[weekday];
                                const selKey = `${p.name}|${weekday}`;
                                const cellRole = cellRoleSel[selKey] || roleFromCode(code) || personRoles[0];
                                const opts = roleOptions[cellRole] || [{ code: "OFF", label: "Off" }];
                                const value = opts.some((o) => o.code === code) ? code : "OFF";
                                const workedRole = value === "OFF" ? null : roleForCell(value, cellRole);
                                const timeOff = approvedOffFor(p.name, weekday);
                                return (
                                  <td key={w} className="shift-cell">
                                    {timeOff && <span className="cell-timeoff-flag" title="Approved time off" />}
                                    {dayOfFlag(p.name, weekday)}
                                    <div className="cell-stack">
                                      {personRoles.length > 1 && (
                                        <select
                                          className="cell-select role-select"
                                          value={cellRole}
                                          disabled={scheduleFrozen}
                                          onChange={(e) => setCellRole(p.name, weekday, e.target.value)}
                                        >
                                          {personRoles.map((r) => (
                                            <option key={r} value={r}>{ROLE_SHORT[r] || r}</option>
                                          ))}
                                        </select>
                                      )}
                                      <select
                                        className="cell-select shift-select"
                                        value={value}
                                        disabled={scheduleFrozen}
                                        style={value === "OFF" ? undefined : roleCellStyle(workedRole)}
                                        onChange={(e) => setCellShift(p.name, weekday, e.target.value)}
                                      >
                                        {opts.map((o) => (
                                          <option key={o.code} value={o.code}>{o.label}</option>
                                        ))}
                                      </select>
                                      {workedRole && !isPrimaryRole(p.name, workedRole) && (
                                        <div className="cross-role-label" style={{ color: ROLE_COLOR_MUTED[workedRole] }}>
                                          {crossRoleLabelText(workedRole)}
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
                <div className="template-note">Requests off, swaps, and coverage gaps approved on the Rail still override this automatically — this only sets the default. Exact cut times (1st/2nd cut) are a live call each night based on how busy it is, not something fixed here. Who can work which role is managed on the Staff tab.</div>
              </>
            )}

            {scheduleView === "bohkitchen" && (
              <>
                <div className="cal-legend">
                  <span className="legend-item">Kitchen &amp; Back of House</span>
                  <span className="legend-item" style={{ marginLeft: "auto" }}>
                    Pick a shift from each cell's dropdown. ("3p – Close" shows as "Yes" for Jenny &amp; Ajuma.) Freddy works both — scheduling one section blocks the other that day.
                  </span>
                </div>
                <table className={`week-table ${scheduleFrozen ? "schedule-locked" : ""}`}>
                  <thead>
                    <tr>
                      <th></th>
                      {WEEKDAY_LABELS.map((w, wi) => {
                        const day = activeWeek?.[wi];
                        return (
                          <th key={w} className={day?.isToday ? "today-col" : ""}>
                            {w} {day ? day.day : ""}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="role-header" colSpan={8}>Kitchen</td></tr>
                    {(groupRosters.kitchen || []).map((name, idx) => renderGroupRow("kitchen", name, idx))}
                    <tr><td className="section-divider" colSpan={8}></td></tr>
                    <tr><td className="role-header" colSpan={8}>Back of House</td></tr>
                    {(groupRosters.boh || []).map((name, idx) => renderGroupRow("boh", name, idx))}
                  </tbody>
                </table>
                <div className="template-note">Shift wording is configurable data (role_shift_options). Freddy appears in both sections; a blocked cell (—) means he's already scheduled in the other section that day.</div>
              </>
            )}

            {scheduleView === "management" && (
              <>
                <div className="cal-legend">
                  <span className="legend-item">Management</span>
                  <span className="legend-item" style={{ marginLeft: "auto" }}>Click a cell to toggle: Off ↔ FM (Floor Manager) · managers with the Expo role pick from a dropdown</span>
                </div>
                <table className={`week-table ${scheduleFrozen ? "schedule-locked" : ""}`}>
                  <thead>
                    <tr>
                      <th></th>
                      {WEEKDAY_LABELS.map((w, wi) => {
                        const day = activeWeek?.[wi];
                        return (
                          <th key={w} className={day?.isToday ? "today-col" : ""}>
                            {w} {day ? day.day : ""}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {(groupRosters.management || []).map((personName, idx) => {
                      const row = activePlaceholders.management?.[idx] || ALL_OFF_WEEK;
                      // Managers given the Expo role on the Staff tab get a
                      // dropdown (Off / FM / Expo shifts) instead of the toggle.
                      const canExpo = (staffRolesMap[personName] || []).includes("Expo");
                      const mgmtOpts = canExpo
                        ? [
                            ...(roleOptions.Management || [{ code: "OFF", label: "Off" }, { code: "FM", label: "FM" }]),
                            ...(roleOptions.Expo || []).filter((o) => o.code !== "OFF"),
                          ]
                        : null;
                      return (
                        <tr key={personName + idx}>
                          {schedNameCell(personName)}
                          {WEEKDAY_LABELS.map((w, wi) => {
                            const realWeekday = WEEKDAY_ORDER[wi];
                            const type = row[realWeekday] || "OFF";
                            const meta = SHIFT_META[type] || SHIFT_META.OFF;
                            const blockLabel = type === "OFF" ? crossSectionBlock(personName, "management", realWeekday) : null;
                            if (blockLabel) {
                              return (
                                <td key={w} className="shift-cell">
                                  <div className="cell-blocked" title={`Already scheduled in ${blockLabel}`}>—</div>
                                </td>
                              );
                            }
                            const mgmtTimeOff = approvedOffFor(personName, realWeekday);
                            if (mgmtOpts) {
                              const value = mgmtOpts.some((o) => o.code === type) ? type : "OFF";
                              const workedRole = value === "OFF" ? null : roleForCell(value, "Management");
                              return (
                                <td key={w} className="shift-cell">
                                  {mgmtTimeOff && <span className="cell-timeoff-flag" title="Approved time off" />}
                                  {dayOfFlag(personName, realWeekday)}
                                  <div className="cell-stack">
                                    <select
                                      className="cell-select shift-select"
                                      value={value}
                                      disabled={scheduleFrozen}
                                      style={value === "OFF" ? undefined : roleCellStyle(workedRole)}
                                      onChange={(e) => setPlaceholderShift("management", idx, realWeekday, e.target.value)}
                                    >
                                      {mgmtOpts.map((o) => (
                                        <option key={o.code} value={o.code}>{o.label}</option>
                                      ))}
                                    </select>
                                    {workedRole && workedRole !== "Management" && (
                                      <div className="cross-role-label" style={{ color: ROLE_COLOR_MUTED[workedRole] }}>
                                        {crossRoleLabelText(workedRole)}
                                      </div>
                                    )}
                                  </div>
                                </td>
                              );
                            }
                            // An Expo day left over after the Expo role was
                            // removed still reads as Expo (and toggles to Off).
                            const cellRole = type === "OFF" ? null : roleForCell(type, "Management");
                            return (
                              <td key={w} className="shift-cell">
                                {mgmtTimeOff && <span className="cell-timeoff-flag" title="Approved time off" />}
                                {dayOfFlag(personName, realWeekday)}
                                <button
                                  className="shift-chip chip-btn"
                                  style={type === "OFF" ? OFF_CHIP_DARK : roleCellStyle(cellRole)}
                                  onClick={() => toggleManagementCell(idx, realWeekday)}
                                >
                                  {SHIFT_META[type] ? meta.label : shiftLabelForType(type)}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}
          </div>

          {/* Standing notes pad. Absolutely positioned in the margin to the
              right of the card, outside scheduleCardRef — the card (and so the
              grid) is laid out exactly as if the pad weren't there. When the
              window is too narrow for it, the page scrolls sideways instead of
              the grid shrinking. */}
          <aside className={`sched-pad screen-only ${padCollapsed ? "collapsed" : ""}`} aria-label="Standing schedule notes">
            {padCollapsed ? (
              <button className="sched-pad-tab" onClick={() => setPadCollapsed(false)} title="Show standing notes">
                <StickyNote size={12} />
                <span className="sched-pad-count">{padNotes.length}</span>
              </button>
            ) : (
              <>
                <div className="sched-pad-head">
                  <span><StickyNote size={11} /> Notes</span>
                  <button className="sched-pad-collapse" onClick={() => setPadCollapsed(true)} title="Collapse" aria-label="Collapse notes"><ChevronRight size={12} /></button>
                </div>
                {padNotesAvailable() ? (
                  <input
                    className="sched-pad-input"
                    value={padDraft}
                    placeholder="Add a note…"
                    onChange={(e) => setPadDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addPadNote(); }}
                  />
                ) : (
                  <div className="sched-pad-msg">Run migration 0018 to use this pad.</div>
                )}
                {padMsg && <div className="sched-pad-msg">{padMsg}</div>}
                <div className="sched-pad-list">
                  {padNotes.map((n) => (
                    padEdit?.id === n.id ? (
                      <textarea
                        key={n.id}
                        className="sched-pad-chip sched-pad-edit"
                        autoFocus
                        rows={2}
                        value={padEdit.text}
                        onChange={(e) => setPadEdit({ id: n.id, text: e.target.value })}
                        onBlur={commitPadEdit}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); }
                          if (e.key === "Escape") { padCancelRef.current = true; setPadEdit(null); }
                        }}
                      />
                    ) : (
                      <div key={n.id} className="sched-pad-chip" onClick={() => { padCancelRef.current = false; setPadEdit({ id: n.id, text: n.note }); }} title="Click to edit">
                        <span className="sched-pad-text">{n.note}</span>
                        <button
                          className="sched-pad-x"
                          onClick={(e) => { e.stopPropagation(); removePadNote(n.id); }}
                          title="Delete note"
                          aria-label="Delete note"
                        >×</button>
                      </div>
                    )
                  ))}
                </div>
              </>
            )}
          </aside>
        </div>
      )}

      {tab === "tips" && (
        <div className="cal-wrap tip-wrap" key="tips">
          <div className="cal-card" ref={tipCardRef}>
            {tipFinalized && (
              <div className="tip-finalized-banner screen-only">
                <Lock size={14} /> FINALIZED{tipFinalizedAt ? ` — ${new Date(tipFinalizedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}
                <span className="tip-finalized-sub">Inputs are locked. Unlock to edit and re-finalize.</span>
              </div>
            )}
            {/* A date can be locked without being finalized, so this banner is
                its own thing rather than a branch of the finalized one. */}
            {tipLocked && (
              <div className="tip-locked-banner screen-only">
                <Lock size={14} /> LOCKED — {shortDate(tipDateIso).toUpperCase()}
                {tipLockedAt ? <span className="tip-finalized-sub">Locked {new Date(tipLockedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span> : null}
                <span className="tip-finalized-sub">This date's inputs are read-only. Press "Locked ✓" below to unlock.</span>
              </div>
            )}
            <div className={`tip-page-split ${tipFinalized || tipLocked ? "tip-locked" : ""}`}>
              <div className="tip-left-col">
                <div className="tip-logo-space">
                  <img src={HAENYEO_LOGO} alt="Haenyeo" className="tip-logo-img" />
                </div>
                {/* The date the sheet is FOR (tipDateIso), never today or the
                    print date. Paper and PDF only — the screen has the picker. */}
                <div className="tip-sheet-date print-only">{tipSheetDateLabel}</div>
                <div className="cash-recon">
                  <div className="recon-title">Cash</div>

                  <div className="denom-table">
                    <div className="denom-header"><span>$ amt</span><span>Opening</span><span>Closing</span></div>
                    {DENOMS.map((d) => (
                      <div className="denom-row" key={d}>
                        <span className="denom-label">{denomLabel(d)}</span>
                        <input type="number" value={openingCounts[d] || ""} onChange={(e) => setCount("open", d, e.target.value)} placeholder="0.00" />
                        <input type="number" value={closingCounts[d] || ""} onChange={(e) => setCount("close", d, e.target.value)} placeholder="0.00" />
                      </div>
                    ))}
                    <div className="denom-row totals">
                      <span className="denom-label">Total</span>
                      <span>${money(openingBankTotal)}</span>
                      <span>${money(closingBankTotal)}</span>
                    </div>
                  </div>

                  <div className="recon-row">
                    <label>Closing Sum</label>
                    <input type="number" value={closingSum} onChange={(e) => setClosingSum(e.target.value)} placeholder="0.00" />
                  </div>

                  <div className="payouts-block">
                    <div className="payouts-header">
                      <span>Payouts</span>
                      <button className="add-payout-btn" onClick={addPayout}>+ Add</button>
                    </div>
                    {payoutItems.length === 0 && <div className="payout-empty">No payouts logged.</div>}
                    {payoutItems.map((it) => (
                      <div className="payout-row" key={it.id}>
                        <input type="text" placeholder="What was it" value={it.desc} onChange={(e) => updatePayout(it.id, "desc", e.target.value)} />
                        <input type="number" placeholder="0.00" value={it.amount} onChange={(e) => updatePayout(it.id, "amount", e.target.value)} />
                        <button className="remove-payout-btn" onClick={() => removePayout(it.id)}><X size={11} /></button>
                      </div>
                    ))}
                    <div className="recon-row computed">
                      <label>Payouts Total</label>
                      <span>${money(payoutsTotal)}</span>
                    </div>
                  </div>

                  <div className="recon-row computed">
                    <label>Total Cash Sum & Payouts</label>
                    <span>${money(totalCashSumPayouts)}</span>
                  </div>
                  <div className="recon-row">
                    <label>Cash Sales</label>
                    <input type="number" value={cashSales} onChange={(e) => setCashSales(e.target.value)} placeholder="0.00" />
                  </div>
                  <div className="recon-row computed">
                    <label>Minus Cash Sales</label>
                    <span>${money(minusCashSales)}</span>
                  </div>
                  <div className="recon-row computed">
                    <label>Minus Opening Bank</label>
                    <span>${money(cashTipsEarned)}</span>
                  </div>
                  <div className="recon-row final">
                    <label>Cash Tips Earned</label>
                    <span>${money(cashTipsEarned)}</span>
                  </div>
                  <div className="recon-note">Each row takes the dollar amount, not a bill count — 2 twenties = 40. Should match cash tip sheet.</div>
                </div>
              </div>

              <div className="tip-right-col">
                <div className="week-header" style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {/* Back to the Calendar date page this sheet was opened from
                        (brief item 4). Only while we're still on that date —
                        paging to another day drops the link. */}
                    {tipFromDayIso === tipDateIso && (
                      <button
                        className="day-page-icon screen-only"
                        title={`Back to ${shortDate(tipFromDayIso)}'s notes`}
                        onClick={() => { setCalDayIso(tipFromDayIso); setCalView("day"); setTab("calendar"); }}
                      ><StickyNote size={15} /></button>
                    )}
                    {/* Today jump, matching the Set Schedule week nav (item 9) */}
                    <button
                      className="today-btn"
                      disabled={tipDateIso === TODAY_ISO}
                      title={tipDateIso === TODAY_ISO ? "Already on today" : "Jump to today"}
                      onClick={() => { setTipDateIso(TODAY_ISO); }}
                    >
                      Today
                    </button>
                    <button className="back-btn" onClick={() => shiftTipDate(-1)}><ChevronLeft size={14} /> Prev day</button>
                  </div>
                  <div className="week-range" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {tipDateInfo.dateObj.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
                    {tipDateIso === TODAY_ISO && <span className="today-pill screen-only">Today</span>}
                  </div>
                  <button className="back-btn" onClick={() => shiftTipDate(1)}>Next day <ChevronRight size={14} /></button>
                </div>

                <div className="tip-top-row">
                  <div className="tip-inputs" style={{ marginBottom: 0 }}>
                    <div className="tip-field">
                      <label>Floor Cash Tips</label>
                      <input type="number" value={floorCash} onChange={(e) => { setFloorCash(e.target.value); }} placeholder="0.00" />
                    </div>
                    <div className="tip-field">
                      <label>Floor CC Tips</label>
                      <input type="number" value={floorCredit} onChange={(e) => { setFloorCredit(e.target.value); }} placeholder="0.00" />
                    </div>
                    <div className="tip-field">
                      <label>Bar Cash Tips</label>
                      <input type="number" value={barCash} onChange={(e) => { setBarCash(e.target.value); }} placeholder="0.00" />
                    </div>
                    <div className="tip-field">
                      <label>Bar CC Tips</label>
                      <input type="number" value={barCredit} onChange={(e) => { setBarCredit(e.target.value); }} placeholder="0.00" />
                    </div>
                    <div className="tip-field">
                      <label>Covers</label>
                      <input type="number" value={covers} onChange={(e) => setCovers(e.target.value)} placeholder="0" style={{ width: 70 }} />
                    </div>
                  </div>

                  <div className="point-reference">
                    {POINT_REFERENCE.map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                  </div>
                </div>

                {customMode && (
                  <div className="footer-note" style={{ marginTop: -8, marginBottom: 14 }}>
                    Custom mode is on — names and points below are editable for short-staffed nights. Turn it off to go back to auto-filling from the Set Schedule.
                  </div>
                )}

                <div className="tip-inputs" style={{ marginBottom: 6, marginTop: 10 }}>
                  <div className="tip-field"><label>Floor Pool</label><div className="tip-stat">${money(floorPool)}</div></div>
                  <div className="tip-field"><label>Total Points</label><div className="tip-stat">{totalPoints.toFixed(2)}</div></div>
                  <div className="tip-field"><label>$ / Point</label><div className="tip-stat"><b>${money(perPoint)}</b></div></div>
                  <div className="tip-field">
                    <label>
                      {barTipOutOn ? "Bar Tip-Out (10%)" : <>Bar Tip-Out <span className="tip-out-na">— N/A</span></>}
                      {/* Control is screen-only; the N/A outcome prints. */}
                      <button
                        className={`tip-out-toggle screen-only ${barTipOutOn ? "on" : ""}`}
                        disabled={tipFinalized || tipLocked}
                        onClick={() => setBarTipOutOn((v) => !v)}
                        title={tipFinalized || tipLocked ? "This date is locked — unlock it to change the bar tip-out"
                          : barTipOutOn ? "Turn off the bar tip-out for this date (bar keeps its full tips)"
                          : "Turn the 10% bar tip-out back on for this date"}
                        aria-pressed={barTipOutOn}
                      >{barTipOutOn ? "On" : "Off"}</button>
                    </label>
                    {/* An em dash, not $0.00 — "doesn't apply", not "charged zero". */}
                    <div className="tip-stat">{barTipOutOn ? `$${money(barTipOutTotal)}` : "—"}</div>
                  </div>
                  <div className="tip-field"><label>Each Recipient Gets</label><div className="tip-stat"><b>${money(barShareEach)}</b></div></div>
                </div>

                <div className="hero-stat">
                  <div className="hero-item">
                    <div className="hero-label">Server $/hr</div>
                    <div className="hero-value">${money(serverRate)}</div>
                  </div>
                  <div className="hero-item">
                    <div className="hero-label">Bar $/hr</div>
                    <div className="hero-value">${money(barRate)}</div>
                  </div>
                  <div className="hero-item">
                    <div className="hero-label">Busser/Runner $/hr</div>
                    <div className="hero-value">${money(bussersRate)}</div>
                  </div>
                </div>

                <div style={{ overflowX: "auto" }}>
                  <table className="week-table">
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left" }}>Position</th>
                        <th style={{ textAlign: "left" }}>Name</th>
                        <th>Time In</th>
                        <th>Time Out</th>
                        <th>Hrs</th>
                        <th>Pts</th>
                        <th>Amt by Pt</th>
                        <th>Bar Share</th>
                        <th>Final Tip</th>
                      </tr>
                    </thead>
                    <tbody>
                      {finalSlots.map((p) => {
                        const t = getTimes(p.id);
                        return (
                          <tr key={p.id}>
                            <td className="tip-position">{p.label}</td>
                            <td className="shift-cell" style={{ textAlign: "left" }}>
                              {customMode ? (
                                <input
                                  className="tip-name-input"
                                  type="text"
                                  value={p.name}
                                  placeholder="—"
                                  onChange={(e) => setSlotName(p.id, e.target.value)}
                                />
                              ) : (
                                <span className="tip-name-display">
                                  {p.name || <span className="slot-empty">—</span>}
                                  {p.name && tipDayOfAllowed && (
                                    <button
                                      className="slot-remove-btn screen-only"
                                      title={`Remove ${p.name} from ${shortDate(tipDateIso)}`}
                                      aria-label={`Remove ${p.name} from ${shortDate(tipDateIso)}`}
                                      onClick={() => openDayOfRemove(p.name)}
                                    ><X size={11} /></button>
                                  )}
                                </span>
                              )}
                            </td>
                            <td className="shift-cell"><input type="text" className="tip-time-input" placeholder="4:00 PM" value={t.in} onChange={(e) => setSlotTime(p.id, "in", e.target.value)} disabled={!p.name} /></td>
                            <td className="shift-cell"><input type="text" className="tip-time-input" placeholder="9:00 PM" value={t.out} onChange={(e) => setSlotTime(p.id, "out", e.target.value)} disabled={!p.name} /></td>
                            <td className="shift-cell">{p.name ? p.hours.toFixed(2) : ""}</td>
                            <td className="shift-cell">
                              {!p.name ? (
                                <span className="slot-empty">—</span>
                              ) : customMode ? (
                                <input className="tip-table-input" type="number" step="0.05" value={p.pts} onChange={(e) => setSlotPts(p.id, e.target.value)} />
                              ) : (
                                p.pts.toFixed(2)
                              )}
                            </td>
                            <td className="shift-cell">{p.name ? `$${money(p.raw)}` : ""}</td>
                            <td className="shift-cell">{p.barShare ? `$${money(p.barShare)}` : ""}</td>
                            <td className="shift-cell"><b>{p.final != null ? `$${money(p.final)}` : ""}</b></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="floor-check-row">
                  <div className={`check-box ${floorCheckMatches ? "match" : "mismatch"}`}>
                    <div className="check-label">Floor Check (paid out of floor pool)</div>
                    <div className="check-value">${money(floorCheckTotal)}</div>
                    <div className="check-sub">{floorCheckMatches ? "✓ Matches floor cash + CC" : `Off by $${money(Math.abs(floorCheckTotal - floorPool))} vs floor cash + CC`}</div>
                  </div>
                  {/* Sign-off rules, paper and PDF only. Fills the gap between
                      the floor check and the table's right edge. */}
                  <div className="tip-signoff print-only">
                    <div className="tip-sign-field tip-sign-main"><div className="tip-sign-rule" /><div className="tip-sign-label">Manager Signature</div></div>
                    <div className="tip-sign-field tip-sign-date"><div className="tip-sign-rule" /><div className="tip-sign-label">Date</div></div>
                  </div>
                  <div className="tip-staff-actions">
                    {/* Day-of add: writes a dated override like the × above, so
                        the sheet re-resolves live rather than freezing names. */}
                    <button
                      className="add-staff-btn screen-only"
                      disabled={!tipDayOfAllowed}
                      onClick={openDayOfAdd}
                      title={customMode ? "Turn off Custom Schedule to add staff for this date"
                        : !tipDayOfAllowed ? "This date is locked — unlock it to add staff"
                        : `Add someone to ${shortDate(tipDateIso)}`}
                    >+ Add staff</button>
                    <button className={`custom-toggle ${customMode ? "on" : ""}`} onClick={toggleCustomMode}>
                      {customMode ? "✓ Custom Schedule" : "Custom Schedule"}
                    </button>
                  </div>
                </div>

                {/* Never drop someone from the sheet silently — payroll needs to
                    know why a name it expected isn't there. */}
                {slotsExcludedOff.length > 0 && (() => {
                  const names = [...new Set(slotsExcludedOff)];
                  const one = names.length === 1;
                  return (
                    <div className="tip-off-note screen-only">
                      <AlertTriangle size={12} />
                      {names.join(", ")} {one ? "is" : "are"} scheduled off on {shortDate(tipDateIso)}, so {one ? "that slot was" : "those slots were"} left empty.
                      Give them a shift on the Set Schedule for this date to include them.
                    </div>
                  );
                })()}

                <div className="footer-note">
                  Distributed: ${money(totalDistributed)} of ${money(floorPool + barPool)} total pool (floor + bar). Host only earns their point if covers exceed 80 for the day. Expo and Host are paid flat — their hours aren't part of any pooled rate. Type times like "4:00 PM" or "9:30" — if you leave off AM/PM, it assumes PM. Clock times round to the nearest 15 minutes (≤7 min rounds down, ≥8 rounds up).
                </div>

                {/* Save · Lock · Send Tip Sheet · Save as PDF · Print (brief
                    item 1). Finalize is gone: sending IS finalizing now, so the
                    two buttons that used to mean almost the same thing became
                    one. The subject preview went with it — the subject is
                    editable on the send screen. */}
                <div className="tip-actions screen-only">
                  <SaveStatus state={tipSaveState} />
                  <button
                    className="print-btn save-btn"
                    disabled={tipSaveState === "saving"}
                    onClick={saveTipSheetNow}
                    title="Write this sheet to Supabase now (it also autosaves 2s after you stop typing)"
                  >
                    {tipSaveState === "saving" ? "Saving…" : "Save"}
                  </button>
                  {/* Freeze or reopen this one date without emailing anyone.
                      Unlocking also clears finalized, so a reopened sheet is
                      genuinely editable again. */}
                  <button
                    className={`print-btn ${tipLocked ? "lock-active" : ""}`}
                    disabled={tipLockBusy}
                    onClick={toggleTipLock}
                    title={tipLocked ? `Unlock ${shortDate(tipDateIso)} for edits` : `Lock ${shortDate(tipDateIso)} — makes this date's inputs read-only`}
                  >
                    {tipLocked ? <Unlock size={13} /> : <Lock size={13} />}{" "}
                    {tipLocked ? `Unlock — ${shortDate(tipDateIso)}` : `Lock ${shortDate(tipDateIso)}`}
                  </button>
                  {/* Opens the confirmation screen — nothing is emailed until
                      Confirm & Send there, which also finalizes and locks. */}
                  <button
                    className={`publish-btn ${tipSent ? "publish-btn-sent" : ""}`}
                    onClick={openTipSendModal}
                    title={tipSent ? "Already sent — you'll be asked to confirm before it goes out again" : "Review recipients and subject, then send"}
                  >
                    {tipSent ? (
                      <><Check size={12} /> Sent ✓{tipSentAtLabel ? ` ${tipSentAtLabel}` : ""}</>
                    ) : "Send Tip Sheet"}
                  </button>
                  <button className="print-btn" disabled={pdfBusy === "tips"} onClick={exportTipSheetPdf}>
                    <FileDown size={13} /> {pdfBusy === "tips" ? "Saving…" : "Save as PDF"}
                  </button>
                  <button className="print-btn" onClick={() => window.print()}><Printer size={13} /> Print</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "staff" && (
        <div className="cal-wrap" key="staff">
          <div className="cal-card">
            <div className="week-header" style={{ marginBottom: 14 }}>
              <div className="week-range"><Users size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />Staff &amp; Roles</div>
              {staffMsg && <span className="staff-msg">{staffMsg}</span>}
              {schedNoteMsg && <span className="staff-msg">{schedNoteMsg}</span>}
            </div>

            <div className="qr-row">
              <span className="qr-row-label">QR codes:</span>
              {QR_CODES.map((q) => (
                <button key={q.key} className="qr-btn" onClick={() => setQrModal(q.key)}>{q.label}</button>
              ))}
              <button className="qr-btn qr-print-btn" disabled={qrPrinting} onClick={handlePrintQR}>
                <Printer size={12} /> {qrPrinting ? "Preparing…" : "Print QR Codes"}
              </button>
              <button
                className="qr-btn"
                onClick={checkGmailNow}
                disabled={gmailChecking || !session?.access_token}
                title="Check for new registration emails from the inbox"
              >
                {gmailChecking ? "Checking…" : "Check now"}
              </button>
            </div>

            {infoUpdates.length > 0 && (
              <div className="info-updates">
                <div className="info-updates-title">Pending info updates ({infoUpdates.length})</div>
                {infoUpdates.map((u) => (
                  <div className="info-update-row" key={u.id}>
                    <div className="info-update-body">
                      <b>{staffNameById[u.staff_id] || "Unknown"}</b> has requested an info update
                      {u.new_email && <span className="info-update-field"> · email → {u.new_email}</span>}
                      {u.new_phone && <span className="info-update-field"> · phone → {u.new_phone}</span>}
                    </div>
                    <div className="nr-item-actions">
                      <button className="nr-btn nr-btn-approve" onClick={() => handleApproveInfo(u)}><Check size={13} /> Approve</button>
                      <button className="nr-btn nr-btn-deny" onClick={() => handleDenyInfo(u)}><X size={13} /> Deny</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!rolesTableReady && (
              <div className="template-note" style={{ marginTop: -6, marginBottom: 14 }}>
                ⚠ The role tables aren't in the database yet — run supabase/migrations/0002_roles_and_shift_options.sql
                in the Supabase SQL editor to enable saving role assignments. Until then this screen shows the built-in defaults.
              </div>
            )}

            <div className="staff-add">
              <div className="staff-add-title">Add a staff member</div>
              <div className="staff-add-row">
                <input
                  className="staff-name-input"
                  type="text"
                  placeholder="Name"
                  value={newStaff.name}
                  onChange={(e) => setNewStaff((n) => ({ ...n, name: e.target.value }))}
                />
                <select
                  className="cell-select staff-section-select"
                  value={newStaff.section}
                  onChange={(e) => setNewStaff((n) => ({ ...n, section: e.target.value, roles: [], primary: "" }))}
                >
                  {SECTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <div className="staff-role-checks">
                  {SECTION_ROLES[newStaff.section].map((r) => (
                    <label key={r} className="staff-role-check">
                      <input
                        type="checkbox"
                        checked={newStaff.roles.includes(r)}
                        onChange={(e) => setNewStaff((n) => {
                          const roles = e.target.checked ? [...n.roles, r] : n.roles.filter((x) => x !== r);
                          return { ...n, roles, primary: roles.includes(n.primary) ? n.primary : roles[0] || "" };
                        })}
                      />
                      {r}
                    </label>
                  ))}
                </div>
                {newStaff.roles.length > 1 && (
                  <select
                    className="cell-select staff-primary-select"
                    value={newStaff.primary || newStaff.roles[0]}
                    onChange={(e) => setNewStaff((n) => ({ ...n, primary: e.target.value }))}
                    title="Primary / default role"
                  >
                    {newStaff.roles.map((r) => <option key={r} value={r}>Primary: {r}</option>)}
                  </select>
                )}
                <button className="publish-btn" onClick={handleAddStaff}>Add</button>
              </div>
            </div>

            {/* Two-step delete (brief item 6): the per-row Delete buttons stay
                hidden until this is armed, so a stray click can't start a
                deletion. The confirm dialog still runs after that. */}
            <div className="staff-delete-arm">
              <button
                className={`qr-btn ${deleteMode ? "staff-delete-arm-on" : ""}`}
                onClick={() => setDeleteMode((v) => !v)}
                title={deleteMode ? "Hide the delete buttons" : "Show a Delete button on each staff row"}
              >
                {deleteMode ? "Cancel" : "Enable Delete"}
              </button>
              {deleteMode && (
                <span className="staff-delete-arm-note">Delete buttons are showing — you'll still be asked to confirm.</span>
              )}
            </div>

            {SECTIONS.map((section) => {
              const members = staffList.filter((s) => (s.section || "FOH") === section);
              if (members.length === 0) return null;
              return (
                <React.Fragment key={section}>
                  <div className="role-header" style={{ display: "block", padding: "16px 2px 4px" }}>{section}</div>
                  {members.map((s) => {
                    const d = staffDraftFor(s);
                    const dirty =
                      d.name !== s.name ||
                      d.active !== (s.active !== false) ||
                      JSON.stringify(d.roles) !== JSON.stringify(staffRolesMap[s.name] || [s.role]) ||
                      d.primary !== (staffRolesMap[s.name] || [s.role])[0];
                    const open = staffProfile === s.id;
                    return (
                      <React.Fragment key={s.id || s.name}>
                      <div className={`staff-row ${d.active ? "" : "staff-row-inactive"}`}>
                        <button
                          className={`staff-reg-dot ${s.registered ? "reg-yes" : "reg-no"}`}
                          title={s.registered ? "Registered — view contact info" : "Not yet registered — view contact info"}
                          onClick={() => setStaffProfile(open ? null : s.id)}
                        />
                        <input
                          className="staff-name-input"
                          type="text"
                          value={d.name}
                          onChange={(e) => setStaffDraft(s, { name: e.target.value })}
                        />
                        {/* Saves on its own (blur / Enter), apart from the row's
                            Save — same writer as the ⚑ editor on Set Schedule. */}
                        <input
                          className="staff-note-input"
                          type="text"
                          maxLength={SCHED_NOTE_MAX}
                          placeholder="Scheduling note"
                          title="Scheduling note — shows as ⚑ beside their name on Set Schedule"
                          value={staffNoteDrafts[s.name] ?? (s.scheduling_note || "")}
                          onChange={(e) => setStaffNoteDrafts((d) => ({ ...d, [s.name]: e.target.value }))}
                          onBlur={(e) => {
                            const v = e.target.value;
                            setStaffNoteDrafts((d) => { const n = { ...d }; delete n[s.name]; return n; });
                            saveSchedulingNote(s.name, v);
                          }}
                          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                        />
                        <div className="staff-role-checks">
                          {SECTION_ROLES[section].map((r) => (
                            <label key={r} className="staff-role-check">
                              <input
                                type="checkbox"
                                checked={d.roles.includes(r)}
                                onChange={(e) =>
                                  setStaffDraft(s, { roles: e.target.checked ? [...d.roles, r] : d.roles.filter((x) => x !== r) })
                                }
                              />
                              {r}
                            </label>
                          ))}
                        </div>
                        {d.roles.length > 1 && (
                          <select
                            className="cell-select staff-primary-select"
                            value={d.primary}
                            onChange={(e) => setStaffDraft(s, { primary: e.target.value })}
                            title="Primary / default role"
                          >
                            {d.roles.map((r) => <option key={r} value={r}>Primary: {r}</option>)}
                          </select>
                        )}
                        <label className="staff-role-check staff-active-check">
                          <input type="checkbox" checked={d.active} onChange={(e) => setStaffDraft(s, { active: e.target.checked })} />
                          Active
                        </label>
                        {dirty && (
                          <button className="publish-btn staff-save-btn" onClick={() => handleSaveStaff(s)}>Save</button>
                        )}
                        {deleteMode && (
                          <button className="staff-delete-btn" title={`Delete ${s.name}`} onClick={() => setDeleteTarget(s)}>Delete</button>
                        )}
                      </div>
                      {open && (
                        <div className="staff-profile">
                          <div className="staff-profile-row">
                            <span className="staff-profile-key">Email</span>
                            <div className="staff-profile-value-container">
                              {s.personal_email
                                ? <button className="staff-profile-val" title="Tap to copy" onClick={() => copyText(s.personal_email)}>{s.personal_email}</button>
                                : <span className="staff-profile-empty">— none on file —</span>}
                            </div>
                          </div>
                          <div className="staff-profile-row">
                            <span className="staff-profile-key">Phone</span>
                            <div className="staff-profile-value-container">
                              {s.phone
                                ? <button className="staff-profile-val" title="Tap to copy" onClick={() => copyText(s.phone)}>{s.phone}</button>
                                : <span className="staff-profile-empty">— none on file —</span>}
                            </div>
                          </div>
                          <div className="staff-profile-row">
                            <span className="staff-profile-key">Status</span>
                            <span className={`staff-profile-status ${s.registered ? "reg-yes" : "reg-no"}`}>
                              {s.registered ? "Registered" : "Not yet registered"}
                            </span>
                          </div>
                          <div className="staff-profile-row">
                            <span className="staff-profile-key"></span>
                            <button className="publish-btn" onClick={() => {
                              setEditingStaffId(s.id);
                              setEditingStaffEmail(s.personal_email || "");
                              setEditingStaffPhone(s.phone || "");
                            }}>Edit Contact Info</button>
                          </div>
                        </div>
                      )}
                      </React.Fragment>
                    );
                  })}
                </React.Fragment>
              );
            })}
            <div className="template-note">
              Role assignments here drive each person's role picker on the Set Schedule. Deactivating someone hides them
              from the Front of House schedule; BOH/Kitchen/Management rows stay put so the grid stays aligned.
            </div>

            {/* ---- Manage Shifts (brief item 3) ---- */}
            <div className="role-header" style={{ display: "block", padding: "22px 2px 4px" }}>Manage Shifts</div>
            <div className="template-note" style={{ marginTop: 0, marginBottom: 10 }}>
              These are the options each role sees in the Set Schedule dropdowns. Removing one stops it being picked
              going forward — shifts already on the schedule keep it.
            </div>
            {shiftMsg && <div className="staff-msg" style={{ display: "block", marginBottom: 10 }}>{shiftMsg}</div>}
            <div className="shift-mgmt">
              {SHIFT_MANAGED_ROLES.map((role) => {
                const list = roleOptions[role] || [];
                return (
                  <div className="shift-mgmt-row" key={role}>
                    <div className="shift-mgmt-role" style={{ color: ROLE_COLOR[role] || undefined }}>{role}</div>
                    <div className="shift-mgmt-opts">
                      {list.filter((o) => o.code !== "OFF").map((o) => (
                        <span className={`shift-mgmt-chip ${o.isOff ? "is-off" : ""}`} key={o.code} title={o.code}>
                          {o.label}
                          <label className="shift-off-check" title="Counts as off — excluded from Tip Sheet and Today at a Glance">
                            <input
                              type="checkbox"
                              checked={!!o.isOff}
                              onChange={(e) => toggleShiftOptionOff(role, o.code, o.label, e.target.checked)}
                            />
                            Counts as off
                          </label>
                          {!o.isOff && looksLikeOffLabel(o.label) && (
                            <span className="shift-off-hint" title="This name reads like an off state. Tick Counts as off if staff on it are not working.">off? tick it</span>
                          )}
                          <button
                            className="shift-mgmt-x"
                            title={`Remove ${o.label} from ${role}`}
                            onClick={() => handleRemoveShiftOption(role, o.code, o.label)}
                          ><X size={11} /></button>
                        </span>
                      ))}
                      {shiftAddRole === role ? (
                        <input
                          className="notes-input shift-mgmt-input"
                          autoFocus
                          placeholder="Shift label, e.g. 7pm-CL"
                          value={shiftAddLabel}
                          onChange={(e) => setShiftAddLabel(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleAddShiftOption(role);
                            if (e.key === "Escape") { setShiftAddRole(null); setShiftAddLabel(""); }
                          }}
                          onBlur={() => { setShiftAddRole(null); setShiftAddLabel(""); }}
                        />
                      ) : null}
                      {shiftAddRole === role && looksLikeOffLabel(shiftAddLabel) ? (
                        <span className="shift-off-hint">Looks like an off state — tick "Counts as off" on it once it's added.</span>
                      ) : null}
                      {shiftAddRole === role ? null : (
                        <button
                          className="shift-mgmt-add"
                          onClick={() => { setShiftAddRole(role); setShiftAddLabel(""); setShiftMsg(""); }}
                        >+ Add Shift</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="template-note" style={{ marginTop: 8 }}>
              Counts as off — excluded from Tip Sheet and Today at a Glance. The option still shows on the schedule grid.
            </div>
          </div>

          {qrModal && (() => {
            const spec = QR_CODES.find((q) => q.key === qrModal);
            return (
              <div className="day-popup-backdrop" onClick={() => setQrModal(null)}>
                <div className="qr-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="day-popup-head">
                    <div className="day-popup-date">{spec?.label}</div>
                    <button className="day-popup-close" onClick={() => setQrModal(null)}><X size={15} /></button>
                  </div>
                  {qrDataUrl
                    ? <img className="qr-img" src={qrDataUrl} alt={`QR code for ${spec?.label}`} />
                    : <div className="qr-loading">Generating…</div>}
                  <div className="qr-caption">Scan to open a pre-filled email to {SCHEDULE_INBOX}.</div>
                  <div className="qr-subject">{spec?.subject}</div>
                  {REGISTER_CODE === "CODEWORD-NOT-SET" && (spec?.key === "register" || spec?.key === "update") && (
                    <div className="qr-warn">⚠ VITE_STAFF_REGISTER_CODE isn't set — this QR has a placeholder code. Set it in Vercel and redeploy.</div>
                  )}
                </div>
              </div>
            );
          })()}

          {deleteTarget && (
            <div className="day-popup-backdrop" onClick={() => !deleting && setDeleteTarget(null)}>
              <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
                <div className="delete-modal-title">Delete {deleteTarget.name}?</div>
                <div className="delete-modal-body">
                  Are you sure you want to delete <b>{deleteTarget.name}</b>? This cannot be undone.
                </div>
                <div className="delete-modal-warn">
                  This person is currently on the schedule — deleting them will remove all their shifts.
                </div>
                <div className="delete-modal-actions">
                  <button className="nr-btn nr-btn-deny" disabled={deleting} onClick={() => setDeleteTarget(null)}>Cancel</button>
                  <button className="delete-confirm-btn" disabled={deleting} onClick={handleConfirmDelete}>
                    {deleting ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "invoices" && (
        <div className="cal-wrap" key="invoices">
          <div className="cal-card" style={{ textAlign: "center", padding: "56px 24px 64px" }}>
            <img src={HAENYEO_LOGO} alt="Haenyeo" style={{ maxWidth: 220, maxHeight: 84, objectFit: "contain" }} />
            <h2 style={{ fontFamily: "'Space Mono', monospace", fontSize: 22, letterSpacing: 1, color: "#2B2A25", margin: "20px 0 8px" }}>Invoices</h2>
            <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 13.5, color: "#85897F" }}>Invoice tracking coming soon.</div>
          </div>
        </div>
      )}

      {tab === "menu" && (
        <div className="cal-wrap" key="menu">
          <div className="cal-card" style={{ textAlign: "center", padding: "56px 24px 64px" }}>
            <img src={HAENYEO_LOGO} alt="Haenyeo" style={{ maxWidth: 220, maxHeight: 84, objectFit: "contain" }} />
            <h2 style={{ fontFamily: "'Space Mono', monospace", fontSize: 22, letterSpacing: 1, color: "#2B2A25", margin: "20px 0 8px" }}>Menu</h2>
            <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 13.5, color: "#85897F" }}>Coming soon.</div>
          </div>
        </div>
      )}

      {editingStaffId && (() => {
        const staff = staffList.find((s) => s.id === editingStaffId);
        return staff ? (
          <div className="day-popup-backdrop" onClick={() => setEditingStaffId(null)}>
            <div className="staff-edit-modal" onClick={(e) => e.stopPropagation()}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: "#8c8574", marginBottom: 4 }}>Staff Member</div>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 14, fontWeight: 700, color: "#2B2A25" }}>{staff.name}</div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontFamily: "'Space Mono', monospace", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "#8c8574", marginBottom: 6 }}>Email</label>
                <input
                  type="email"
                  value={editingStaffEmail}
                  onChange={(e) => setEditingStaffEmail(e.target.value)}
                  placeholder="Email address"
                  style={{ width: "100%", fontFamily: "'Manrope', sans-serif", fontSize: 13, padding: "8px 11px", border: "1px solid rgba(43,42,37,0.15)", borderRadius: 4, background: "#FFFDF7", color: "#2B2A25", boxSizing: "border-box" }}
                  autoFocus
                />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontFamily: "'Space Mono', monospace", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "#8c8574", marginBottom: 6 }}>Phone</label>
                <input
                  type="tel"
                  value={editingStaffPhone}
                  onChange={(e) => setEditingStaffPhone(e.target.value)}
                  placeholder="Phone number"
                  style={{ width: "100%", fontFamily: "'Manrope', sans-serif", fontSize: 13, padding: "8px 11px", border: "1px solid rgba(43,42,37,0.15)", borderRadius: 4, background: "#FFFDF7", color: "#2B2A25", boxSizing: "border-box" }}
                />
              </div>

              <div style={{ fontSize: 11, color: "#8c8574", fontStyle: "italic", marginBottom: 16 }}>Contact info will be saved and staff will be marked as Registered.</div>

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="nr-btn nr-btn-deny" onClick={() => setEditingStaffId(null)}>Cancel</button>
                <button className="publish-btn" onClick={handleSaveStaffProfile}>Save</button>
              </div>
            </div>
          </div>
        ) : null;
      })()}

      {/* Rail delete / archive confirmation. Delete is permanent, so its
          confirm button is the red one; archive's is neutral. */}
      {railConfirm && (() => {
        const { mode, item } = railConfirm;
        const isDelete = mode === "delete";
        const close = () => { if (!railActionBusy) setRailConfirm(null); };
        return (
          <div className="day-popup-backdrop" onClick={close}>
            <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
              <div className="delete-modal-title">{isDelete ? "Delete request" : "Archive request"}</div>
              <div className="delete-modal-body">
                {isDelete
                  ? `Delete this request from ${item.name} for ${item.dates}? This cannot be undone.`
                  : `Archive this request from ${item.name} for ${item.dates}? It will be hidden from the pending queue but kept on record.`}
              </div>
              <div className="delete-modal-actions">
                <button className="nr-btn nr-btn-deny" disabled={railActionBusy} onClick={close}>Cancel</button>
                {isDelete ? (
                  <button
                    className="delete-confirm-btn"
                    disabled={railActionBusy}
                    onClick={async () => { await deleteRequest(item); setRailConfirm(null); }}
                  >
                    Delete permanently
                  </button>
                ) : (
                  <button
                    className="nr-btn nr-btn-approve"
                    disabled={railActionBusy}
                    onClick={async () => { await archiveRequest(item); setRailConfirm(null); }}
                  >
                    Archive
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {timeOffBlock && (
        <div className="day-popup-backdrop" onClick={() => setTimeOffBlock(null)}>
          <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
            <div className="delete-modal-title">Approved time off</div>
            <div className="delete-modal-body">
              <b>{timeOffBlock.name}</b> has approved time off on {timeOffBlock.dayLabel}. Their request was approved — are you sure you want to schedule them anyway?
            </div>
            <div className="delete-modal-actions">
              <button className="nr-btn nr-btn-deny" onClick={() => setTimeOffBlock(null)}>Keep Time Off</button>
              <button className="delete-confirm-btn" onClick={() => { const fn = timeOffBlock.onOverride; setTimeOffBlock(null); fn && fn(); }}>Override</button>
            </div>
          </div>
        </div>
      )}

      {/* Today at a Glance swap dialog (brief item 5). Writes schedule_overrides
          for today, which the Calendar and Tip Sheet both read, so the change
          shows up in each immediately. */}
      {swapModal && (() => {
        const replRole = swapForm.withName ? primaryRoleOf(swapForm.withName) : null;
        const shiftOpts = (replRole ? roleOptions[replRole] || [] : []).filter((o) => !isOffCell(o.code)); // no "Counts as off" option as a replacement
        // The date the glance box was showing when the swap was opened, not
        // necessarily today (brief item 7).
        const dateLabel = new Date(`${swapModal.dateIso || TODAY_ISO}T00:00:00`)
          .toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
        return (
          <div className="day-popup-backdrop" onClick={() => !swapBusy && setSwapModal(null)}>
            <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
              <div className="delete-modal-title">{swapForm.removeOnly ? "Remove from shift" : "Swap shift"}</div>

              {/* Replace with someone, or take them off with no replacement
                  (brief item 3). Both write dated overrides + a note. */}
              <div className="dayof-mode" role="group" aria-label="Change type">
                <button
                  className={`subtab-btn ${!swapForm.removeOnly ? "active" : ""}`}
                  disabled={swapBusy}
                  onClick={() => setSwapForm((f) => ({ ...f, removeOnly: false }))}
                >Replace</button>
                <button
                  className={`subtab-btn ${swapForm.removeOnly ? "active" : ""}`}
                  disabled={swapBusy}
                  onClick={() => setSwapForm((f) => ({ ...f, removeOnly: true, withName: "", shift: "" }))}
                >Remove only</button>
              </div>

              <label className="manual-field-label">Date</label>
              <input className="manual-field" type="text" value={dateLabel} readOnly disabled />

              <label className="manual-field-label">Removing</label>
              <input
                className="manual-field"
                type="text"
                readOnly
                disabled
                value={`${swapModal.name} — ${swapModal.code === "GAP" ? "Coverage gap" : shiftLabelForType(swapModal.code)}`}
              />

              {!swapForm.removeOnly && (
                <>
                  <label className="manual-field-label" htmlFor="swap-with">Replacing with</label>
                  <select
                    id="swap-with"
                    className="manual-field"
                    value={swapForm.withName}
                    disabled={swapBusy}
                    onChange={(e) => setSwapForm((f) => ({ ...f, withName: e.target.value, shift: "" }))}
                  >
                    <option value="">Select staff…</option>
                    {staffList
                      .filter((s) => s.active !== false && s.name !== swapModal.name)
                      .map((s) => <option key={s.id || s.name} value={s.name}>{s.name}</option>)}
                  </select>

                  <label className="manual-field-label" htmlFor="swap-shift">New shift</label>
                  <select
                    id="swap-shift"
                    className="manual-field"
                    value={swapForm.shift}
                    disabled={swapBusy || !swapForm.withName}
                    onChange={(e) => setSwapForm((f) => ({ ...f, shift: e.target.value }))}
                  >
                    <option value="">{swapForm.withName ? `Select shift (${replRole})…` : "Pick a replacement first…"}</option>
                    {shiftOpts.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                  </select>
                </>
              )}

              <label className="manual-field-label" htmlFor="swap-note">Reason (optional)</label>
              <textarea
                id="swap-note"
                className="manual-field"
                rows={2}
                disabled={swapBusy}
                placeholder="e.g. left early — added to the note on this week and on the date"
                value={swapForm.note}
                onChange={(e) => setSwapForm((f) => ({ ...f, note: e.target.value }))}
              />

              <div className="delete-modal-warn">
                {swapForm.removeOnly
                  ? `${swapModal.name} comes off the Tip Sheet, Today at a Glance and the Calendar for ${dateLabel}, with no replacement.`
                  : `This updates the Tip Sheet, Today at a Glance and the Calendar for ${dateLabel}.`}
                {" "}The planned schedule on Set Schedule is left as built, with a marker on the day. It can't be automatically undone.
              </div>

              <div className="delete-modal-actions">
                <button className="nr-btn nr-btn-deny" disabled={swapBusy} onClick={() => setSwapModal(null)}>Cancel</button>
                <button
                  className="delete-confirm-btn"
                  disabled={swapBusy || (!swapForm.removeOnly && (!swapForm.withName || !swapForm.shift))}
                  onClick={confirmSwap}
                >
                  {swapBusy ? "Saving…" : swapForm.removeOnly ? `Remove ${swapModal.name}` : "Confirm Change"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Tip Sheet day-of add / remove. This dialog is the confirmation: it
          names the person and the date before anything is written. */}
      {dayOfModal && (() => {
        const { mode, dateIso, name } = dayOfModal;
        const dateLabel = new Date(`${dateIso}T00:00:00`)
          .toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
        const isAdd = mode === "add";
        const candidates = staffList
          .filter((s) => s.active !== false && s.name && !tipWorkingNames.has(s.name))
          .sort((a, b) => a.name.localeCompare(b.name));
        const role = dayOfForm.role;
        const shiftOpts = role ? (roleOptions[role] || []).filter((o) => !isOffCell(o.code)) : []; // adding someone as "off" would be a no-op
        const full = isAdd && role ? dayOfSlotsFull(role) : false;
        const roleLabel = role === "Servers" ? "Server" : role;
        const shiftLabel = dayOfForm.shift ? roleShiftText(role, dayOfForm.shift) : "";
        const ready = isAdd ? !!(dayOfForm.name && role && dayOfForm.shift && !full) : true;
        return (
          <div className="day-popup-backdrop" onClick={() => !dayOfBusy && setDayOfModal(null)}>
            <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
              <div className="delete-modal-title">{isAdd ? "Add staff" : "Remove from shift"}</div>

              <label className="manual-field-label">Date</label>
              <input className="manual-field" type="text" value={dateLabel} readOnly disabled />

              {isAdd && (
                <>
                  <label className="manual-field-label" htmlFor="dayof-staff">Staff member</label>
                  <select
                    id="dayof-staff"
                    className="manual-field"
                    value={dayOfForm.name}
                    disabled={dayOfBusy}
                    onChange={(e) => pickDayOfStaff(e.target.value)}
                  >
                    <option value="">Select staff…</option>
                    {candidates.map((s) => <option key={s.id || s.name} value={s.name}>{s.name}</option>)}
                  </select>

                  <label className="manual-field-label" htmlFor="dayof-role">Role</label>
                  <select
                    id="dayof-role"
                    className="manual-field"
                    value={role}
                    disabled={dayOfBusy || !dayOfForm.name}
                    onChange={(e) => setDayOfForm((f) => ({ ...f, role: e.target.value, shift: "" }))}
                  >
                    {!dayOfForm.name && <option value="">Pick a staff member first…</option>}
                    {TIP_ADD_ROLES.map((r) => <option key={r} value={r}>{r === "Servers" ? "Server" : r}</option>)}
                  </select>

                  <label className="manual-field-label" htmlFor="dayof-shift">Shift</label>
                  <select
                    id="dayof-shift"
                    className="manual-field"
                    value={dayOfForm.shift}
                    disabled={dayOfBusy || !role}
                    onChange={(e) => setDayOfForm((f) => ({ ...f, shift: e.target.value }))}
                  >
                    <option value="">{role ? "Select shift…" : "Pick a role first…"}</option>
                    {shiftOpts.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                  </select>
                  {full && (
                    <div className="send-error">
                      Every {roleLabel} slot on this sheet is already filled — remove someone first, or pick another role.
                    </div>
                  )}
                </>
              )}

              <label className="manual-field-label" htmlFor="dayof-reason">Reason (optional)</label>
              <input
                id="dayof-reason"
                className="manual-field"
                type="text"
                disabled={dayOfBusy}
                placeholder={isAdd ? "e.g. called in to cover" : "e.g. left early"}
                value={dayOfForm.reason}
                onChange={(e) => setDayOfForm((f) => ({ ...f, reason: e.target.value }))}
              />

              <div className="delete-modal-warn">
                {isAdd
                  ? (dayOfForm.name && shiftLabel
                    ? `Add ${dayOfForm.name} as ${shiftLabel} on ${dateLabel}?`
                    : `Pick who's coming in on ${dateLabel}.`)
                  : `Remove ${name} from ${dateLabel}?`}
                {" "}This changes {dateLabel} only: the Tip Sheet, Today at a Glance and the Calendar update, and a note goes on this week and on the date. The planned schedule on Set Schedule is unchanged.
              </div>
              {dayOfError && <div className="send-error">{dayOfError}</div>}

              <div className="delete-modal-actions">
                <button className="nr-btn nr-btn-deny" disabled={dayOfBusy} onClick={() => setDayOfModal(null)}>Cancel</button>
                <button className="delete-confirm-btn" disabled={dayOfBusy || !ready} onClick={confirmDayOf}>
                  {dayOfBusy ? "Saving…" : isAdd ? (dayOfForm.name ? `Add ${dayOfForm.name}` : "Add") : `Remove ${name}`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Per-week notes. Scoped to activeWeekStart, so navigating weeks swaps the
          whole list. Rail-sourced notes are tagged but otherwise fully editable. */}
      {/* Send Tip Sheet confirmation (brief item 5). Recipients, subject and an
          optional note are all editable here; the email only goes out on
          Confirm & Send. */}
      {tipSendOpen && (
        <div className="day-popup-backdrop" onClick={() => !tipSendBusy && setTipSendOpen(false)}>
          <div className="send-modal" onClick={(e) => e.stopPropagation()}>
            <div className="day-popup-head">
              <div className="day-popup-date">Send Tip Sheet — {tipSendDayLabel}</div>
              <button className="day-popup-close" disabled={tipSendBusy} onClick={() => setTipSendOpen(false)}><X size={15} /></button>
            </div>

            <div className="send-section-label">
              Recipients <span className="nr-count">{tipSendChosen.length}</span>
            </div>
            {slotsExcludedOff.length > 0 && (
              <div className="tip-off-note" style={{ marginTop: 0, marginBottom: 8 }}>
                <AlertTriangle size={12} />
                {[...new Set(slotsExcludedOff)].join(", ")} — scheduled off on {shortDate(tipDateIso)}, so not on this sheet and won't be emailed.
              </div>
            )}
            {tipSendRoster.length === 0 ? (
              <div className="notes-empty">Nobody is on the sheet for this date yet.</div>
            ) : (
              <div className="send-recipients">
                {tipSendRoster.map((r) => (
                  <label className={`send-rcpt ${r.email ? "" : "send-rcpt-noemail"}`} key={r.name}>
                    <input
                      type="checkbox"
                      disabled={!r.email || tipSendBusy}
                      checked={!!r.email && !tipSendExcluded.includes(r.name)}
                      onChange={() => toggleTipRecipient(r.name)}
                    />
                    <span className="send-rcpt-name">{r.name}</span>
                    <span className="send-rcpt-pos">{r.position}</span>
                    <span className="send-rcpt-email">{r.email || "no email — will be skipped"}</span>
                    <span className="send-rcpt-payout">${r.payout}</span>
                  </label>
                ))}
              </div>
            )}

            <label className="manual-field-label" htmlFor="send-subject">Subject line</label>
            <input
              id="send-subject"
              className="manual-field"
              type="text"
              disabled={tipSendBusy}
              value={tipSendSubject}
              onChange={(e) => setTipSendSubject(e.target.value)}
            />

            <label className="manual-field-label" htmlFor="send-notes">Message notes (optional)</label>
            <textarea
              id="send-notes"
              className="manual-field"
              rows={3}
              disabled={tipSendBusy}
              placeholder="Anything to say above the tip breakdown…"
              value={tipSendNotes}
              onChange={(e) => setTipSendNotes(e.target.value)}
            />

            {tipSendResult && <div className="send-error">Couldn't send: {tipSendResult}</div>}
            {gmailDisconnected && (
              <div className="send-reconnect">
                <AlertTriangle size={13} />
                <span>
                  Gmail disconnected — nothing can be emailed until it's reconnected.{" "}
                  <a href={gmailReconnectUrl} target="_blank" rel="noopener">Reconnect Gmail</a>
                  {" "}(sign in as the scheduling inbox), then come back and Confirm &amp; Send.
                </span>
              </div>
            )}

            <div className="send-actions">
              <button className="nr-btn" disabled={tipSendBusy} onClick={() => setTipSendOpen(false)}>Cancel</button>
              <button
                className="publish-btn"
                disabled={tipSendBusy || tipSendChosen.length === 0}
                onClick={confirmSendTipSheet}
                title={tipSendChosen.length === 0 ? "Nobody selected has an email on file" : `Email ${tipSendChosen.length} staff`}
              >
                {tipSendBusy ? "Sending…" : `Confirm & Send (${tipSendChosen.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Publish dialog (PUBLISH brief A1). Nothing is emailed until Confirm &
          Send; the test goes to the signed-in manager only and never marks a
          week published. */}
      {publishModal && (() => {
        const m = publishModal;
        const busy = !!m.busy;
        const picked = m.weeks.filter((w) => m.picked.includes(w));
        const groups = [
          { key: "foh", label: "Front of House", people: publishRecipients.foh },
          { key: "bk", label: "BOH & Kitchen", people: publishRecipients.bk },
        ];
        const chosen = groups.reduce((n, g) => n + g.people.filter((r) => !m.excluded.includes(r.id)).length, 0);
        const close = () => { if (!busy) setPublishModal(null); };
        return (
          <div className="day-popup-backdrop" onClick={close}>
            <div className="send-modal" onClick={(e) => e.stopPropagation()}>
              <div className="day-popup-head">
                <div className="day-popup-date">Publish schedule</div>
                <button className="day-popup-close" disabled={busy} onClick={close}><X size={15} /></button>
              </div>

              <div className="send-section-label">
                {m.weeks.length === 1 ? "Week" : "Weeks"} <span className="nr-count">{picked.length}</span>
              </div>
              <div className="send-recipients">
                {m.weeks.map((w) => (
                  <label className="send-rcpt" key={w}>
                    <input type="checkbox" disabled={busy} checked={m.picked.includes(w)} onChange={() => togglePublishWeek(w)} />
                    <span className="send-rcpt-name">{weekRangeLabel(buildWeekByOffset(weekOffsetFor(new Date(`${w}T00:00:00`))))}</span>
                    <span className="send-rcpt-email">Haenyeo-Schedule-{w}.pdf</span>
                  </label>
                ))}
              </div>

              <div className="send-section-label">
                Recipients <span className="nr-count">{chosen}</span>
              </div>
              {groups.map((g) => (
                <React.Fragment key={g.key}>
                  <div className="publish-group-label">
                    {g.label} — {g.people.filter((r) => !m.excluded.includes(r.id)).length} of {g.people.length}
                    {m.sentSections.includes(g.key) && <span className="publish-sent-tag"> ✓ sent</span>}
                  </div>
                  {g.people.length === 0 ? (
                    <div className="notes-empty">Nobody registered in {g.label} yet.</div>
                  ) : (
                    <div className="send-recipients">
                      {g.people.map((r) => (
                        <label className="send-rcpt" key={r.id}>
                          <input
                            type="checkbox"
                            disabled={busy || m.sentSections.includes(g.key)}
                            checked={!m.excluded.includes(r.id)}
                            onChange={() => togglePublishRecipient(r.id)}
                          />
                          <span className="send-rcpt-name">{r.name}</span>
                          <span className="send-rcpt-email">{r.personal_email}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </React.Fragment>
              ))}

              <label className="manual-field-label" htmlFor="publish-subject">Subject line</label>
              <input
                id="publish-subject"
                className="manual-field"
                type="text"
                disabled={busy}
                value={m.subject}
                onChange={(e) => setPublishModal((p) => ({ ...p, subject: e.target.value, subjectEdited: true }))}
              />

              <label className="manual-field-label" htmlFor="publish-notes">Message (optional)</label>
              <textarea
                id="publish-notes"
                className="manual-field"
                rows={3}
                disabled={busy}
                placeholder="Anything to say above the schedule…"
                value={m.notes}
                onChange={(e) => setPublishModal((p) => ({ ...p, notes: e.target.value }))}
              />

              {m.error && <div className="send-error">{m.error}</div>}
              {m.testResult && <div className="publish-test-ok"><Check size={12} /> {m.testResult}</div>}
              {gmailDisconnected && (
                <div className="send-reconnect">
                  <AlertTriangle size={13} />
                  <span>
                    Gmail disconnected — nothing can be emailed until it's reconnected.{" "}
                    <a href={gmailReconnectUrl} target="_blank" rel="noopener">Reconnect Gmail</a>
                    {" "}(sign in as the scheduling inbox), then come back and send.
                  </span>
                </div>
              )}

              <div className="send-actions">
                <button
                  className="nr-btn"
                  disabled={busy || picked.length === 0}
                  onClick={() => sendPublish(true)}
                  title={`Send these emails to ${session?.user?.email || "you"} only, subject tagged [TEST]. Nothing is marked published.`}
                >{m.busy === "test" ? "Sending test…" : "Send test to me only"}</button>
                <span style={{ flex: 1 }} />
                <button className="nr-btn" disabled={busy} onClick={close}>Cancel</button>
                <button
                  className="publish-btn"
                  disabled={busy || picked.length === 0 || chosen === 0}
                  onClick={() => sendPublish(false)}
                  title={chosen === 0 ? "Nobody is ticked" : `Email ${chosen} staff`}
                >
                  {m.busy === "send" ? "Sending…" : `Confirm & Send (${chosen})`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {notesWeek && (
        <div className="day-popup-backdrop" onClick={() => { setNotesWeek(null); setNoteEditId(null); }}>
          <div className="notes-modal" onClick={(e) => e.stopPropagation()}>
            <div className="day-popup-head">
              <div className="day-popup-date">
                Notes — week of {formatWeekRange(buildWeekByOffset(weekOffsetFor(new Date(`${notesWeek}T00:00:00`))))}
              </div>
              <button className="day-popup-close" onClick={() => { setNotesWeek(null); setNoteEditId(null); }}><X size={15} /></button>
            </div>

            <div className="notes-add">
              <input
                className="notes-input"
                placeholder="Add a note for this week…"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddNote(); }}
              />
              <button className="publish-btn" disabled={!noteDraft.trim()} onClick={handleAddNote}>Add</button>
            </div>

            {modalNotes.length === 0 ? (
              <div className="notes-empty">No notes for this week yet.</div>
            ) : (
              <div className="notes-list">
                {modalNotes.map((n) => (
                  <div className="notes-row" key={n.id}>
                    {noteEditId === n.id ? (
                      <>
                        <input
                          className="notes-input"
                          value={noteEditText}
                          autoFocus
                          onChange={(e) => setNoteEditText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveNoteEdit(n.id);
                            if (e.key === "Escape") setNoteEditId(null);
                          }}
                        />
                        <div className="notes-row-actions">
                          <button className="nr-btn nr-btn-approve" onClick={() => handleSaveNoteEdit(n.id)}><Check size={13} /></button>
                          <button className="nr-btn nr-btn-deny" onClick={() => setNoteEditId(null)}><X size={13} /></button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="notes-row-body">
                          <div className="notes-row-text">{n.note}</div>
                          <div className="notes-row-meta">
                            {n.source === "rail" && <span className="notes-tag">from Rail</span>}
                            {n.source === "dayof" && <span className="notes-tag">day-of change</span>}
                            {n.staff_id && staffNameById[n.staff_id] && <span>{staffNameById[n.staff_id]}</span>}
                            <span>{new Date(n.created_at).toLocaleDateString(undefined, MONTH_FMT)}</span>
                          </div>
                        </div>
                        <div className="notes-row-actions">
                          <button
                            className="nr-btn"
                            title="Edit"
                            onClick={() => { setNoteEditId(n.id); setNoteEditText(n.note); }}
                          >Edit</button>
                          <button className="nr-btn nr-btn-deny" title="Delete" onClick={() => handleDeleteNote(n.id)}><X size={13} /></button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Print-only mount for the branded schedule sheet (direct child of .hub —
          shown only when body.printing-schedule is set, see @media print rules).
          printSchedule() fills this with the same renderer used for the PDF. */}
      <div className="schedule-print-portal" ref={schedulePrintRef} aria-hidden="true" />

      {/* Print-only sheet of all 7 QR codes (direct child of .hub — shown only
          when body.printing-qr is set, see @media print rules). Branded layout
          per SCHEDULE-DESIGN-BRIEF §3; QR contents unchanged. */}
      <div className="qr-print-sheet" aria-hidden="true">
        <div className="qrs-band">
          <div className="qrs-band-row">
            <img src={HAENYEO_ICON} alt="" className="qrs-band-icon" />
            <span className="qrs-band-word">HAENYEO</span>
          </div>
          <div className="qrs-band-sub">SCHEDULING SYSTEM — SCAN THE CODE THAT MATCHES YOUR REQUEST</div>
        </div>

        <div className="qrs-register">
          {qrPrintUrls.register && <img className="qrs-register-qr" src={qrPrintUrls.register} alt="QR code: Register" />}
          <div className="qrs-register-info">
            <span className="qrs-start-pill">START HERE</span>
            <div className="qrs-register-title">Register (first time only)</div>
            <div className="qrs-register-text">Scan, replace "Your Name Here" with your full name, add your phone number, and hit send. You'll get a welcome email explaining everything.</div>
          </div>
        </div>

        <div className="qrs-grid">
          {QR_PRINT_CARDS.map((c) => (
            <div className="qrs-card" style={{ borderTopColor: c.color }} key={c.key}>
              {qrPrintUrls[c.key] && <img className="qrs-card-qr" src={qrPrintUrls[c.key]} alt={`QR code: ${c.title}`} />}
              <div className="qrs-card-title">{c.title}</div>
              <div className="qrs-card-text">{c.text}</div>
            </div>
          ))}
        </div>

        <div className="qrs-footer">
          <span>All requests go to haenyeo.schedule@gmail.com — you'll get a reply once reviewed</span>
          <span className="qrs-footer-right">Questions? Ask a manager</span>
        </div>
      </div>
    </div>
  );
}
