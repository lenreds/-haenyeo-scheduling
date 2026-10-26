// POST /api/send-schedule — emails one or more weeks' schedule to registered staff.
// GET (manager JWT) -> { copyEmail } = env COMPANY_COPY_EMAIL (fallback
// SCHEDULE_COPY_EMAIL), the company inbox added as one more recipient — real sends
// and tests — when the POST carries includeCopy: true.
// Manager-JWT auth. Body: { weeks:[weekPayload,…], sections?:["FOH"|"BOH"|"Kitchen"|"Management"],
// attachments?:[{filename,b64}] } where each weekPayload is
// { weekLabel, dayHeaders:[7], rows:[{name,shifts:[7],roles?,primaryRole?}] OR
// groups:[{label,rows}], sectionLabel?, days?:[{dow,date}×7], todayIdx?, managerOn? }.
// Legacy single-week bodies (those same fields at the top level, no `weeks`) still
// work. Every week in the call goes in ONE email; `attachments` are PDF files
// (one per week). `sections` restricts recipients by staff.section
// (case-insensitive); omitted = all registered. The body is one line ("Schedule
// for Oct 26 – Nov 1 attached.") plus the manager's message — the PDFs carry the
// schedule. A real send also copies the signed-in manager (see
// _lib/schedule-recipients.js). One message per recipient (see
// _lib/send-each.js); tagged Sent/Schedules.

import { sendToEach } from "./_lib/send-each.js";
import { companyCopyEmail } from "./_lib/config.js";
import { gmailAccessToken, gmailErrorFields } from "./_lib/gmail-auth.js";
import { buildHtmlRawEmail } from "./_lib/reply.js";
import { buildScheduleAttachedEmail } from "./_lib/emails.js";
import { scheduleRecipients } from "./_lib/schedule-recipients.js";
import { personalLinesFor, personalLineReport } from "./_lib/personal-lines.js";
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
  //   notes        — the manager's message, under the first line;
  //   recipientIds — staff ids ticked in the dialog. Only registered staff with
  //                  those ids are emailed; addresses always come from the DB.
  //                  Tests send them too, only for the personal-line count;
  //   personalLines — Front of House only: each FOH recipient's own shifts go
  //                  in their body; the sender's copy gets the match count;
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

  // Every attachment must be a real PDF ("JVBERi0" = "%PDF-" in base64). One bad
  // file means nothing is sent — same rule as the Tip Sheet.
  const rawAttachments = Array.isArray(attachments) ? attachments : [];
  if (rawAttachments.some((a) => !a?.filename || !String(a?.b64 || "").startsWith("JVBERi0"))) {
    return res.status(400).json({ sent: 0, error: "a schedule PDF is missing or invalid — nothing was sent" });
  }
  const pdfAttachments = rawAttachments.map((a) => ({ filename: a.filename, b64: a.b64, mime: "application/pdf" }));

  try {
    // Who gets it — see _lib/schedule-recipients.js. The sender's address
    // always comes from their JWT, never the client: it's the test recipient,
    // and on a real send it gets its own copy of every section sent.
    const me = await managerEmail(token);
    const copy = body.includeCopy === true ? companyCopyEmail() : null;
    // personalLines: the Front of House email (the client sets it on that
    // section only) — each FOH recipient gets their own shifts in the body.
    const personal = body.personalLines === true;
    const staff = !test || personal ? await fetchRegisteredStaff() : [];
    const picked = scheduleRecipients({ test, me, copy, sections, recipientIds: body.recipientIds, staff });
    if (picked.error) return res.status(400).json({ sent: 0, error: picked.error });
    const { recipients, senderCopy } = picked;

    // The sender's check on the personal lines: how many of the staff this
    // section reaches got one. A test reports on the staff the real send
    // would reach, so the [TEST] copy carries the same count.
    let report = null;
    if (personal) {
      const audience = test
        ? scheduleRecipients({ test: false, me: null, copy: null, sections, recipientIds: body.recipientIds, staff }).recipients || []
        : recipients;
      report = personalLineReport(weeks, audience.filter((r) => r.id != null));
    }

    const { accessToken } = await gmailAccessToken("send-schedule");
    // The PDFs carry the schedule; the body is one line + the manager's
    // message, plus (FOH) that person's own shifts and (sender) the count.
    const bodyFor = (r) => buildScheduleAttachedEmail({ weeks }, {
      subject: wantSubject, notes,
      personal: personal && r?.id != null ? personalLinesFor(weeks, r.id) : null,
      check: report && r?.sender ? report.line : null,
    });
    const baseSubject = bodyFor(null).subject;
    // Identical email to the real send, except the [TEST] tag (always the server's call).
    const subject = test ? `[TEST] ${baseSubject}` : baseSubject;
    const labeler = makeLabeler(accessToken);
    let labelId = null;
    try { labelId = await labeler.ensure(LABELS.sentSchedules); } catch { /* non-fatal */ }

    // One message per recipient (the company inbox and the sender copy are
    // simply two of them).
    const result = await sendToEach({
      accessToken, recipients, labelId,
      buildRaw: (to, r) => {
        const { text, html } = bodyFor(r);
        return buildHtmlRawEmail({ to, subject, text, html, attachments: pdfAttachments });
      },
    });
    if (result.invalid.length) {
      console.warn(`[send-schedule] skipped malformed addresses: ${result.invalid.map((r) => `${r.name} <${r.email}>`).join(", ")}`);
    }
    if (result.failures.length) console.warn(`[send-schedule] failed: ${result.failures.join("; ")}`);
    if (report?.unmatched.length) console.warn(`[send-schedule] no personal line for: ${report.unmatched.join(", ")}`);
    // senderCopy: the address the sender's copy went to, or null if there was
    // none (no address in the JWT) or it didn't go out.
    const mine = recipients.find((r) => r.sender);
    const senderMissed = !senderCopy || !mine || result.failures.some((f) => f.startsWith(`${mine.name || mine.email}:`));
    return res.status(200).json({
      sent: result.sent, recipients: result.attempted, copied: !!copy,
      invalid: result.invalid, failures: result.failures, test,
      senderCopy: test || senderMissed ? null : senderCopy,
      ...(report ? { personal: { matched: report.matched, total: report.total, unmatched: report.unmatched } } : {}),
      ...(result.error ? { error: result.error } : {}),
    });
  } catch (e) {
    console.error(`[send-schedule] ${e.message}`);
    return res.status(200).json({ sent: 0, ...gmailErrorFields(e) });
  }
}
