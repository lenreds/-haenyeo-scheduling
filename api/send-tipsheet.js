// POST /api/send-tipsheet — emails the Tip Sheet PDF (the same page Save as PDF
// produces, rendered client-side). Manager-JWT auth. Body: { dayDateLabel,
// attachment: { filename, b64 }, recipients: [{ name, email }], subject?,
// notes?, includeCopy?, test? }. The client decides recipients (it holds the
// tip math) and passes the subject line and optional notes the manager
// confirmed on the send screen. The body is just those notes plus the sign-off.
//
// One message per recipient (see _lib/send-each.js), tagged Sent/Tip Sheets.
// includeCopy gives the company inbox (env COMPANY_COPY_EMAIL, fallback
// SCHEDULE_COPY_EMAIL) its own copy.
// test: only the signed-in manager (address from their JWT, never the client)
// plus the company inbox if includeCopy, subject tagged "[TEST]". This endpoint
// never marks the sheet sent — the client does that, and only after a real send.

import { gmailAccessToken, gmailErrorFields } from "./_lib/gmail-auth.js";
import { buildRawEmail } from "./_lib/reply.js";
import { buildTipSheetEmail } from "./_lib/emails.js";
import { makeLabeler, LABELS } from "./_lib/labels.js";
import { isManager, managerEmail } from "./_lib/store.js";
import { sendToEach } from "./_lib/send-each.js";
import { companyCopyEmail } from "./_lib/config.js";

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!(await isManager(token))) return res.status(401).json({ error: "unauthorized" });

  const b = readBody(req);
  const test = b.test === true;
  if (!b.dayDateLabel) return res.status(400).json({ error: "dayDateLabel required" });
  // The PDF IS the tip sheet — never email without it. "JVBERi0" is "%PDF-"
  // in base64, so a truncated or wrong payload is refused, not sent.
  const pdf = b.attachment;
  if (!pdf?.b64 || !String(pdf.b64).startsWith("JVBERi0")) {
    return res.status(400).json({ sent: 0, error: "tip sheet PDF missing or invalid — nothing was sent" });
  }
  const attachments = [{ filename: pdf.filename || "Haenyeo-TipSheet.pdf", b64: pdf.b64, mime: "application/pdf" }];

  try {
    let recipients;
    if (test) {
      const me = await managerEmail(token);
      if (!me) return res.status(400).json({ sent: 0, error: "couldn't find your sign-in email for the test" });
      recipients = [{ name: "Test (you)", email: me }];
    } else {
      recipients = (Array.isArray(b.recipients) ? b.recipients : [])
        .filter((r) => r && r.email)
        .map((r) => ({ name: r.name || "", email: r.email }));
    }
    const copy = b.includeCopy === true ? companyCopyEmail() : null;
    if (copy) recipients.push({ name: "Company inbox", email: copy });

    const { accessToken } = await gmailAccessToken("send-tipsheet");
    const labeler = makeLabeler(accessToken);
    let labelId = null;
    try { labelId = await labeler.ensure(LABELS.sentTipSheets); } catch { /* non-fatal */ }

    const built = buildTipSheetEmail({ dayDateLabel: b.dayDateLabel, subject: b.subject, notes: b.notes });
    const subject = test ? `[TEST] ${built.subject.replace(/^\s*\[TEST\]\s*/i, "")}` : built.subject;
    const result = await sendToEach({
      accessToken, recipients, labelId,
      buildRaw: (to) => buildRawEmail({ to, subject, body: built.body, attachments }),
    });
    if (result.invalid.length) {
      console.warn(`[send-tipsheet] skipped malformed addresses: ${result.invalid.map((r) => `${r.name} <${r.email}>`).join(", ")}`);
    }
    if (result.failures.length) console.warn(`[send-tipsheet] failed: ${result.failures.join("; ")}`);
    return res.status(200).json({
      sent: result.sent, recipients: result.attempted, copied: !!copy,
      invalid: result.invalid, failures: result.failures, test,
      ...(result.error ? { error: result.error } : {}),
    });
  } catch (e) {
    console.error(`[send-tipsheet] ${e.message}`);
    return res.status(200).json({ sent: 0, ...gmailErrorFields(e) });
  }
}
