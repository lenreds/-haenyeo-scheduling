// POST /api/manual-rail — logs an in-person scheduling request from the Rail
// tab's "+ Add Request" form. Manager-JWT auth. Body: { staffId, type, dates,
// note?, loggedBy }. Inserts the pending rail row first (source 'manual', no
// gmail ids — the reply flow already skips rows without a thread), then
// best-effort sends two confirmations: a [MANUAL ENTRY] paper-trail copy to
// the scheduling inbox (tagged Requests/<Type>) and a confirmation to the
// staff member's personal email if registered. Email failures never roll back
// the row. The poller ignores [MANUAL ENTRY] subjects (it only matches
// SCHEDULING / REGISTER / "UPDATE INFO"), so the self-sent copy is never
// re-ingested as a duplicate rail entry.

import { GMAIL_REFRESH_TOKEN } from "./_lib/config.js";
import { getAccessToken, sendMessage, modifyMessage } from "./_lib/google.js";
import { buildRawEmail } from "./_lib/reply.js";
import { buildManualEntryInboxEmail, buildManualEntryStaffEmail } from "./_lib/emails.js";
import { makeLabeler, incomingLabelForType } from "./_lib/labels.js";
import { getGmailToken, isManager, insertManualRail, getStaffById } from "./_lib/store.js";

const TYPES = ["REQUEST OFF", "SHIFT SWAP", "COVERAGE REQUEST", "TIME OFF"];
const INBOX_FALLBACK = "haenyeo.schedule@gmail.com";

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!(await isManager(token))) return res.status(401).json({ error: "unauthorized" });

  const body = readBody(req);
  const staffId = body.staffId;
  const type = String(body.type || "").toUpperCase();
  const dates = String(body.dates || "").trim();
  const note = String(body.note || "").trim();
  const loggedBy = String(body.loggedBy || "").trim();
  if (!staffId || !TYPES.includes(type) || !dates || !loggedBy) {
    return res.status(400).json({ error: "staffId, type, dates, loggedBy required" });
  }

  try {
    const staff = await getStaffById(staffId);
    if (!staff) return res.status(400).json({ error: "staff_not_found" });

    const inserted = await insertManualRail({ staffId, type, dates, note, loggedBy });

    // Emails are best-effort — the rail row is already in the pending queue.
    let inboxSent = false;
    let staffSent = false;
    let emailError = null;
    try {
      const tokenRow = await getGmailToken();
      const refreshToken = tokenRow?.refresh_token || GMAIL_REFRESH_TOKEN;
      if (!refreshToken) throw new Error("gmail_not_connected");
      const accessToken = await getAccessToken(refreshToken);

      const inbox = buildManualEntryInboxEmail({
        managerName: loggedBy, staffName: staff.name, type, dates, note,
      });
      const msg = await sendMessage(accessToken, {
        raw: buildRawEmail({ to: tokenRow?.email || INBOX_FALLBACK, subject: inbox.subject, body: inbox.body }),
      });
      inboxSent = true;
      // A self-sent message is one message carrying both SENT and INBOX, so
      // labeling msg.id tags the inbox copy.
      const labelName = incomingLabelForType(type);
      if (labelName && msg?.id) {
        try {
          const labelId = await makeLabeler(accessToken).ensure(labelName);
          await modifyMessage(accessToken, msg.id, { addLabelIds: [labelId] });
        } catch { /* labeling is non-fatal */ }
      }

      if (staff.registered && staff.personal_email) {
        const conf = buildManualEntryStaffEmail({ staffName: staff.name, type, dates, note });
        await sendMessage(accessToken, {
          raw: buildRawEmail({ to: staff.personal_email, subject: conf.subject, body: conf.body }),
        });
        staffSent = true;
      }
    } catch (e) {
      emailError = e.message;
    }

    return res.status(200).json({ ok: true, railId: inserted?.id || null, inboxSent, staffSent, emailError });
  } catch (e) {
    console.error(`[manual-rail] ${e.message}`);
    return res.status(500).json({ error: e.message });
  }
}
