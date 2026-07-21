// Server-side config for the Gmail integration. These env vars are read ONLY by
// the /api serverless functions and are never prefixed with VITE_, so they never
// enter the client bundle. Files/dirs under api/ starting with "_" are treated
// as shared code by Vercel, not as routes.

export const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID || "";
export const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || "";
export const GMAIL_INBOX = process.env.GMAIL_INBOX || "";
// Optional: a refresh token supplied directly via env instead of the OAuth flow.
// The OAuth callback stores one in Supabase; the poller prefers the stored value
// and falls back to this.
export const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN || "";

// Must exactly match the Authorized redirect URI in Google Cloud Console.
export const OAUTH_REDIRECT_URI =
  process.env.OAUTH_REDIRECT_URI || "https://haenyeo-scheduling.vercel.app/api/auth/callback";

// gmail.modify: read mailbox + mark processed emails read (readonly can't change
// labels). gmail.send: reply to staff on approve/deny (auto-reply feature).
// Space-separated = multiple scopes on one consent. Re-run /api/auth/start after
// adding gmail.send so the stored refresh token carries the new grant.
export const GMAIL_SCOPE =
  "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send";

// Supabase — server side uses the SERVICE ROLE key so the poller can insert
// rail_requests and read integration_tokens regardless of RLS. This key must
// only ever live in server env, never in the client / never VITE_-prefixed.
export const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Shared secret Vercel Cron sends as `Authorization: Bearer <CRON_SECRET>`.
export const CRON_SECRET = process.env.CRON_SECRET || "";

export function assertGoogleConfigured() {
  const missing = [];
  if (!GMAIL_CLIENT_ID) missing.push("GMAIL_CLIENT_ID");
  if (!GMAIL_CLIENT_SECRET) missing.push("GMAIL_CLIENT_SECRET");
  if (missing.length) throw new Error(`Missing Google env: ${missing.join(", ")}`);
}

export function assertSupabaseConfigured() {
  const missing = [];
  if (!SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length) throw new Error(`Missing Supabase server env: ${missing.join(", ")}`);
}
