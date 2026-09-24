// POST /api/send-tipsheet — emails the Tip Sheet PDF (the same page Save as PDF
// produces, rendered client-side) to each worker who has a registered email.
// Manager-JWT auth. Body: { dayDateLabel, attachment: { filename, b64 },
// recipients: [{ name, email }], subject?, notes? }. The client decides
// recipients (it holds the tip math) and passes the subject line and optional
// notes the manager confirmed on the send screen. The body is just those notes
// plus the sign-off; each sent copy is tagged Sent/Tip Sheets.

import { sendMessage, modifyMessage } from "./_lib/google.js";
import { gmailAccessToken, gmailErrorFields } from "./_lib/gmail-auth.js";
import { buildRawEmail } from "./_lib/reply.js";
import { buildTipSheetEmail } from "./_lib/emails.js";
import { makeLabeler, LABELS } from "./_lib/labels.js";
import { isManager } from "./_lib/store.js";

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!(await isManager(token))) return res.status(401).json({ error: "unauthorized" });

  const b = readBody(req);
  const recipients = Array.isArray(b.recipients) ? b.recipients : [];
  if (!b.dayDateLabel) return res.status(400).json({ error: "dayDateLabel required" });
  // The PDF IS the tip sheet — never email without it. "JVBERi0" is "%PDF-"
  // in base64, so a truncated or wrong payload is refused, not sent.
  const pdf = b.attachment;
  if (!pdf?.b64 || !String(pdf.b64).startsWith("JVBERi0")) {
    return res.status(400).json({ sent: 0, error: "tip sheet PDF missing or invalid — nothing was sent" });
  }
  const attachments = [{ filename: pdf.filename || "Haenyeo-TipSheet.pdf", b64: pdf.b64, mime: "application/pdf" }];

  try {
    const { accessToken } = await gmailAccessToken("send-tipsheet");
    const labeler = makeLabeler(accessToken);
    let labelId = null;
    try { labelId = await labeler.ensure(LABELS.sentTipSheets); } catch { /* non-fatal */ }

    let sent = 0;
    const failures = [];
    for (const r of recipients) {
      if (!r.email) continue;
      try {
        const { subject, body } = buildTipSheetEmail({ dayDateLabel: b.dayDateLabel, subject: b.subject, notes: b.notes });
        const raw = buildRawEmail({ to: r.email, subject, body, attachments });
        const msg = await sendMessage(accessToken, { raw });
        if (labelId && msg?.id) await modifyMessage(accessToken, msg.id, { addLabelIds: [labelId] }).catch(() => {});
        sent++;
      } catch (e) {
        failures.push(`${r.name}: ${e.message}`);
      }
    }
    return res.status(200).json({ sent, recipients: recipients.length, failures });
  } catch (e) {
    console.error(`[send-tipsheet] ${e.message}`);
    return res.status(200).json({ sent: 0, ...gmailErrorFields(e) });
  }
}
