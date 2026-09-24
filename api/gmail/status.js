// GET /api/gmail/status — lightweight connection status for the Rail header.
// Returns booleans + timestamps only; never the refresh token or any secret.
// Safe to call unauthenticated (no sensitive data leaves the server).
//
// "connected" means a token exists AND Google hasn't rejected it. A stored
// token that failed its last refresh (invalid_grant etc., recorded by
// gmail-auth.js with an "AUTH:" last_error) reports needsReconnect instead —
// it used to read as connected, which is how a dead token went unnoticed until
// a send failed.

import { GMAIL_CLIENT_ID, GMAIL_REFRESH_TOKEN } from "../_lib/config.js";
import { getGmailToken } from "../_lib/store.js";
import { AUTH_ERROR_PREFIX, RECONNECT_PATH } from "../_lib/gmail-auth.js";

export default async function handler(req, res) {
  const configured = !!GMAIL_CLIENT_ID;
  try {
    const row = await getGmailToken();
    const hasToken = !!(row?.refresh_token || GMAIL_REFRESH_TOKEN);
    const lastError = row?.last_error || null;
    const authFailed = !!lastError && lastError.startsWith(AUTH_ERROR_PREFIX);
    return res.status(200).json({
      configured,
      connected: hasToken && !authFailed,
      needsReconnect: configured && (!hasToken || authFailed),
      reconnectUrl: RECONNECT_PATH,
      email: row?.email || null,
      lastPollAt: row?.last_poll_at || null,
      lastOkAt: row?.last_ok_at || null,
      lastError: authFailed ? lastError.slice(AUTH_ERROR_PREFIX.length) : lastError,
    });
  } catch (e) {
    // e.g. Supabase server env missing — report as not-connected rather than 500
    return res.status(200).json({ configured, connected: false, error: e.message });
  }
}
