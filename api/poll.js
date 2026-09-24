// /api/poll — reads the scheduling inbox and processes unread emails:
//   * [SCHEDULING] – … (incl. TIME OFF) -> pending rail_requests
//   * [REGISTER] – Name – CODE          -> register staff + welcome email
//   * [UPDATE INFO] – Name – CODE        -> pending staff_info_updates
// Applies Gmail labels and marks each processed message read. Invoked by Vercel
// Cron (Bearer CRON_SECRET) or a signed-in manager's "Check now" (Supabase JWT).
// Never auto-approves anything.

import { CRON_SECRET, STAFF_REGISTER_CODE } from "./_lib/config.js";
import { gmailAccessToken, gmailErrorFields } from "./_lib/gmail-auth.js";
import {
  listActionableUnread, getMessage, modifyMessage, sendMessage,
} from "./_lib/google.js";
import {
  parseSchedulingSubject, parseRegisterSubject, parseUpdateInfoSubject, codeMatches,
  matchStaff, matchStaffFuzzy, parsePhoneFromBody, parseUpdateFields, extractPlainText, headerValue,
  parseSchedulingKeywords, extractDatesFromSubject, matchStaffByEmail,
} from "./_lib/parse.js";
import { makeLabeler, LABELS, incomingLabelForType } from "./_lib/labels.js";
import { buildRawEmail } from "./_lib/reply.js";
import { buildWelcomeEmail, buildNameNotMatchedReply } from "./_lib/emails.js";
import {
  admin, recordPoll, fetchStaffMinimal, insertGmailRail, gmailMessageExists,
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

  if (!STAFF_REGISTER_CODE) {
    console.error("[poll] STAFF_REGISTER_CODE not set in environment");
  }

  const s = { connected: false, processed: 0, railCreated: 0, registered: 0, infoUpdates: 0, duplicates: 0, skipped: 0, unmatched: 0 };
  try {
    let accessToken;
    try {
      ({ accessToken } = await gmailAccessToken("poll"));
    } catch (e) {
      if (e.code === "gmail_not_connected") {
        await recordPoll({ ok: false, error: "Gmail not connected (no refresh token)" }).catch(() => {});
        return res.status(200).json({ ...s, connected: false, reason: "not_connected" });
      }
      // A rejected grant is already recorded (AUTH: last_error) by
      // gmailAccessToken — writing recordPoll here would overwrite that marker
      // and turn the Rail dot green-ish again. Only stamp the poll time.
      if (e.needsReconnect) {
        await recordPoll({ ok: false }).catch(() => {});
        return res.status(200).json({ ...s, connected: false, ...gmailErrorFields(e) });
      }
      throw e;
    }
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
          if (!parsed) {
            console.warn(`[poll] [REGISTER] malformed subject: "${subject}"`);
            s.skipped++;
            await finish(id, null);
            continue;
          }
          if (!codeMatches(parsed.code, STAFF_REGISTER_CODE)) {
            console.warn(`[poll] [REGISTER] wrong code for ${parsed.name}: got "${parsed.code}", expected "${STAFF_REGISTER_CODE}"`);
            s.skipped++;
            await finish(id, null);
            continue;
          }
          const match = matchStaffFuzzy(parsed.name, staff);
          if (match) {
            try {
              const phone = parsePhoneFromBody(extractPlainText(msg));
              await registerStaffContact(match.id, { email: senderEmail, phone });
              const welcome = buildWelcomeEmail(match.name);
              await sendTagged({ to: senderEmail, subject: welcome.subject, body: welcome.body }, LABELS.sentWelcome)
                .catch((e) => console.error(`[poll] welcome send failed for ${match.name}: ${e.message}`));
              s.registered++;
              console.log(`[poll] [REGISTER] registered ${match.name} (${senderEmail})`);
            } catch (e) {
              console.error(`[poll] [REGISTER] registration failed for ${parsed.name}: ${e.message}`);
              s.skipped++;
            }
          } else {
            console.warn(`[poll] [REGISTER] no fuzzy match for "${parsed.name}" from ${senderEmail}`);
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

        // ---- Keyword-based scheduling (simplified email) ----
        // Any email from a registered staff address with scheduling keywords
        const registeredStaff = staff.filter((r) => r.registered && r.personal_email);
        const matchByEmail = matchStaffByEmail(senderEmail, registeredStaff);
        const parsed = parseSchedulingKeywords(subject);
        // Log only mail that plausibly concerns us — a known sender, or a
        // scheduling keyword from an unknown one. The inbox sweep sees plenty of
        // unrelated mail that would otherwise flood the logs. onFile is a count,
        // never the addresses themselves: enough to spot "nobody has an email
        // saved" without copying staff contact details into the log stream.
        if (matchByEmail || parsed) {
          console.log(
            `[poll] keyword-match from="${senderEmail}" subject="${subject}" ` +
            `sender=${matchByEmail ? matchByEmail.name : "NO_MATCH"} ` +
            `type=${parsed ? parsed.type : "NO_KEYWORD"} ` +
            `onFile=${registeredStaff.length}/${staff.length}`
          );
        }
        if (matchByEmail) {
          if (parsed) {
            if (await gmailMessageExists(id)) { s.duplicates++; await finish(id, null); continue; }
            const dates = extractDatesFromSubject(subject);
            const result = await insertGmailRail({
              staffId: matchByEmail.id,
              unmatchedName: null,
              type: parsed.type,
              dates: dates.length > 0 ? dates.join(", ") : "",
              note: extractPlainText(msg),
              messageId: id,
              threadId: msg.threadId || null,
            });
            if (result.duplicate) s.duplicates++; else s.railCreated++;

            // Send auto-reply on successful card creation
            const autoReplyText = `Hi ${matchByEmail.name},

Got your message — we've logged your request and will get back to you soon.

— Haenyeo Management`;
            const subj = /^re:/i.test(subject) ? subject : `Re: ${subject}`;
            await sendTagged(
              {
                to: senderEmail,
                subject: subj,
                body: autoReplyText,
                threadId: msg.threadId,
                inReplyTo: messageId,
              },
              LABELS.sentReplies
            ).catch((e) => console.error(`[poll] auto-reply failed for ${matchByEmail.name}: ${e.message}`));

            await finish(id, incomingLabelForType(parsed.type));
            continue;
          }
        }

        // ---- unrecognized ----
        // Tagged mail is ours to file away, so it still gets marked read.
        // Anything else came from the wider inbox sweep and isn't a scheduling
        // request — leave it unread and unlabeled so the manager still sees it.
        s.skipped++;
        if (/SCHEDULING|REGISTER|UPDATE INFO/i.test(subject)) await finish(id, null);
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
