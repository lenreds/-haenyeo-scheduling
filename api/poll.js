// /api/poll — reads the scheduling inbox and processes unread emails:
//   * [SCHEDULING] – … (incl. TIME OFF) -> pending rail_requests
//   * [REGISTER] – Name – CODE          -> register staff + welcome email
//   * [UPDATE INFO] – Name – CODE        -> pending staff_info_updates
// Applies Gmail labels and marks each processed message read. Invoked by Vercel
// Cron (Bearer CRON_SECRET) or a signed-in manager's "Check now" (Supabase JWT).
// Never auto-approves anything.

import { CRON_SECRET, GMAIL_REFRESH_TOKEN, STAFF_REGISTER_CODE } from "./_lib/config.js";
import {
  getAccessToken, listActionableUnread, getMessage, modifyMessage, sendMessage,
} from "./_lib/google.js";
import {
  parseSchedulingSubject, parseRegisterSubject, parseUpdateInfoSubject, codeMatches,
  matchStaff, matchStaffFuzzy, parsePhoneFromBody, parseUpdateFields, extractPlainText, headerValue,
} from "./_lib/parse.js";
import { makeLabeler, LABELS, incomingLabelForType } from "./_lib/labels.js";
import { buildRawEmail } from "./_lib/reply.js";
import { buildWelcomeEmail, buildNameNotMatchedReply } from "./_lib/emails.js";
import {
  admin, getGmailToken, recordPoll, fetchStaffMinimal, insertGmailRail, gmailMessageExists,
  registerStaffContact, insertInfoUpdate,
} from "./_lib/store.js";

async function authorize(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return false;
  if (CRON_SECRET && token === CRON_SECRET) return true; // Vercel Cron
  try {
    const { data, error } = await admin().auth.getUser(token);
    return !error && !!data?.user;
  } catch {
    return false;
  }
}

const emailAddr = (h) => {
  const m = String(h || "").match(/<([^>]+)>/);
  return (m ? m[1] : h || "").trim();
};

export default async function handler(req, res) {
  if (!(await authorize(req))) return res.status(401).json({ error: "unauthorized" });

  const s = { connected: false, processed: 0, railCreated: 0, registered: 0, infoUpdates: 0, duplicates: 0, skipped: 0, unmatched: 0 };
  try {
    const tokenRow = await getGmailToken();
    const refreshToken = tokenRow?.refresh_token || GMAIL_REFRESH_TOKEN;
    if (!refreshToken) {
      await recordPoll({ ok: false, error: "Gmail not connected (no refresh token)" });
      return res.status(200).json({ ...s, connected: false, reason: "not_connected" });
    }

    const accessToken = await getAccessToken(refreshToken);
    const staff = await fetchStaffMinimal();
    const labeler = makeLabeler(accessToken);
    const messages = await listActionableUnread(accessToken);

    // Apply a label (best-effort) and mark the message read in one modify call.
    const finish = async (id, labelName) => {
      let addLabelIds = [];
      if (labelName) {
        try { addLabelIds = [await labeler.ensure(labelName)]; }
        catch (e) { console.warn(`[poll] label "${labelName}" failed: ${e.message}`); }
      }
      await modifyMessage(accessToken, id, { addLabelIds, removeLabelIds: ["UNREAD"] })
        .catch((e) => console.warn(`[poll] modify ${id} failed: ${e.message}`));
    };

    // Send an email (optionally threaded) and tag the sent copy with a label.
    const sendTagged = async ({ to, subject, body, threadId, inReplyTo }, labelName) => {
      const raw = buildRawEmail({ to, subject, inReplyTo, body });
      const sent = await sendMessage(accessToken, threadId ? { raw, threadId } : { raw });
      if (labelName && sent?.id) {
        try { await modifyMessage(accessToken, sent.id, { addLabelIds: [await labeler.ensure(labelName)] }); }
        catch (e) { console.warn(`[poll] tag sent ${sent.id} failed: ${e.message}`); }
      }
    };

    for (const { id } of messages) {
      s.processed++;
      try {
        const msg = await getMessage(accessToken, id);
        const subject = headerValue(msg, "Subject");
        const from = headerValue(msg, "From");
        const senderEmail = emailAddr(from);
        const messageId = headerValue(msg, "Message-ID");

        // ---- [REGISTER] ----
        if (/^\s*\[REGISTER\]/i.test(subject)) {
          const parsed = parseRegisterSubject(subject);
          if (!parsed || !codeMatches(parsed.code, STAFF_REGISTER_CODE)) {
            // malformed or wrong code word → ignore silently
            s.skipped++;
            await finish(id, null);
            continue;
          }
          const match = matchStaffFuzzy(parsed.name, staff);
          if (match) {
            const phone = parsePhoneFromBody(extractPlainText(msg));
            await registerStaffContact(match.id, { email: senderEmail, phone });
            const welcome = buildWelcomeEmail(match.name);
            await sendTagged({ to: senderEmail, subject: welcome.subject, body: welcome.body }, LABELS.sentWelcome)
              .catch((e) => console.error(`[poll] welcome send failed: ${e.message}`));
            s.registered++;
          } else {
            const nm = buildNameNotMatchedReply(parsed.name);
            const subj = /^re:/i.test(subject) ? subject : `Re: ${subject}`;
            await sendTagged({ to: senderEmail, subject: subj, body: nm.body, threadId: msg.threadId, inReplyTo: messageId }, LABELS.sentReplies)
              .catch((e) => console.error(`[poll] not-matched reply failed: ${e.message}`));
            s.unmatched++;
          }
          await finish(id, LABELS.registrations);
          continue;
        }

        // ---- [UPDATE INFO] ----
        if (/^\s*\[UPDATE INFO\]/i.test(subject)) {
          const parsed = parseUpdateInfoSubject(subject);
          if (!parsed || !codeMatches(parsed.code, STAFF_REGISTER_CODE)) { s.skipped++; await finish(id, null); continue; }
          const match = matchStaffFuzzy(parsed.name, staff);
          if (!match) { s.unmatched++; await finish(id, LABELS.infoUpdates); continue; }
          const fields = parseUpdateFields(extractPlainText(msg));
          if (fields.email || fields.phone) {
            await insertInfoUpdate({ staffId: match.id, newEmail: fields.email, newPhone: fields.phone });
            s.infoUpdates++;
          } else {
            s.skipped++;
          }
          await finish(id, LABELS.infoUpdates);
          continue;
        }

        // ---- [SCHEDULING] – … (incl. TIME OFF) ----
        if (/^\s*\[SCHEDULING\]/i.test(subject)) {
          if (await gmailMessageExists(id)) { s.duplicates++; await finish(id, null); continue; }
          const parsed = parseSchedulingSubject(subject);
          if (!parsed) { s.skipped++; await finish(id, null); continue; }
          const match = matchStaff(parsed.name, staff);
          if (!match) s.unmatched++;
          const result = await insertGmailRail({
            staffId: match?.id || null,
            unmatchedName: match ? null : parsed.name,
            type: parsed.type,
            dates: parsed.date,
            note: extractPlainText(msg),
            messageId: id,
            threadId: msg.threadId || null,
          });
          if (result.duplicate) s.duplicates++; else s.railCreated++;
          await finish(id, incomingLabelForType(parsed.type));
          continue;
        }

        // ---- unrecognized ----
        s.skipped++;
        await finish(id, null);
      } catch (msgErr) {
        console.error(`[poll] message ${id} failed: ${msgErr.message}`);
      }
    }

    s.connected = true;
    await recordPoll({ ok: true });
    return res.status(200).json(s);
  } catch (e) {
    console.error(`[poll] failed: ${e.message}`);
    await recordPoll({ ok: false, error: e.message }).catch(() => {});
    return res.status(200).json({ ...s, connected: false, error: e.message });
  }
}
