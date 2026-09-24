// One way to get a Gmail access token, used by every route that talks to Gmail
// (poll, reply, send-schedule, send-tipsheet, manual-rail).
//
// Why this exists: a refresh that failed with invalid_grant used to surface
// only as a one-line error inside whichever send happened to hit it, while
// /api/gmail/status kept reporting "connected" because a token row existed.
// Now a dead grant is:
//   * logged once with enough detail to tell WHY it died (see describeCause);
//   * recorded on the integration_tokens row (last_error, "AUTH:" prefix), so
//     /api/gmail/status reports needsReconnect and the Rail dot goes red;
//   * cleared automatically by the next successful refresh.

import { createHash } from "node:crypto";
import { GMAIL_CLIENT_ID, GMAIL_REFRESH_TOKEN } from "./config.js";
import { getAccessToken } from "./google.js";
import { getGmailToken, recordGmailAuthFailure, clearGmailAuthFailure } from "./store.js";

export const AUTH_ERROR_PREFIX = "AUTH:";
export const RECONNECT_PATH = "/api/auth/start";

// Short, non-reversible fingerprint so two log lines can be compared ("is this
// the same token that failed yesterday, or a newer one?") without ever logging
// the secret itself.
export function tokenFingerprint(token) {
  if (!token) return null;
  return createHash("sha256").update(token).digest("hex").slice(0, 10);
}

// Google's OAuth error codes → the likely causes, in the order worth checking.
function describeCause(oauthError) {
  switch (oauthError) {
    case "invalid_grant":
      return [
        "refresh token is expired or revoked. Check, in order:",
        "(1) was the Google account's password changed? (that revokes every token carrying Gmail scopes);",
        "(2) was the app's access removed at myaccount.google.com/permissions (or a security checkup)?;",
        "(3) was this token issued while the consent screen was still in Testing? (those keep their 7-day expiry after publishing);",
        "(4) has /api/auth/start been completed many times? (Google keeps ~100 refresh tokens per account+client and silently revokes the oldest);",
        "(5) Workspace account? an admin session-control / reauth policy expires tokens.",
      ].join(" ");
    case "invalid_client":
      return "client ID/secret rejected: GMAIL_CLIENT_SECRET was rotated or the OAuth client deleted in Cloud Console. Update the env var and redeploy; the token itself may be fine.";
    case "unauthorized_client":
      return "token was issued to a different OAuth client than GMAIL_CLIENT_ID — the client ID changed since connecting. Reconnect.";
    default:
      return "not an OAuth grant error — likely transient (network / Google outage).";
  }
}

// Returns { accessToken, tokenRow }. Throws when there's no token at all
// (err.code = "gmail_not_connected") or the refresh fails (err.needsReconnect
// is true for grant/client errors, which only a reconnect or config fix cures).
export async function gmailAccessToken(context) {
  const tokenRow = await getGmailToken();
  const refreshToken = tokenRow?.refresh_token || GMAIL_REFRESH_TOKEN;
  if (!refreshToken) {
    const err = new Error("gmail_not_connected");
    err.code = "gmail_not_connected";
    err.needsReconnect = true;
    throw err;
  }
  const source = tokenRow?.refresh_token ? "supabase" : "env GMAIL_REFRESH_TOKEN";

  try {
    const accessToken = await getAccessToken(refreshToken);
    if (String(tokenRow?.last_error || "").startsWith(AUTH_ERROR_PREFIX)) {
      await clearGmailAuthFailure().catch((e) => console.warn(`[gmail-auth] clear failed: ${e.message}`));
    }
    return { accessToken, tokenRow };
  } catch (e) {
    if (!e.oauthError) throw e; // network etc. — don't mark the mailbox disconnected

    const fp = tokenFingerprint(refreshToken);
    const envFp = tokenFingerprint(GMAIL_REFRESH_TOKEN);
    const detail = {
      context,
      oauthError: e.oauthError,
      description: e.oauthDescription,
      httpStatus: e.httpStatus,
      tokenSource: source,
      tokenFingerprint: fp,
      // An env token that differs from the stored one is a second credential
      // that could be mistaken for the live one.
      envTokenSet: !!GMAIL_REFRESH_TOKEN,
      envTokenMatchesStored: envFp ? envFp === fp : null,
      tokenSavedAt: tokenRow?.refresh_token ? tokenRow.updated_at || null : null,
      account: tokenRow?.email || null,
      lastOkAt: tokenRow?.last_ok_at || null,
      clientIdSuffix: GMAIL_CLIENT_ID ? GMAIL_CLIENT_ID.split(".")[0].slice(-8) : null,
      likelyCause: describeCause(e.oauthError),
    };
    console.error(`[gmail-auth] refresh failed ${JSON.stringify(detail)}`);

    const needsReconnect = ["invalid_grant", "unauthorized_client", "invalid_client"].includes(e.oauthError);
    if (needsReconnect) {
      const summary = `${AUTH_ERROR_PREFIX}${e.oauthError}${e.oauthDescription ? ` (${e.oauthDescription})` : ""} during ${context}; token ${fp} from ${source}${tokenRow?.last_ok_at ? `, last worked ${tokenRow.last_ok_at}` : ""}`;
      await recordGmailAuthFailure(summary).catch((err) => console.warn(`[gmail-auth] record failed: ${err.message}`));
    }
    e.needsReconnect = needsReconnect;
    throw e;
  }
}

// Uniform JSON error fields for a failed Gmail call, so every send dialog can
// show the same "Gmail disconnected — reconnect" state.
export function gmailErrorFields(e) {
  if (e?.needsReconnect) {
    return {
      error: e.code === "gmail_not_connected" ? "gmail_not_connected" : `gmail_disconnected: ${e.oauthError}`,
      needsReconnect: true,
      reconnectUrl: RECONNECT_PATH,
    };
  }
  return { error: e?.message || String(e) };
}
