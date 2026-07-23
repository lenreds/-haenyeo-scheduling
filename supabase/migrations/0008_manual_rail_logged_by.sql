-- HaenyeoMNG — migration 0008: manual Rail entries.
--
-- Run in the Supabase SQL editor. Idempotent.
--
-- Adds rail_requests.logged_by — the manager name (Lenis / Jon) who manually
-- logged an in-person scheduling request via the Rail tab's "+ Add Request"
-- form. Null for email-sourced rows. Manual rows use source = 'manual' and
-- have null gmail_message_id / gmail_thread_id (the reply flow already skips
-- threads it can't find).

alter table public.rail_requests
  add column if not exists logged_by text;
