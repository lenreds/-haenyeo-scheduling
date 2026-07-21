# Gmail Integration — Setup & Operations

What the code does (already built): a Vercel serverless backend polls the
scheduling Gmail inbox, parses `[SCHEDULING] – TYPE – Name – Date` emails, and
inserts pending `rail_requests` for manager approval. Credentials stay server-side;
the browser bundle never sees them.

There are **three things only you can do** (account access / auth I can't perform).
Do them in order.

---

## 1. Run the database migration

In the Supabase SQL editor, run `supabase/migrations/0003_gmail_integration.sql`.
It makes `rail_requests.staff_id` nullable, adds `source` / `unmatched_name` /
`gmail_message_id`, and creates the server-only `integration_tokens` table.

## 2. Add Vercel environment variables

Project → Settings → Environment Variables → add for **Production** (and Preview).
None of these are `VITE_`-prefixed, so they stay server-side.

| Name | Value |
|---|---|
| `GMAIL_CLIENT_ID` | `676672938233-2qncfe4sshgmecn4p8v8g2bsrdcbgk26.apps.googleusercontent.com` |
| `GMAIL_CLIENT_SECRET` | `GOCSPX-…` (the one you provided) |
| `GMAIL_INBOX` | `haenyeo.schedule@gmail.com` |
| `OAUTH_REDIRECT_URI` | `https://haenyeo-scheduling.vercel.app/api/auth/callback` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → **service_role** secret |
| `CRON_SECRET` | any long random string (used to authorize the cron poll) |

Notes:
- The **service role key was not in the brief** — the poller needs it to write
  `rail_requests` and read the refresh token past RLS. Copy it from Supabase.
  Keep it server-side only; never expose it or prefix it `VITE_`.
- `SUPABASE_URL` isn't listed because the functions fall back to the existing
  `VITE_SUPABASE_URL`. Add `SUPABASE_URL` too if you ever remove that.
- The client ID you sent had a trailing `?authuser=0&project=haenyeomng` copied
  from a browser URL — the real value ends at `.apps.googleusercontent.com`
  (already trimmed above).

Redeploy after adding them (env changes need a fresh deploy).

## 3. Connect the inbox (one-time OAuth)

1. Sign into `haenyeo.schedule@gmail.com` in your browser.
2. Visit `https://haenyeo-scheduling.vercel.app/api/auth/start`.
3. Grant access on Google's consent screen.
4. You'll land on a "✓ Gmail connected" page. The refresh token is now stored in
   Supabase (`integration_tokens`) — no need to paste `GMAIL_REFRESH_TOKEN`
   anywhere.

The Rail tab's status bar will flip to **Gmail connected**.

---

## Scope note (important)

The app requests two scopes: **`gmail.modify`** (read mailbox + mark processed
emails read — `gmail.readonly` can't change labels) and **`gmail.send`** (send
the staff auto-reply on approve/deny).

If you change scopes you must **re-consent** for the new grant to take effect:
1. In Google Cloud Console → **Data Access**, add
   `https://www.googleapis.com/auth/gmail.modify` and
   `https://www.googleapis.com/auth/gmail.send`.
2. Re-run the OAuth flow: visit `/api/auth/start` and approve again (this
   overwrites the stored refresh token with one carrying both scopes).

Until `gmail.send` is granted, approvals/denials still work and update the
schedule — only the auto-reply email is skipped (logged, non-fatal).

## Polling cadence & Vercel plan

`vercel.json` schedules `/api/poll` **once daily** (`0 9 * * *`, 09:00 UTC). This
is deliberately Hobby-plan-safe: **the Hobby plan rejects any cron more frequent
than daily and fails the whole deployment if you try** (this is what caused the
first Gmail deploy to fail and 404 — Vercel rolled back to the previous build).

- On a **Pro** plan you can raise the frequency, e.g. `*/10 * * * *` for every 10
  minutes, and redeploy.
- On **any** plan: the Rail tab's **"Check now"** button (signed-in manager) polls
  on demand, and you can point an external scheduler (e.g. cron-job.org) at
  `POST https://haenyeo-scheduling.vercel.app/api/poll` with header
  `Authorization: Bearer <CRON_SECRET>` for more frequent automated polling.

## Email convention (share with staff)

Subject: `[SCHEDULING] – TYPE – Name – Date`
- TYPE ∈ `REQUEST OFF`, `SHIFT SWAP`, `COVERAGE REQUEST`
- Name must match a staff member (else the entry is flagged "Unmatched name")
- Body becomes the request's note
- Separators can be en-dash, em-dash, or hyphen; type is case-insensitive.

## Security

The client secret was shared in chat, so it now lives in this session's
transcript. It's only stored in the gitignored `.env.local` (not committed) and
in Vercel. If you want to be safe, rotate it in Google Cloud Console → Credentials
and update `GMAIL_CLIENT_SECRET` in Vercel + `.env.local`.

## Combined build round (registration, publish, finalize, labels, time off)

Extra setup for the COMBINED-BUILD-BRIEF features:

1. **Run migration `0005_registration_publish_finalize.sql`** (staff contact
   columns, tip finalize columns, `staff_info_updates` table).
2. **Add two env vars** (server + client copy of the same code word):
   | Name | Where | Value |
   |---|---|---|
   | `STAFF_REGISTER_CODE` | Vercel (server) | the registration code word |
   | `VITE_STAFF_REGISTER_CODE` | Vercel (client) | **same** value — baked into the QR codes at build time |
   `VITE_STAFF_REGISTER_CODE` is **not secret** (it's readable in the page source
   and printed on the QR codes posted in the restaurant). It must be set **before
   the deploy build** or the Register/Update QR codes encode a placeholder.
3. **No new OAuth scope** — Gmail label create/apply uses the `gmail.modify`
   scope you already granted, and sending uses `gmail.send`. If replies/sends
   already work, nothing to re-consent here.

Gmail labels (`Registrations`, `Requests/*`, `Info Updates`, `Sent/*`) are created
automatically on first use — no manual Gmail setup.

## Endpoints

- `GET  /api/auth/start` — begin OAuth
- `GET  /api/auth/callback` — OAuth redirect target (stores refresh token)
- `POST /api/poll` — poll inbox: rail requests + [REGISTER] + [UPDATE INFO] (cron `Bearer CRON_SECRET`, or a manager JWT)
- `POST /api/reply` — send the staff auto-reply on approve/deny (manager JWT)
- `POST /api/send-schedule` — email the week's schedule to registered staff (manager JWT)
- `POST /api/send-tipsheet` — email the finalized tip sheet to workers (manager JWT)
- `GET  /api/gmail/status` — connection status for the Rail indicator (no secrets)
