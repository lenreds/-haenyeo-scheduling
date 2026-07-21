-- HaenyeoMNG — migration 0003: Gmail integration (GMAIL-INTEGRATION-BRIEF.md).
--
-- Run this in the Supabase SQL editor (same as 0001/0002). Idempotent.
--
-- Adds the columns rail_requests needs for auto-created email entries and a
-- server-only table that holds the Gmail OAuth refresh token + poll status.

-- 1) rail_requests: support email-sourced + unmatched-name entries -------------
-- staff_id must become nullable: an email whose Name doesn't match any staff
-- member still creates a pending entry (flagged), so there may be no staff_id.
alter table public.rail_requests alter column staff_id drop not null;

alter table public.rail_requests
  add column if not exists source           text not null default 'manual',  -- 'manual' | 'gmail'
  add column if not exists unmatched_name   text,                             -- raw Name from the email when no staff match
  add column if not exists gmail_message_id text;                             -- Gmail message id, for dedup

-- one row per processed email — belt-and-suspenders against double-processing
-- even if marking the message read fails. Partial unique so manual rows (null) coexist.
create unique index if not exists rail_requests_gmail_message_id_key
  on public.rail_requests (gmail_message_id)
  where gmail_message_id is not null;

-- 2) integration_tokens: refresh token + poll status (SERVER-ONLY) ------------
-- RLS is enabled with NO policies, so neither anon nor authenticated clients can
-- read it. Only the service_role key (used exclusively by the /api functions)
-- bypasses RLS. The refresh token therefore never reaches the browser bundle.
create table if not exists public.integration_tokens (
  provider      text primary key,          -- 'gmail'
  refresh_token text,
  email         text,                      -- the connected inbox address
  last_poll_at  timestamptz,               -- last time the poller ran (any outcome)
  last_ok_at    timestamptz,               -- last time a poll completed without error
  last_error    text,                      -- last poll/auth error message (short), else null
  updated_at    timestamptz not null default now()
);

alter table public.integration_tokens enable row level security;
-- Intentionally NO policies: authenticated/anon get zero rows; service_role bypasses RLS.

-- seed an empty gmail row so status reads have something to report before first connect
insert into public.integration_tokens (provider) values ('gmail')
on conflict (provider) do nothing;
