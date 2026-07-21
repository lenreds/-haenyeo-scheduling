// /api/poll — reads the scheduling inbox and turns matching unread emails into
// pending rail_requests. Invoked two ways:
//   * Vercel Cron (see vercel.json) with `Authorization: Bearer <CRON_SECRET>`
//   * a signed-in manager pressing "Check now" (Authorization: Bearer <supabase JWT>)
//
// Never auto-approves; every created entry is status='pending'. Subjects that
// don't match the convention are skipped silently (counted, not inserted).

import { CRON_SECRET, GMAIL_REFRESH_TOKEN } from "./_lib/config.js";
import { getAccessToken, listSchedulingUnread, getMessage, markRead } from "./_lib/google.js";
import { parseSchedulingSubject, matchStaff, extractPlainText, headerValue } from "./_lib/parse.js";
import {
  admin, getGmailToken, recordPoll, fetchStaffMinimal, insertGmailRail, gmailMessageExists,
} from "./_lib/store.js";

async function authorize(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return false;
  if (CRON_SECRET && token === CRON_SECRET) return true; // Vercel Cron
  try {
    // manual trigger: a valid Supabase session token = an authenticated manager
    const { data, error } = await admin().auth.getUser(token);
    return !error && !!data?.user;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (!(await authorize(req))) return res.status(401).json({ error: "unauthorized" });

  const summary = { connected: false, processed: 0, created: 0, duplicates: 0, skipped: 0, unmatched: 0 };
  try {
    const tokenRow = await getGmailToken();
    const refreshToken = tokenRow?.refresh_token || GMAIL_REFRESH_TOKEN;
    if (!refreshToken) {
      await recordPoll({ ok: false, error: "Gmail not connected (no refresh token)" });
      return res.status(200).json({ ...summary, connected: false, reason: "not_connected" });
    }

    const accessToken = await getAccessToken(refreshToken);
    const staff = await fetchStaffMinimal();
    const messages = await listSchedulingUnread(accessToken);

    for (const { id } of messages) {
      summary.processed++;
      try {
        if (await gmailMessageExists(id)) { summary.duplicates++; continue; }
        const msg = await getMessage(accessToken, id);
        const subject = headerValue(msg, "Subject");
        const parsed = parseSchedulingSubject(subject);
        if (!parsed) {
          // unrecognized format → skip silently (logged server-side only)
          console.warn(`[poll] skipping non-matching subject: ${JSON.stringify(subject)}`);
          summary.skipped++;
          await markRead(accessToken, id).catch(() => {}); // don't re-scan it every cycle
          continue;
        }
        const match = matchStaff(parsed.name, staff);
        if (!match) summary.unmatched++;
        const note = extractPlainText(msg);
        const result = await insertGmailRail({
          staffId: match?.id || null,
          unmatchedName: match ? null : parsed.name,
          type: parsed.type,
          dates: parsed.date,
          note,
          messageId: id,
          threadId: msg.threadId || null,
        });
        if (result.duplicate) { summary.duplicates++; }
        else { summary.created++; }
        await markRead(accessToken, id).catch((e) => console.warn(`[poll] mark-read failed for ${id}: ${e.message}`));
      } catch (msgErr) {
        console.error(`[poll] message ${id} failed: ${msgErr.message}`);
      }
    }

    summary.connected = true;
    await recordPoll({ ok: true });
    return res.status(200).json(summary);
  } catch (e) {
    console.error(`[poll] failed: ${e.message}`);
    await recordPoll({ ok: false, error: e.message }).catch(() => {});
    return res.status(200).json({ ...summary, connected: false, error: e.message });
  }
}
