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

The brief listed `gmail.readonly`, but marking processed emails as read (brief
item 2) requires **`gmail.modify`** — read-only can't change labels. The code
requests `gmail.modify`. If your Google consent screen was configured with only
`gmail.readonly`, add `gmail.modify` to the OAuth scopes, or emails will be
parsed but never marked read (they still won't be double-processed — every
message id is de-duplicated in the database as a backstop).

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

## Endpoints

- `GET  /api/auth/start` — begin OAuth
- `GET  /api/auth/callback` — OAuth redirect target (stores refresh token)
- `POST /api/poll` — poll inbox (cron `Bearer CRON_SECRET`, or a manager JWT)
- `GET  /api/gmail/status` — connection status for the Rail indicator (no secrets)
