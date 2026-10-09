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

## 4. A sent / locked Tip Sheet is only protected by CSS

**Why:** Sent sheets are the payroll record. What makes a sent or locked sheet read-only
today is the `.tip-locked` style (`pointer-events: none` on its inputs) in `src/App.jsx`.
Nothing in the data layer refuses a write: autosave still sends the whole row for a
frozen date, `upsertTipSheet` (`src/lib/data.js`) writes whatever it's given, and the
`tip_sheets` RLS policy (`using (true) with check (true)` for `authenticated`, migration
0001) lets **any signed-in user** write any row. There is no manager role: today the only
login is the owner's, which is why it hasn't bitten, but two or three more logins are
coming. When this is picked up, adding a role and checking it in RLS is the whole job,
not a detail of it — the same policy covers every table in 0001. Anything that
gets past the style (devtools, a future code path, a bug in the remap effect) changes a
sheet that was already emailed, and its reopened numbers with it.

**Found:** 2026-10-09, while scoping the Tip Sheet iPad input round. Noted, not fixed —
to be scoped on its own. The new time / cash pickers check `tipFrozen` in code and refuse
to open on a frozen sheet; that covers the new input path only.

**Approach to scope:**
- Roles first: a manager / staff distinction stored server-side (not in the client),
  and RLS policies that check it. Without that, "who may unlock" means "anyone signed in".
- Client: skip autosave and every `upsertTipSheet` for a frozen date except the
  Lock / Unlock / Send writes themselves.
- Database: a trigger (or RLS `with check`) that rejects updates to a row whose stored
  `sent` or `locked` is true unless the same update sets `locked = false` (Unlock) —
  so the rule holds no matter what client writes.
- Decide whether Unlock on a *sent* sheet should keep the emailed figures somewhere
  (a copy of the row at send time) before it becomes editable again.

---

## Related hardening already in place (not Phase 2 work)

- `SUPABASE_SERVICE_ROLE_KEY` is server-only and never `VITE_`-prefixed, so it cannot
  reach the browser bundle.
- RLS is authenticated-only on every manager-facing table.
- `/api/poll` no longer logs staff email addresses (commit 4f46bb8).
- Untagged inbox mail that doesn't match a registered sender is left unread and
  unlabeled rather than being touched.
