// POST /api/send-schedule — emails a week's schedule to registered staff.
// Manager-JWT auth. Body: { weekLabel, dayHeaders:[7], rows:[{name,shifts:[7]}]
// OR groups:[{label,rows}], sectionLabel?, sections?:["FOH"|"BOH"|"Kitchen"] }.
// `sections` restricts recipients by staff.section (case-insensitive); omitted =
// all registered. Same email to each; tagged Sent/Schedules.

import { GMAIL_REFRESH_TOKEN } from "./_lib/config.js";
import { getAccessToken, sendMessage, modifyMessage } from "./_lib/google.js";
import { buildRawEmail } from "./_lib/reply.js";
import { buildScheduleEmail } from "./_lib/emails.js";
import { makeLabeler, LABELS } from "./_lib/labels.js";
import { getGmailToken, isManager, fetchRegisteredStaff } from "./_lib/store.js";

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!(await isManager(token))) return res.status(401).json({ error: "unauthorized" });

  const { weekLabel, dayHeaders, rows, groups, sectionLabel, sections } = readBody(req);
  if (!weekLabel || !Array.isArray(dayHeaders) || (!Array.isArray(rows) && !Array.isArray(groups))) {
    return res.status(400).json({ error: "weekLabel, dayHeaders, and rows or groups required" });
  }

  try {
    const tokenRow = await getGmailToken();
    const refreshToken = tokenRow?.refresh_token || GMAIL_REFRESH_TOKEN;
    if (!refreshToken) return res.status(200).json({ sent: 0, error: "gmail_not_connected" });

    const accessToken = await getAccessToken(refreshToken);
    let recipients = await fetchRegisteredStaff();
    if (Array.isArray(sections) && sections.length) {
      const want = sections.map((s) => String(s).toLowerCase());
      recipients = recipients.filter((r) => want.includes(String(r.section || "").toLowerCase()));
    }
    const { subject, body } = buildScheduleEmail({ weekLabel, dayHeaders, rows, groups, sectionLabel });
    const labeler = makeLabeler(accessToken);
    let labelId = null;
    try { labelId = await labeler.ensure(LABELS.sentSchedules); } catch { /* non-fatal */ }

    let sent = 0;
    const failures = [];
    for (const r of recipients) {
      try {
        const raw = buildRawEmail({ to: r.personal_email, subject, body });
        const msg = await sendMessage(accessToken, { raw });
        if (labelId && msg?.id) await modifyMessage(accessToken, msg.id, { addLabelIds: [labelId] }).catch(() => {});
        sent++;
      } catch (e) {
        failures.push(`${r.name}: ${e.message}`);
      }
    }
    return res.status(200).json({ sent, recipients: recipients.length, failures });
  } catch (e) {
    console.error(`[send-schedule] ${e.message}`);
    return res.status(200).json({ sent: 0, error: e.message });
  }
}
