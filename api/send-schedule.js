// POST /api/send-schedule — emails one or more weeks' schedule to registered staff.
// Manager-JWT auth. Body: { weeks:[weekPayload,…], sections?:["FOH"|"BOH"|"Kitchen"],
// attachments?:[{filename,b64}] } where each weekPayload is
// { weekLabel, dayHeaders:[7], rows:[{name,shifts:[7],roles?,primaryRole?}] OR
// groups:[{label,rows}], sectionLabel?, days?:[{dow,date}×7], todayIdx?, managerOn? }.
// Legacy single-week bodies (those same fields at the top level, no `weeks`) still
// work. 2+ weeks stack in one email; `attachments` are PDF files (one per week).
// `sections` restricts recipients by staff.section (case-insensitive); omitted =
// all registered. Sends the branded HTML sheet (plain-text alternative + the
// real icon as an inline CID image). Same email to each; tagged Sent/Schedules.

import { GMAIL_REFRESH_TOKEN } from "./_lib/config.js";
import { getAccessToken, sendMessage, modifyMessage } from "./_lib/google.js";
import { buildHtmlRawEmail } from "./_lib/reply.js";
import { buildScheduleEmailHtml, buildMultiWeekScheduleHtml } from "./_lib/emails.js";
import { HAENYEO_ICON_B64 } from "./_lib/brand.js";
import { makeLabeler, LABELS } from "./_lib/labels.js";
import { getGmailToken, isManager, fetchRegisteredStaff } from "./_lib/store.js";

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!(await isManager(token))) return res.status(401).json({ error: "unauthorized" });

  const body = readBody(req);
  const { sections, attachments } = body;
  // New clients send a `weeks` array; legacy single-week bodies carry the week
  // fields at the top level — wrap them so the rest of the flow is uniform.
  const weeks = Array.isArray(body.weeks) && body.weeks.length
    ? body.weeks
    : [{ weekLabel: body.weekLabel, dayHeaders: body.dayHeaders, rows: body.rows, groups: body.groups, sectionLabel: body.sectionLabel, days: body.days, todayIdx: body.todayIdx, managerOn: body.managerOn }];
  const w0 = weeks[0] || {};
  if (!w0.weekLabel || !Array.isArray(w0.dayHeaders) || (!Array.isArray(w0.rows) && !Array.isArray(w0.groups))) {
    return res.status(400).json({ error: "weeks[0] needs weekLabel, dayHeaders, and rows or groups" });
  }
  const sectionLabel = w0.sectionLabel;

  try {
    const tokenRow = await getGmailToken();
    const refreshToken = tokenRow?.refresh_token || GMAIL_REFRESH_TOKEN;
    if (!refreshToken) return res.status(200).json({ sent: 0, error: "gmail_not_connected" });

    const accessToken = await getAccessToken(refreshToken);
    let recipients = await fetchRegisteredStaff();
    if (Array.isArray(sections) && sections.length) {
      const want = sections.map((s) => String(s).toLowerCase());
      recipients = recipients.filter((r) => want.includes(String(r.section || "").toLowerCase()));
    }
    const { subject, text, html } = weeks.length > 1
      ? buildMultiWeekScheduleHtml({ weeks, sectionLabel })
      : buildScheduleEmailHtml(weeks[0]);
    const pdfAttachments = (Array.isArray(attachments) ? attachments : [])
      .filter((a) => a && a.b64 && a.filename)
      .map((a) => ({ filename: a.filename, b64: a.b64, mime: "application/pdf" }));
    const labeler = makeLabeler(accessToken);
    let labelId = null;
    try { labelId = await labeler.ensure(LABELS.sentSchedules); } catch { /* non-fatal */ }

    let sent = 0;
    const failures = [];
    for (const r of recipients) {
      try {
        const raw = buildHtmlRawEmail({
          to: r.personal_email, subject, text, html,
          images: [{ cid: "haenyeo-icon", b64: HAENYEO_ICON_B64 }],
          attachments: pdfAttachments,
        });
        const msg = await sendMessage(accessToken, { raw });
        if (labelId && msg?.id) await modifyMessage(accessToken, msg.id, { addLabelIds: [labelId] }).catch(() => {});
        sent++;
      } catch (e) {
        failures.push(`${r.name}: ${e.message}`);
      }
    }
    return res.status(200).json({ sent, recipients: recipients.length, failures });
  } catch (e) {
    console.error(`[send-schedule] ${e.message}`);
    return res.status(200).json({ sent: 0, error: e.message });
  }
}
