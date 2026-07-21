// POST /api/send-tipsheet — emails the finalized tip sheet to each worker who
// has a registered email, personalizing the "YOUR PAYOUT" line. Manager-JWT auth.
// Body: { dayDateLabel, floorPool, rows:[{name,position,points,hours,final}],
// barTipOut, barRecipients, floorCheckText, recipients:[{name,email,payout}] }.
// The client decides recipients (it holds the tip math); tagged Sent/Tip Sheets.

import { GMAIL_REFRESH_TOKEN } from "./_lib/config.js";
import { getAccessToken, sendMessage, modifyMessage } from "./_lib/google.js";
import { buildRawEmail } from "./_lib/reply.js";
import { buildTipSheetEmail } from "./_lib/emails.js";
import { makeLabeler, LABELS } from "./_lib/labels.js";
import { getGmailToken, isManager } from "./_lib/store.js";

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
    const tokenRow = await getGmailToken();
    const refreshToken = tokenRow?.refresh_token || GMAIL_REFRESH_TOKEN;
    if (!refreshToken) return res.status(200).json({ sent: 0, error: "gmail_not_connected" });

    const accessToken = await getAccessToken(refreshToken);
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
    return res.status(200).json({ sent: 0, error: e.message });
  }
}
