# HaenyeoMNG — Gmail Integration Brief

**Context:** The app is live (Vercel + Supabase). This brief covers wiring up the dedicated scheduling Gmail inbox so that staff emails automatically create pending Rail requests. Read HANDOFF-HaenyeoMNG.md for full project context first.

---

## Overview

Staff send scheduling requests to a dedicated Gmail inbox using a structured subject line convention. The app reads that inbox, parses the emails, and automatically creates pending Rail entries for manager approval. No manual data entry by the manager.

---

## The subject line convention

All staff emails must follow this format:

[SCHEDULING] – TYPE – Name – Date

**TYPE values:**
- `REQUEST OFF` — time-off request
- `SHIFT SWAP` — swap with another staff member
- `COVERAGE REQUEST` — needs someone to cover their shift

**Examples:**
- `[SCHEDULING] – REQUEST OFF – Bernie – Jul 28`
- `[SCHEDULING] – SHIFT SWAP – Reiko – Jul 30`
- `[SCHEDULING] – COVERAGE REQUEST – Emilio – Aug 2`

The email body can contain any additional notes (who they want to swap with, reason for time off, etc.) — this should be captured as the `note` field on the Rail entry.

---

## What to build

### 1. Gmail OAuth connection
- Connect the dedicated scheduling Gmail account via Google OAuth (Google Cloud Console, Gmail API scope: `gmail.readonly`)
- Store the OAuth refresh token securely in Supabase (server-side only, never exposed to the client)
- The publishable/anon key must never touch the Gmail credentials — this requires a server-side function (Vercel serverless function or Supabase Edge Function)

### 2. Inbox polling
- Poll the inbox on a schedule (every 5–15 minutes is fine) for unread emails with `[SCHEDULING]` in the subject line
- After processing an email, mark it as read so it isn't processed twice
- If the subject line doesn't match the convention exactly, skip it silently

### 3. Auto-create Rail entries
Parse each matching email and insert a new row into the `rail_requests` table with:
- `type` — from the TYPE field in the subject (`REQUEST OFF`, `SHIFT SWAP`, `COVERAGE REQUEST`)
- `dates` — from the Date field in the subject
- `note` — the email body text (trimmed)
- `status` — always `pending` on creation (never auto-approve)
- `urgent` — default false (manager can flag urgent manually on the Rail)
- `staff_id` — match the Name field against the `staff` table; if no match found, still create the entry but flag it with an unmatched-name warning so the manager can fix it

### 4. Rail display
No Rail UI changes needed — the existing pending/approved/denied flow handles everything. New auto-created entries appear in the pending queue the same as manually created ones.

### 5. Error handling
- Unrecognized subject format → skip silently, log to a server-side error log
- Unmatched staff name → create the entry anyway, surface a warning label on the Rail card
- Gmail API down or auth expired → fail gracefully, retry on next poll cycle, surface a small connection status indicator in the app ("Gmail connected" vs "Gmail disconnected")

---

## Google Cloud credentials (add to Vercel environment variables)

```
GMAIL_CLIENT_ID=        ← from Google Cloud Console
GMAIL_CLIENT_SECRET=    ← from Google Cloud Console
GMAIL_REFRESH_TOKEN=    ← generated during the OAuth flow Claude Code runs
GMAIL_INBOX=            ← the dedicated scheduling email address
```

The OAuth consent screen is already configured at console.cloud.google.com (project: HaenyeoMNG). The authorized redirect URI is already set to `https://haenyeo-scheduling.vercel.app/api/auth/callback`.

---

## Explicitly out of scope for this build

- Sending emails from the app (staff notifications) — phase 3
- Parsing freeform emails without the subject line convention
- Any change to the Rail UI or approval flow — untouched
