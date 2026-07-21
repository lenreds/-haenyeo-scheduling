// GET /api/auth/start — kicks off the Google OAuth consent flow. The manager
// opens this once (signed into the scheduling Gmail account) to grant read
// access; Google redirects back to /api/auth/callback with a code.

import { assertGoogleConfigured } from "../_lib/config.js";
import { buildConsentUrl } from "../_lib/google.js";

export default function handler(req, res) {
  try {
    assertGoogleConfigured();
    const url = buildConsentUrl("haenyeo");
    res.writeHead(302, { Location: url });
    res.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
