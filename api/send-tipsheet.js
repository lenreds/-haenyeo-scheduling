// POST /api/send-tipsheet — emails the finalized tip sheet to each worker who
// has a registered email, personalizing the "YOUR PAYOUT" line. Manager-JWT auth.
// Body: { dayDateLabel, floorPool, rows:[{name,position,points,hours,final}],
// barTipOut, barRecipients, floorCheckText, recipients:[{name,email,payout}],
// subject?, notes? }. The client decides recipients (it holds the tip math) and
// passes the subject line and optional message notes the manager confirmed on
// the send screen; tagged Sent/Tip Sheets.

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
        const { subject, body } = buildTipSheetEmail({
          dayDateLabel: b.dayDateLabel,
          floorPool: b.floorPool,
          rows: b.rows || [],
          barTipOut: b.barTipOut,
          barRecipients: b.barRecipients,
          floorCheckText: b.floorCheckText || "",
          recipientName: r.name,
          recipientPayout: r.payout,
          subject: b.subject,
          notes: b.notes,
        });
        const raw = buildRawEmail({ to: r.email, subject, body });
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
