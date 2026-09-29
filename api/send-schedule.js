// POST /api/send-schedule — emails one or more weeks' schedule to registered staff.
// GET (manager JWT) -> { copyEmail } = env COMPANY_COPY_EMAIL (fallback
// SCHEDULE_COPY_EMAIL), the company inbox added to the Bcc list — real sends
// and tests — when the POST carries includeCopy: true.
// Manager-JWT auth. Body: { weeks:[weekPayload,…], sections?:["FOH"|"BOH"|"Kitchen"|"Management"],
// attachments?:[{filename,b64}] } where each weekPayload is
// { weekLabel, dayHeaders:[7], rows:[{name,shifts:[7],roles?,primaryRole?}] OR
// groups:[{label,rows}], sectionLabel?, days?:[{dow,date}×7], todayIdx?, managerOn? }.
// Legacy single-week bodies (those same fields at the top level, no `weeks`) still
// work. 2+ weeks stack in one email; `attachments` are PDF files (one per week).
// `sections` restricts recipients by staff.section (case-insensitive); omitted =
// all registered. Sends the branded HTML sheet (plain-text alternative + the
// real icon as an inline CID image). ONE message per call, To the scheduling
// inbox with every recipient in Bcc (see _lib/bcc-send.js); tagged Sent/Schedules.

import { sendOneBcc } from "./_lib/bcc-send.js";
import { companyCopyEmail } from "./_lib/config.js";
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
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  // GET = the Publish dialog asking which company address a real send would
  // copy, so it can show it as its own line. Managers only.
  if (req.method === "GET") {
    if (!(await isManager(token))) return res.status(401).json({ error: "unauthorized" });
    return res.status(200).json({ copyEmail: companyCopyEmail() });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!(await isManager(token))) return res.status(401).json({ error: "unauthorized" });

  const body = readBody(req);
  const { sections, attachments } = body;
  // Publish dialog fields (all optional — older clients omit them):
  //   subject      — the confirmed subject line;
  //   notes        — the manager's message, above the schedule;
  //   recipientIds — staff ids ticked in the dialog. Only registered staff with
  //                  those ids are emailed; addresses always come from the DB;
  //   includeCopy  — the company inbox line was ticked (real sends AND tests);
  //   test         — send only to the signed-in manager (address from their
  //                  JWT, never the client) plus the company inbox if
  //                  includeCopy, subject prefixed "[TEST]". This
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
    // Who gets it, as [{ name, email }]. test: the signed-in manager (address
    // from their JWT, never the client). Real: registered staff by section and
    // by the ids ticked in the dialog (addresses from the DB). Either way the
    // company inbox rides in the same Bcc list when its line was ticked — on a
    // test too, so the setup can be checked without emailing staff.
    let recipients;
    if (test) {
      const me = await managerEmail(token);
      if (!me) return res.status(400).json({ sent: 0, error: "couldn't find your sign-in email for the test" });
      recipients = [{ name: "Test (you)", email: me }];
    } else {
      let staff = await fetchRegisteredStaff();
      if (Array.isArray(sections) && sections.length) {
        const want = sections.map((s) => String(s).toLowerCase());
        staff = staff.filter((r) => want.includes(String(r.section || "").toLowerCase()));
      }
      if (Array.isArray(body.recipientIds)) {
        const ids = new Set(body.recipientIds.map(String));
        staff = staff.filter((r) => ids.has(String(r.id)));
      }
      recipients = staff.map((r) => ({ name: r.name, email: r.personal_email }));
    }
    const copy = body.includeCopy === true ? companyCopyEmail() : null;
    if (copy) recipients.push({ name: "Company inbox", email: copy });

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

    // ONE message for the whole section: To the scheduling inbox, everyone in Bcc.
    const result = await sendOneBcc({
      accessToken, recipients, labelId,
      buildRaw: ({ to, bcc }) => buildHtmlRawEmail({
        to, bcc, subject, text, html,
        images: [{ cid: "haenyeo-icon", b64: HAENYEO_ICON_B64 }],
        attachments: pdfAttachments,
      }),
    });
    if (result.invalid.length) {
      console.warn(`[send-schedule] skipped malformed addresses: ${result.invalid.map((r) => `${r.name} <${r.email}>`).join(", ")}`);
    }
    if (!result.messages) {
      return res.status(200).json({ sent: 0, error: "no valid email addresses to send to", invalid: result.invalid, test });
    }
    return res.status(200).json({
      sent: result.sent, messages: 1, recipients: recipients.length,
      copied: !!copy, invalid: result.invalid, failures: [], test,
    });
  } catch (e) {
    console.error(`[send-schedule] ${e.message}`);
    return res.status(200).json({ sent: 0, ...gmailErrorFields(e) });
  }
}
