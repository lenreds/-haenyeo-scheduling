// GET /api/gmail/status — lightweight connection status for the Rail header.
// Returns booleans + timestamps only; never the refresh token or any secret.
// Safe to call unauthenticated (no sensitive data leaves the server).

import { GMAIL_CLIENT_ID, GMAIL_REFRESH_TOKEN } from "../_lib/config.js";
import { getGmailToken } from "../_lib/store.js";

export default async function handler(req, res) {
  const configured = !!GMAIL_CLIENT_ID;
  try {
    const row = await getGmailToken();
    const connected = !!(row?.refresh_token || GMAIL_REFRESH_TOKEN);
    return res.status(200).json({
      configured,
      connected,
      email: row?.email || null,
      lastPollAt: row?.last_poll_at || null,
      lastOkAt: row?.last_ok_at || null,
      lastError: row?.last_error || null,
    });
  } catch (e) {
    // e.g. Supabase server env missing — report as not-connected rather than 500
    return res.status(200).json({ configured, connected: false, error: e.message });
  }
}
