// GET /api/auth/callback — Google redirects here with ?code=... after consent.
// Exchanges the code for a refresh token and stores it in Supabase (server-only).
// Then renders a tiny confirmation page. This is the redirect URI registered in
// Google Cloud Console.

import { exchangeCodeForTokens } from "../_lib/google.js";
import { assertGoogleConfigured, GMAIL_INBOX } from "../_lib/config.js";
import { saveGmailRefreshToken } from "../_lib/store.js";

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
  <style>body{font-family:system-ui,sans-serif;background:#1a1815;color:#EDE7D9;display:flex;
  min-height:100vh;align-items:center;justify-content:center;margin:0}
  .card{background:#26241f;border:1px solid rgba(237,231,217,.15);border-radius:12px;
  padding:32px 36px;max-width:440px}h1{color:#C98A3E;font-size:18px;margin:0 0 10px}
  p{line-height:1.5;font-size:14px;color:#c9c2b2}code{color:#8FA396}</style></head>
  <body><div class="card">${body}</div></body></html>`;
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  try {
    assertGoogleConfigured();
    const { code, error } = req.query || {};
    if (error) return res.status(400).send(page("Gmail — cancelled", `<h1>Consent cancelled</h1><p>${error}</p>`));
    if (!code) return res.status(400).send(page("Gmail — error", `<h1>Missing code</h1><p>No authorization code was returned.</p>`));

    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      return res.status(400).send(page("Gmail — retry",
        `<h1>No refresh token returned</h1><p>Google didn't return a refresh token. Remove the app's access at
        <code>myaccount.google.com/permissions</code> and open <code>/api/auth/start</code> again so it re-prompts for consent.</p>`));
    }
    await saveGmailRefreshToken(tokens.refresh_token, GMAIL_INBOX || null);
    return res.status(200).send(page("Gmail connected",
      `<h1>✓ Gmail connected</h1><p>The scheduling inbox ${GMAIL_INBOX ? `(<code>${GMAIL_INBOX}</code>) ` : ""}is now
      linked. Scheduling emails will turn into pending Rail requests on the next poll. You can close this tab.</p>`));
  } catch (e) {
    return res.status(500).send(page("Gmail — error", `<h1>Something went wrong</h1><p><code>${e.message}</code></p>`));
  }
}
