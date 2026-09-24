// POST /api/reply — sends the staff auto-reply after a manager approves/denies a
// Rail request. Called by the client right after the approve/deny action, with
// the manager's Supabase JWT. Best-effort: never blocks the approval — if the
// request has no thread id (manually created entry) it skips silently; other
// failures return { sent:false, error } with HTTP 200.

import { getMessage, sendMessage, modifyMessage } from "./_lib/google.js";
import { gmailAccessToken, gmailErrorFields } from "./_lib/gmail-auth.js";
import { headerValue } from "./_lib/parse.js";
import { buildReplyBody, buildRawEmail } from "./_lib/reply.js";
import { makeLabeler, LABELS } from "./_lib/labels.js";
import { getRailRequestById, isManager } from "./_lib/store.js";

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!(await isManager(token))) return res.status(401).json({ error: "unauthorized" });

  const { railRequestId, approved, managerNote, partial, approvedDatesText } = readBody(req);
  if (!railRequestId || typeof approved !== "boolean") {
    return res.status(400).json({ error: "railRequestId and approved are required" });
  }

  try {
    const reqRow = await getRailRequestById(railRequestId);
    if (!reqRow) return res.status(404).json({ error: "rail request not found" });

    // No thread to reply into (manual entry) → skip silently per the brief.
    if (!reqRow.gmail_thread_id || !reqRow.gmail_message_id) {
      console.warn(`[reply] no thread/message id for ${railRequestId} — skipping email`);
      return res.status(200).json({ sent: false, skipped: "no_thread" });
    }

    const { accessToken } = await gmailAccessToken("reply");

    // Pull the original message for the recipient + threading headers.
    const original = await getMessage(accessToken, reqRow.gmail_message_id);
    const from = headerValue(original, "From");           // "Bernie <bernie@…>"
    const origSubject = headerValue(original, "Subject") || "Your scheduling request";
    const messageId = headerValue(original, "Message-ID"); // "<...@mail.gmail.com>"
    const subject = /^re:/i.test(origSubject) ? origSubject : `Re: ${origSubject}`;

    const body = buildReplyBody({
      type: reqRow.type,
      approved,
      partial: !!partial,
      name: reqRow.name,
      date: reqRow.dates,
      approvedDates: approvedDatesText || "",
      note: managerNote,
    });
    const raw = buildRawEmail({ to: from, subject, inReplyTo: messageId, body });
    const sent = await sendMessage(accessToken, { raw, threadId: reqRow.gmail_thread_id });

    // Tag the sent reply (best-effort).
    if (sent?.id) {
      try {
        const labeler = makeLabeler(accessToken);
        await modifyMessage(accessToken, sent.id, { addLabelIds: [await labeler.ensure(LABELS.sentReplies)] });
      } catch (e) { console.warn(`[reply] label sent failed: ${e.message}`); }
    }

    return res.status(200).json({ sent: true });
  } catch (e) {
    console.error(`[reply] failed for ${railRequestId}: ${e.message}`);
    // Don't fail the manager's action — report and move on.
    return res.status(200).json({ sent: false, ...gmailErrorFields(e) });
  }
}
