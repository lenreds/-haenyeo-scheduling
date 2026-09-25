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

import { sendMessage, modifyMessage } from "./_lib/google.js";
import { gmailAccessToken, gmailErrorFields } from "./_lib/gmail-auth.js";
import { buildHtmlRawEmail } from "./_lib/reply.js";
import { buildScheduleEmailHtml, buildMultiWeekScheduleHtml } from "./_lib/emails.js";
import { HAENYEO_ICON_B64 } from "./_lib/brand.js";
import { makeLabeler, LABELS } from "./_lib/labels.js";
import { isManager, managerEmail, fetchRegisteredStaff } from "./_lib/store.js";

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
  // Publish dialog fields (all optional — older clients omit them):
  //   subject      — the confirmed subject line;
  //   notes        — the manager's message, above the schedule;
  //   recipientIds — staff ids ticked in the dialog. Only registered staff with
  //                  those ids are emailed; addresses always come from the DB;
  //   test         — send ONLY to the signed-in manager (address from their
  //                  JWT, never the client), subject prefixed "[TEST]". This
  //                  endpoint never writes publish state either way — the
  //                  client marks weeks published, and only after a real send.
  const test = body.test === true;
  const notes = typeof body.notes === "string" ? body.notes : "";
  const wantSubject = typeof body.subject === "string" ? body.subject.replace(/^\s*\[TEST\]\s*/i, "").trim() : "";
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

  // Every attachment must be a real PDF ("JVBERi0" = "%PDF-" in base64). One bad
  // file means nothing is sent — same rule as the Tip Sheet.
  const rawAttachments = Array.isArray(attachments) ? attachments : [];
  if (rawAttachments.some((a) => !a?.filename || !String(a?.b64 || "").startsWith("JVBERi0"))) {
    return res.status(400).json({ sent: 0, error: "a schedule PDF is missing or invalid — nothing was sent" });
  }
  const pdfAttachments = rawAttachments.map((a) => ({ filename: a.filename, b64: a.b64, mime: "application/pdf" }));

  try {
    let recipients;
    if (test) {
      const email = await managerEmail(token);
      if (!email) return res.status(400).json({ sent: 0, error: "couldn't find your sign-in email for the test" });
      recipients = [{ name: "Test (you)", personal_email: email }];
    } else {
      recipients = await fetchRegisteredStaff();
      if (Array.isArray(sections) && sections.length) {
        const want = sections.map((s) => String(s).toLowerCase());
        recipients = recipients.filter((r) => want.includes(String(r.section || "").toLowerCase()));
      }
      if (Array.isArray(body.recipientIds)) {
        const ids = new Set(body.recipientIds.map(String));
        recipients = recipients.filter((r) => ids.has(String(r.id)));
      }
    }
    const { accessToken } = await gmailAccessToken("send-schedule");
    const email = weeks.length > 1
      ? buildMultiWeekScheduleHtml({ weeks, sectionLabel }, { subject: wantSubject, notes })
      : buildScheduleEmailHtml(weeks[0], { subject: wantSubject, notes });
    const { text, html } = email;
    // Identical email to the real send, except the [TEST] tag (always the server's call).
    const subject = test ? `[TEST] ${email.subject}` : email.subject;
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
    return res.status(200).json({ sent, recipients: recipients.length, failures, test });
  } catch (e) {
    console.error(`[send-schedule] ${e.message}`);
    return res.status(200).json({ sent: 0, ...gmailErrorFields(e) });
  }
}
