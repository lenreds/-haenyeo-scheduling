# HaenyeoMNG — Phase 2 Roadmap

Security and compliance items identified but **deliberately not built yet**. Recorded
here so they aren't lost. Nothing in this file is implemented.

---

## 1. Two-factor authentication on manager logins

**Why:** A manager account can read every staff member's personal email and phone
number, approve time off, and send email as the restaurant. Today a leaked or reused
password is the only thing standing in the way.

**Approach:** Supabase Auth supports TOTP MFA natively (`supabase.auth.mfa.*`) — enroll,
challenge, and verify. No third-party service needed.

**Notes:**
- Managers are few and known, so enrollment can be mandatory rather than opt-in.
- Needs a recovery path decided up front (backup codes, or an owner who can reset
  enrollment) — otherwise a lost phone locks someone out of the schedule.
- Affects `src/App.jsx` sign-in only; the `/api` routes already verify the Supabase JWT
  and inherit MFA state without changes.

## 2. Rate limiting on `/api/poll`

**Why:** `/api/poll` is authenticated but expensive — each call fans out into Gmail list,
per-message fetch, label, and modify requests. A manager JWT that leaked, or a stuck
client retry loop, could burn the Gmail API quota or the Vercel function budget.

**Approach:** A short per-caller cooldown (the `gmail_poll_log` table already records
poll times, so the last-poll timestamp is available without new infrastructure). Reject
or no-op a manual poll that arrives within N seconds of the previous one; leave the
Vercel Cron path exempt.

**Notes:**
- The daily cron only fires once, so this is really about the "Check now" button.
- Worth pairing with a visible "checked N seconds ago" hint so a rejected poll doesn't
  look like a failure.

## 3. Privacy policy page

**Why:** The app stores staff personal email addresses and phone numbers. Any published
policy should say what is collected, why, who can see it, and how someone gets their
data removed. This also matters for Google OAuth verification, which asks for a privacy
policy URL for apps handling user data.

**Approach:** A static route in the Vite app (no auth required) plus a link in the
registration/welcome email footer.

**Should cover:**
- What is stored: name, personal email, phone, schedule and time-off history.
- Why: sending schedules and processing scheduling requests.
- Who sees it: management only. Staff never sign in and cannot see each other's data.
- Retention and deletion: how a departing employee's record is removed (the Staff tab
  delete already cascades to roles, patterns, overrides, and rail requests).
- That scheduling email is processed automatically by the Gmail integration.

---

## Related hardening already in place (not Phase 2 work)

- `SUPABASE_SERVICE_ROLE_KEY` is server-only and never `VITE_`-prefixed, so it cannot
  reach the browser bundle.
- RLS is authenticated-only on every manager-facing table.
- `/api/poll` no longer logs staff email addresses (commit 4f46bb8).
- Untagged inbox mail that doesn't match a registered sender is left unread and
  unlabeled rather than being touched.
