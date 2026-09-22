-- Migration 0015: when a tip sheet's emails actually went out
-- (RAIL-CALENDAR-TIPSHEET-BRIEF.md item 1). Run in the Supabase SQL editor.
-- Idempotent — safe to run more than once.
--
-- tip_sheets has carried a `sent` boolean since 0001 but never a timestamp, so
-- the Send button could only say "Sent" and not when. Finalize is gone now:
-- Confirm & Send emails staff and marks the sheet sent + finalized + locked in
-- one write, and the button reads "Sent ✓ 11:42 PM" off this column.
--
-- Rows sent before this migration keep sent = true with sent_at null; the button
-- falls back to a bare "Sent ✓" for those rather than inventing a time.

alter table public.tip_sheets
  add column if not exists sent_at timestamptz;

comment on column public.tip_sheets.sent_at is
  'When this date''s tip emails were sent. Null for sheets sent before 0015, or never sent. Set alongside finalized_at and locked_at by Confirm & Send.';
