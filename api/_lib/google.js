// Minimal Google OAuth + Gmail REST client using global fetch (Node 18+ on
// Vercel). No googleapis dependency — the calls we need are small and explicit.

import {
  GMAIL_CLIENT_ID,
  GMAIL_CLIENT_SECRET,
  OAUTH_REDIRECT_URI,
  GMAIL_SCOPE,
} from "./config.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

// URL the manager visits to grant the app read access to the scheduling inbox.
// access_type=offline + prompt=consent forces Google to return a refresh_token.
export function buildConsentUrl(state) {
  const params = new URLSearchParams({
    client_id: GMAIL_CLIENT_ID,
    redirect_uri: OAUTH_REDIRECT_URI,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  if (state) params.set("state", state);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// Exchange the one-time auth code for tokens (includes refresh_token).
export async function exchangeCodeForTokens(code) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GMAIL_CLIENT_ID,
      client_secret: GMAIL_CLIENT_SECRET,
      redirect_uri: OAUTH_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Token exchange failed: ${data.error || res.status} ${data.error_description || ""}`);
  return data; // { access_token, refresh_token, expires_in, scope, token_type }
}

// Trade a stored refresh token for a short-lived access token.
export async function getAccessToken(refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: GMAIL_CLIENT_ID,
      client_secret: GMAIL_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Access-token refresh failed: ${data.error || res.status}`);
  return data.access_token;
}

// List unread message ids whose subject mentions SCHEDULING. Brackets are
// ignored by Gmail search, so we filter subjects precisely later in parse.js.
export async function listSchedulingUnread(accessToken, maxResults = 25) {
  const q = encodeURIComponent('is:unread subject:(SCHEDULING)');
  const res = await fetch(`${GMAIL_BASE}/messages?q=${q}&maxResults=${maxResults}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Gmail list failed: ${data.error?.message || res.status}`);
  return data.messages || []; // [{ id, threadId }]
}

export async function getMessage(accessToken, id) {
  const res = await fetch(`${GMAIL_BASE}/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Gmail get failed: ${data.error?.message || res.status}`);
  return data;
}

// Best-effort: remove the UNREAD label so the message isn't polled again.
// Requires gmail.modify; if the granted scope is readonly this throws and the
// caller logs+continues (the gmail_message_id dedup still prevents re-inserts).
export async function markRead(accessToken, id) {
  const res = await fetch(`${GMAIL_BASE}/messages/${id}/modify`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`Gmail mark-read failed: ${data.error?.message || res.status}`);
  }
}
