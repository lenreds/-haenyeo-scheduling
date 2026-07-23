// Plain-text email builders for the standalone (non-reply) send flows: welcome,
// name-not-matched, weekly schedule publish, and finalized tip sheet. Each
// returns { subject, body }. Pure — no I/O.

const SIG = "— Haenyeo Management";

export function buildWelcomeEmail(name) {
  const subject = "You're registered — here's how scheduling works at Haenyeo";
  const body =
`Hi ${name}, you're all set on the Haenyeo scheduling system! From now on, your weekly schedule will come straight to this email.

To send any scheduling requests, email haenyeo.schedule@gmail.com using these subject line formats:

Single day off: [SCHEDULING] – REQUEST OFF – [Your Name] – [Date]
Consecutive time off: [SCHEDULING] – TIME OFF – [Your Name] – Jul 28 to Aug 4
Non-consecutive days: [SCHEDULING] – TIME OFF – [Your Name] – Jul 28, Jul 30, Aug 2
Shift swap: [SCHEDULING] – SHIFT SWAP – [Your Name] – [Date] (mention who you're swapping with in the body)
Coverage needed: [SCHEDULING] – COVERAGE REQUEST – [Your Name] – [Date]

You'll hear back once your request is reviewed. If your contact info ever changes, scan the "Update My Info" QR code posted at the restaurant.

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

// weekLabel: "Jun 29 – Jul 5"; dayHeaders: 7 short labels ("Mon 6/29");
// Flat FOH schedule: rows = [{ name, shifts: [7 labels] }]. For BOH+Kitchen pass
// `groups` = [{ label, rows }] (rendered with a divider) and `sectionLabel`
// ("BOH & Kitchen") which also tags the subject.
export function buildScheduleEmail({ weekLabel, dayHeaders, rows, groups, sectionLabel }) {
  const subject = sectionLabel
    ? `Haenyeo Schedule — ${sectionLabel} — Week of ${weekLabel}`
    : `Haenyeo Schedule — Week of ${weekLabel}`;
  const renderPeople = (people) =>
    (people || [])
      .map((r) => `${r.name}\n${(r.shifts || []).map((s, i) => `  ${dayHeaders[i]}: ${s || "Off"}`).join("\n")}`)
      .join("\n\n");
  const bodyMain = groups
    ? groups.map((g) => `${g.label}\n${"—".repeat(24)}\n${renderPeople(g.rows)}`).join("\n\n\n")
    : renderPeople(rows);
  const heading = sectionLabel ? `Haenyeo — ${sectionLabel} schedule` : "Haenyeo — Front of House schedule";
  const body = `${heading}\nWeek of ${weekLabel}\n\n${bodyMain}\n\n${SIG}`;
  return { subject, body };
}

/* ---- Redesigned schedule email (HTML, matches the colored PDF sheet) ---- */

const SHEET_COLORS = {
  dark: "#1a1a1a", orange: "#c8956c", green: "#5a8a6a", blue: "#4a7a9b",
  purple: "#8a5a9b", grey: "#8a8a8a", tint: "#fff8f4",
};
const GROUP_COLOR = {
  Bar: SHEET_COLORS.orange, Servers: SHEET_COLORS.green, "Busser/Runner": SHEET_COLORS.blue,
  Host: SHEET_COLORS.purple, Kitchen: SHEET_COLORS.orange, BOH: SHEET_COLORS.blue,
};
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

// Table-based, inline-styled HTML mirroring the PDF sheet: dark header band
// with the real icon (CID image — Gmail blocks data: URIs), role-colored group
// sections, orange today column, em-dash off days, manager pill badges.
// Email-safe fonts only (Courier New stands in for Space Mono).
// Returns { subject, text, html } — text is the plain-text alternative.
export function buildScheduleEmailHtml(payload) {
  const { weekLabel, dayHeaders, rows, groups, sectionLabel, managerOn } = payload;
  const { subject, body: text } = buildScheduleEmail(payload);
  const days = Array.isArray(payload.days) && payload.days.length === 7 ? payload.days : daysFromHeaders(dayHeaders);
  const todayIdx = Number.isInteger(payload.todayIdx) ? payload.todayIdx : -1;
  const groupList = groups && groups.length ? groups : [{ label: sectionLabel || "Schedule", rows: rows || [] }];
  const mono = "'Courier New', Courier, monospace";
  const sans = "Arial, Helvetica, sans-serif";
  const C = SHEET_COLORS;

  const dayHead = days
    .map((d, i) =>
      i === todayIdx
        ? `<td style="padding:8px 2px;background:${C.orange};color:#ffffff;font-family:${mono};font-weight:bold;font-size:10px;letter-spacing:1px;text-align:center;">★&nbsp;${escHtml(d.dow)}<br>${escHtml(d.date)}</td>`
        : `<td style="padding:8px 2px;color:#8c8c8c;font-family:${mono};font-weight:bold;font-size:10px;letter-spacing:1px;text-align:center;border-bottom:1px solid #e4e4e4;">${escHtml(d.dow)}<br>${escHtml(d.date)}</td>`
    )
    .join("");

  const tint = (i) => (i === todayIdx ? `background:${C.tint};` : "");
  const shiftCell = (label, i) => {
    const off = !label || label === "Off";
    return `<td style="padding:7px 2px;text-align:center;border-bottom:1px solid #efefef;${tint(i)}font-family:${sans};font-size:10px;${
      off ? "font-style:italic;color:#b9b9b9;" : "color:#3a3a3a;font-weight:bold;"
    }">${off ? "—" : escHtml(label)}</td>`;
  };
  const groupBlock = (g) => {
    const color = GROUP_COLOR[g.label] || C.grey;
    const head = `<tr><td colspan="8" style="border-top:2px solid ${color};background:#fafafa;padding:6px 10px;font-family:${mono};font-weight:bold;font-size:10px;letter-spacing:2px;color:#333333;"><span style="color:${color};font-size:11px;">●</span>&nbsp; ${escHtml(g.label).toUpperCase()}</td></tr>`;
    const people = (g.rows || [])
      .map(
        (r) =>
          `<tr><td style="padding:7px 10px;border-bottom:1px solid #efefef;font-family:${sans};font-weight:bold;font-size:11px;color:#2b2b2b;">${escHtml(r.name)}</td>${(r.shifts || [])
            .map(shiftCell)
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
              : `<td style="padding:7px 2px;text-align:center;border-bottom:1px solid #efefef;${tint(i)}font-family:${sans};font-size:10px;font-style:italic;color:#b9b9b9;">—</td>`
          )
          .join("")}</tr>`
      : "";
  const legendDots = groupList
    .map((g) => {
      const color = GROUP_COLOR[g.label] || C.grey;
      return `<span style="white-space:nowrap;">&nbsp;&nbsp;<span style="color:${color};">●</span>&nbsp;${escHtml(g.label)}</span>`;
    })
    .join("");
  const sectionTitle = sectionLabel ? `${sectionLabel.toUpperCase()} SCHEDULE` : "FRONT OF HOUSE SCHEDULE";
  const sentOn = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const html = `<div style="margin:0;padding:14px 8px;background:#f4f4f2;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="width:100%;max-width:640px;margin:0 auto;">
    <tr><td style="background:${C.dark};border-radius:12px 12px 0 0;padding:16px 18px;">
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
          <div style="font-family:${mono};font-weight:bold;font-size:12px;color:#ffffff;white-space:nowrap;">${escHtml(weekLabel)}</div>
          <div style="font-family:${sans};font-size:9px;color:#9a9a9a;padding-top:2px;">Sent ${escHtml(sentOn)}</div>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="background:#ffffff;border:1px solid #e6e6e6;border-top:none;padding:0 0 4px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
        <tr><td style="border-bottom:1px solid #e4e4e4;width:90px;"></td>${dayHead}</tr>
        ${groupList.map(groupBlock).join("")}
        ${managerBlock}
      </table>
    </td></tr>
    <tr><td style="background:#ffffff;border:1px solid #e6e6e6;border-top:none;border-radius:0 0 12px 12px;padding:8px 12px 10px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
        <td style="font-family:${sans};font-size:9px;color:#7a7a7a;">${
          todayIdx >= 0
            ? `<span style="display:inline-block;width:9px;height:9px;background:${C.orange};border-radius:2px;">&nbsp;</span>&nbsp;Today&nbsp;&nbsp;&nbsp;`
            : ""
        }<span style="font-style:italic;color:#b9b9b9;">—</span>&nbsp;Day off</td>
        <td style="font-family:${sans};font-size:9px;color:#7a7a7a;text-align:right;">${legendDots}</td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:12px 6px 0;font-family:${sans};font-size:10px;color:#9a9a9a;text-align:center;">${SIG}</td></tr>
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

// dayDateLabel: "Thursday, Jul 24"; rows: [{ name, position, points, hours, final }];
// recipientName/recipientPayout personalize the highlighted line per email.
export function buildTipSheetEmail({ dayDateLabel, floorPool, rows, barTipOut, barRecipients, floorCheckText, recipientName, recipientPayout }) {
  const subject = `Haenyeo Tip Sheet — ${dayDateLabel}`;
  const workerLines = (rows || [])
    .map((r) => `  ${r.name} — ${r.position}: ${r.points} pts, ${r.hours} hrs → $${r.final}`)
    .join("\n");
  const body =
`Haenyeo Tip Sheet — ${dayDateLabel}

YOUR PAYOUT: $${recipientPayout}
(${recipientName})

Floor pool (cash + CC): $${floorPool}

Breakdown:
${workerLines}

Bar tip-out: $${barTipOut}${barRecipients ? ` (split among ${barRecipients})` : ""}
${floorCheckText}

${SIG}`;
  return { subject, body };
}
