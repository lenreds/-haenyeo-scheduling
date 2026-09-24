// Plain-text email builders for the standalone (non-reply) send flows: welcome,
// name-not-matched, weekly schedule publish, and finalized tip sheet. Each
// returns { subject, body }. Pure — no I/O.

const SIG = "— Haenyeo Management";

export function buildWelcomeEmail(name) {
  const subject = "You're in — here's how scheduling works at Haenyeo";
  const body =
`Hi ${name}, you're all set! Here's everything you need to know about submitting scheduling requests going forward.

Send all requests to: haenyeo.schedule@gmail.com

Just write a normal email — keep it simple. Here's what to include:

Time off (single day):
Subject: RO july 28
Body: any details or reason (optional)

Time off (multiple days in a row):
Subject: RO july 28 to august 4

Time off (specific scattered days):
Subject: RO july 28, july 30, august 2

Shift swap:
Subject: swap august 3
Body: mention who you want to swap with

Need your shift covered:
First find someone who can cover you, then email it in and CC the person covering your shift.
Subject: coverage august 3
Body: mention who will be covering you

You'll get an automatic reply confirming we received it. Once it's reviewed you'll hear back with an approval or denial.

A few things to know:

- Your request goes directly to management — no one else sees it
- The weekly schedule will also be sent to this email once it's published
- If your email or phone number ever changes, let a manager know so we can update it

Questions? Ask Lenis or Jon directly.

${SIG}`;
  return { subject, body };
}

export function buildNameNotMatchedReply(rawName) {
  const subject = "We couldn't find your name — please try again";
  const body =
`Hi,

We received your registration but couldn't match "${rawName}" to anyone on the staff list. Please double-check the spelling of your name (use the name management has on file) and send the registration email again.

${SIG}`;
  return { subject, body };
}

// Plain-text schedule body for one week (people/groups list). Shared by the
// single-week text email and each stacked week in the multi-week text.
function scheduleBodyMain({ dayHeaders, rows, groups }) {
  const renderPeople = (people) =>
    (people || [])
      .map((r) => `${r.name}\n${(r.shifts || []).map((s, i) => `  ${dayHeaders[i]}: ${s || "Off"}`).join("\n")}`)
      .join("\n\n");
  return groups
    ? groups.map((g) => `${g.label}\n${"—".repeat(24)}\n${renderPeople(g.rows)}`).join("\n\n\n")
    : renderPeople(rows);
}

// weekLabel: "Jun 29 – Jul 5"; dayHeaders: 7 short labels ("Mon 6/29");
// Flat FOH schedule: rows = [{ name, shifts: [7 labels] }]. For BOH+Kitchen pass
// `groups` = [{ label, rows }] (rendered with a divider) and `sectionLabel`
// ("BOH & Kitchen") which also tags the subject.
export function buildScheduleEmail({ weekLabel, dayHeaders, rows, groups, sectionLabel }) {
  const subject = sectionLabel
    ? `Haenyeo Schedule — ${sectionLabel} — Week of ${weekLabel}`
    : `Haenyeo Schedule — Week of ${weekLabel}`;
  const heading = sectionLabel ? `Haenyeo — ${sectionLabel} schedule` : "Haenyeo — Front of House schedule";
  const body = `${heading}\nWeek of ${weekLabel}\n\n${scheduleBodyMain({ dayHeaders, rows, groups })}\n\n${SIG}`;
  return { subject, body };
}

/* ---- Redesigned schedule email (HTML, matches the colored PDF sheet) ---- */

const SHEET_COLORS = {
  dark: "#1a1a1a", orange: "#c8956c", green: "#5a8a6a", blue: "#4a7a9b",
  purple: "#8a5a9b", grey: "#8a8a8a", tint: "#fff8f4", teal: "#2a9d8f",
};
const GROUP_COLOR = {
  Bar: SHEET_COLORS.orange, Servers: SHEET_COLORS.green, "Busser/Runner": SHEET_COLORS.blue,
  Host: SHEET_COLORS.purple, Kitchen: SHEET_COLORS.orange, BOH: SHEET_COLORS.blue,
  Training: SHEET_COLORS.teal,
};
// Cell-level colors: a cell takes the color of the role actually worked that
// day (rows carry a `roles` array resolved client-side from the shift code
// prefix), not the section it appears in. Mirrors ROLE_COLOR in src/App.jsx.
const ROLE_COLOR = { ...GROUP_COLOR, Expo: SHEET_COLORS.orange, Management: "#888888" };
// Lighter shade per accent for the small cross-role label under a shift worked
// outside the row's primary role. Mirrors ROLE_COLOR_MUTED in src/App.jsx.
const ROLE_COLOR_MUTED = {
  Bar: "#d6b294", Expo: "#d6b294", Kitchen: "#d6b294",
  Servers: "#85a891", "Busser/Runner": "#7ea0b8", BOH: "#7ea0b8",
  Host: "#ab86b8", Management: "#a6a6a6", Training: "#7fc4ba",
};
const crossRoleLabelText = (role) => (role === "Servers" ? "Server" : role);
const escHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// "Mon 6/29" → { dow: "MON", date: "6/29" } (fallback when the client didn't
// send the structured `days` array).
function daysFromHeaders(dayHeaders) {
  return (dayHeaders || []).map((h) => {
    const [dow, ...rest] = String(h).split(" ");
    return { dow: (dow || "").toUpperCase(), date: rest.join(" ") };
  });
}

const EMAIL_MONO = "'Courier New', Courier, monospace";
const EMAIL_SANS = "Arial, Helvetica, sans-serif";

// Inner schedule <table> for ONE week (dark header band + footer are added by
// the caller so multiple weeks can stack in one email). Pure. Role-colored
// cells, orange today column, em-dash offs, cross-role labels, manager pills.
function scheduleTableHtml(payload) {
  const { dayHeaders, rows, groups, sectionLabel, managerOn } = payload;
  const days = Array.isArray(payload.days) && payload.days.length === 7 ? payload.days : daysFromHeaders(dayHeaders);
  const todayIdx = Number.isInteger(payload.todayIdx) ? payload.todayIdx : -1;
  const groupList = groups && groups.length ? groups : [{ label: sectionLabel || "Schedule", rows: rows || [] }];
  const mono = EMAIL_MONO, sans = EMAIL_SANS, C = SHEET_COLORS;

  const dayHead = days
    .map((d, i) =>
      i === todayIdx
        ? `<td style="padding:8px 2px;background:${C.orange};color:#ffffff;font-family:${mono};font-weight:bold;font-size:10px;letter-spacing:1px;text-align:center;">★&nbsp;${escHtml(d.dow)}<br>${escHtml(d.date)}</td>`
        : `<td style="padding:8px 2px;color:#8c8c8c;font-family:${mono};font-weight:bold;font-size:10px;letter-spacing:1px;text-align:center;border-bottom:1px solid #e4e4e4;">${escHtml(d.dow)}<br>${escHtml(d.date)}</td>`
    )
    .join("");

  const tint = (i) => (i === todayIdx ? `background:${C.tint};` : "");
  const shiftCell = (label, role, primary, i) => {
    const off = !label || label === "Off";
    const cross = !off && role && primary && role !== primary;
    const crossLine = cross
      ? `<div style="font-size:9px;line-height:1.1;margin-top:1px;font-weight:bold;font-family:${sans};color:${ROLE_COLOR_MUTED[role] || "#a6a6a6"};">${escHtml(crossRoleLabelText(role))}</div>`
      : "";
    return `<td style="padding:7px 2px;text-align:center;border-bottom:1px solid #efefef;${tint(i)}font-family:${sans};font-size:10px;${
      off ? "font-style:italic;color:#cccccc;" : `color:${ROLE_COLOR[role] || "#3a3a3a"};font-weight:bold;`
    }">${off ? "—" : escHtml(label)}${crossLine}</td>`;
  };
  const groupBlock = (g) => {
    const color = GROUP_COLOR[g.label] || C.grey;
    const head = `<tr><td colspan="8" style="border-top:2px solid ${color};background:#fafafa;padding:6px 10px;font-family:${mono};font-weight:bold;font-size:10px;letter-spacing:2px;color:#333333;"><span style="color:${color};font-size:11px;">●</span>&nbsp; ${escHtml(g.label).toUpperCase()}</td></tr>`;
    const people = (g.rows || [])
      .map(
        (r) =>
          `<tr><td style="padding:7px 10px;border-bottom:1px solid #efefef;font-family:${sans};font-weight:bold;font-size:11px;color:#2b2b2b;">${escHtml(r.name)}</td>${(r.shifts || [])
            .map((label, i) => shiftCell(label, r.roles ? r.roles[i] : null, r.primaryRole || null, i))
            .join("")}</tr>`
      )
      .join("");
    return head + people;
  };
  const pill = (n) =>
    `<span style="display:inline-block;background:${C.dark};color:#ffffff;border-radius:10px;padding:2px 7px;font-family:${sans};font-weight:bold;font-size:9px;">${escHtml(n)}</span>`;
  const managerBlock =
    Array.isArray(managerOn) && managerOn.length === 7
      ? `<tr><td colspan="8" style="border-top:2px solid ${C.grey};background:#fafafa;padding:6px 10px;font-family:${mono};font-weight:bold;font-size:10px;letter-spacing:2px;color:#333333;"><span style="color:${C.grey};font-size:11px;">●</span>&nbsp; MANAGER ON</td></tr>
        <tr><td style="padding:7px 10px;border-bottom:1px solid #efefef;font-family:${sans};font-size:10px;color:#8c8c8c;">Manager on</td>${managerOn
          .map((names, i) =>
            names && names.length
              ? `<td style="padding:5px 2px;text-align:center;border-bottom:1px solid #efefef;${tint(i)}">${names.map(pill).join("<br>")}</td>`
              : `<td style="padding:7px 2px;text-align:center;border-bottom:1px solid #efefef;${tint(i)}font-family:${sans};font-size:10px;font-style:italic;color:#cccccc;">—</td>`
          )
          .join("")}</tr>`
      : "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
        <tr><td style="border-bottom:1px solid #e4e4e4;width:90px;"></td>${dayHead}</tr>
        ${groupList.map(groupBlock).join("")}
        ${managerBlock}
      </table>`;
}

// Dark branded header band row (real icon via CID, section title, date range).
function emailHeaderBand({ sectionTitle, rangeLabel }) {
  const mono = EMAIL_MONO, sans = EMAIL_SANS, C = SHEET_COLORS;
  const sentOn = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `<tr><td style="background:${C.dark};border-radius:12px 12px 0 0;padding:16px 18px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
        <td style="vertical-align:middle;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="vertical-align:middle;padding-right:12px;"><img src="cid:haenyeo-icon" alt="Haenyeo" width="34" height="34" style="display:block;width:34px;height:34px;" /></td>
            <td style="vertical-align:middle;">
              <div style="font-family:${mono};font-weight:bold;font-size:17px;letter-spacing:5px;color:#ffffff;">HAENYEO</div>
              <div style="font-family:${mono};font-weight:bold;font-size:9px;letter-spacing:2px;color:${C.orange};padding-top:2px;">${escHtml(sectionTitle)}</div>
            </td>
          </tr></table>
        </td>
        <td style="vertical-align:middle;text-align:right;">
          <div style="font-family:${mono};font-weight:bold;font-size:12px;color:#ffffff;white-space:nowrap;">${escHtml(rangeLabel)}</div>
          <div style="font-family:${sans};font-size:9px;color:#9a9a9a;padding-top:2px;">Sent ${escHtml(sentOn)}</div>
        </td>
      </tr></table>
    </td></tr>`;
}

// Footer legend row: role dots (right) + optional today swatch (left).
function emailFooterRows({ groups, showToday }) {
  const sans = EMAIL_SANS, C = SHEET_COLORS;
  const legendDots = (groups || [])
    .map((g) => {
      const color = GROUP_COLOR[g.label] || C.grey;
      return `<span style="white-space:nowrap;">&nbsp;&nbsp;<span style="color:${color};">●</span>&nbsp;${escHtml(g.label)}</span>`;
    })
    .join("");
  return `<tr><td style="background:#ffffff;border:1px solid #e6e6e6;border-top:none;border-radius:0 0 12px 12px;padding:8px 12px 10px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
        <td style="font-family:${sans};font-size:9px;color:#7a7a7a;">${
          showToday
            ? `<span style="display:inline-block;width:9px;height:9px;background:${C.orange};border-radius:2px;">&nbsp;</span>&nbsp;Today&nbsp;&nbsp;&nbsp;`
            : ""
        }<span style="font-style:italic;color:#cccccc;">—</span>&nbsp;Day off</td>
        <td style="font-family:${sans};font-size:9px;color:#7a7a7a;text-align:right;">${legendDots}</td>
      </tr></table>
    </td></tr>`;
}

const groupListOf = (p) =>
  p.groups && p.groups.length ? p.groups : [{ label: p.sectionLabel || "Schedule", rows: p.rows || [] }];

// Table-based, inline-styled HTML mirroring the PDF sheet: dark header band
// with the real icon (CID image — Gmail blocks data: URIs), role-colored group
// sections, orange today column, em-dash off days, manager pill badges.
// Email-safe fonts only (Courier New stands in for Space Mono).
// Returns { subject, text, html } — text is the plain-text alternative.
export function buildScheduleEmailHtml(payload) {
  const { weekLabel, sectionLabel } = payload;
  const { subject, body: text } = buildScheduleEmail(payload);
  const todayIdx = Number.isInteger(payload.todayIdx) ? payload.todayIdx : -1;
  const sectionTitle = sectionLabel ? `${sectionLabel.toUpperCase()} SCHEDULE` : "FRONT OF HOUSE SCHEDULE";
  const html = `<div style="margin:0;padding:14px 8px;background:#f4f4f2;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="width:100%;max-width:640px;margin:0 auto;">
    ${emailHeaderBand({ sectionTitle, rangeLabel: weekLabel })}
    <tr><td style="background:#ffffff;border:1px solid #e6e6e6;border-top:none;padding:0 0 4px;">
      ${scheduleTableHtml(payload)}
    </td></tr>
    ${emailFooterRows({ groups: groupListOf(payload), showToday: todayIdx >= 0 })}
    <tr><td style="padding:12px 6px 0;font-family:${EMAIL_SANS};font-size:10px;color:#9a9a9a;text-align:center;">${SIG}</td></tr>
  </table>
</div>`;

  return { subject, text, html };
}

// 2+ weeks in one email: shared header/footer, each week as its own labeled
// table with a divider between. Today highlights only within its own week (each
// payload carries its own todayIdx). weeks[i] is a single-week payload; sectionLabel
// (from the BOH+Kitchen payload) tags the subject. Returns { subject, text, html }.
export function buildMultiWeekScheduleHtml({ weeks, sectionLabel }) {
  const list = weeks || [];
  const first = list[0] || {};
  const last = list[list.length - 1] || {};
  const spanStart = String(first.weekLabel || "").split(" – ")[0];
  const spanEnd = String(last.weekLabel || "").split(" – ")[1] || String(last.weekLabel || "");
  const range = `${spanStart} – ${spanEnd}`;
  const subject = sectionLabel ? `Haenyeo Schedule — ${sectionLabel} — ${range}` : `Haenyeo Schedule — ${range}`;
  const heading = sectionLabel ? `Haenyeo — ${sectionLabel} schedule` : "Haenyeo — Front of House schedule";
  const text =
    `${heading}\n${range}\n\n` +
    list.map((w) => `Week of ${w.weekLabel}\n${scheduleBodyMain(w)}`).join("\n\n\n") +
    `\n\n${SIG}`;

  const sectionTitle = sectionLabel ? `${sectionLabel.toUpperCase()} SCHEDULE` : "FRONT OF HOUSE SCHEDULE";
  const showToday = list.some((w) => Number.isInteger(w.todayIdx) && w.todayIdx >= 0);
  const mono = EMAIL_MONO;
  const weekBlocks = list
    .map((w, wi) => {
      const label = `<tr><td style="background:#ffffff;border-left:1px solid #e6e6e6;border-right:1px solid #e6e6e6;padding:${wi === 0 ? 14 : 12}px 0 4px;">
      <div style="font-family:${mono};font-weight:bold;font-size:11px;letter-spacing:1px;color:#333333;padding:0 10px 8px;">Week of ${escHtml(w.weekLabel)}</div>
      ${scheduleTableHtml(w)}
    </td></tr>`;
      const divider =
        wi < list.length - 1
          ? `<tr><td style="background:#ffffff;border-left:1px solid #e6e6e6;border-right:1px solid #e6e6e6;padding:2px 16px;"><div style="border-top:1px solid #e0e0e0;font-size:0;line-height:0;">&nbsp;</div></td></tr>`
          : "";
      return label + divider;
    })
    .join("");

  const html = `<div style="margin:0;padding:14px 8px;background:#f4f4f2;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="width:100%;max-width:640px;margin:0 auto;">
    ${emailHeaderBand({ sectionTitle, rangeLabel: range })}
    ${weekBlocks}
    ${emailFooterRows({ groups: groupListOf(first), showToday })}
    <tr><td style="padding:12px 6px 0;font-family:${EMAIL_SANS};font-size:10px;color:#9a9a9a;text-align:center;">${SIG}</td></tr>
  </table>
</div>`;

  return { subject, text, html };
}

// Manual Rail entry ("+ Add Request"): paper-trail copy to the scheduling
// inbox. type is the canonical uppercase rail type ("REQUEST OFF" etc.).
export function buildManualEntryInboxEmail({ managerName, staffName, type, dates, note }) {
  const subject = `[MANUAL ENTRY] – ${type} – ${staffName} – ${dates}`;
  const body =
`A scheduling request was manually logged by ${managerName}.

Staff: ${staffName}
Type: ${type}
Dates: ${dates}${note ? `\nNote: ${note}` : ""}

This entry is now pending in the Rail.
${SIG}`;
  return { subject, body };
}

// Manual Rail entry: confirmation to the staff member (registered only).
export function buildManualEntryStaffEmail({ staffName, type, dates, note }) {
  const subject = "Your scheduling request has been logged";
  const body =
`Hi ${staffName}, just confirming that your ${String(type || "").toLowerCase()} request for ${dates} has been logged in the system. You'll hear back once it's been reviewed.

${note ? `${note}\n\n` : ""}${SIG}`;
  return { subject, body };
}

// The Tip Sheet itself travels as the attached PDF (the Save as PDF page), so
// the body is only what the manager typed on the send-confirmation screen,
// then the sign-off — no payout lines or breakdown. No notes → just the
// sign-off. The subject is editable there too (default "Tip sheet MM/DD/YY");
// a blank one falls back to the day label.
export function buildTipSheetEmail({ dayDateLabel, subject: subjectOverride, notes }) {
  const subject = String(subjectOverride || "").trim() || `Tip sheet ${dayDateLabel}`;
  const note = String(notes || "").trim();
  const body = note ? `${note}\n\n${SIG}` : SIG;
  return { subject, body };
}
