-- Migration 0023: freeze a sent / locked Tip Sheet's roster. Run in the
-- Supabase SQL editor. Idempotent — safe to run more than once. Adds one
-- column; no existing value is changed.
--
-- roster_snapshot  slot id -> { name, pts } as the sheet showed them when it
--                  was sent or locked. A frozen sheet with a snapshot opens
--                  with exactly those names and points, whatever the schedule
--                  for that date says now. Cleared on unlock. NULL on every
--                  existing row: sheets frozen before this keep rebuilding
--                  their names from the schedule, as they always have.

alter table public.tip_sheets
  add column if not exists roster_snapshot jsonb;

comment on column public.tip_sheets.roster_snapshot is
  'Slot id -> {name, pts} pinned when the sheet was sent or locked; null = not pinned.';

-- Check: every existing row should show roster_snapshot null.
select count(*) as tip_sheets,
       count(roster_snapshot) as pinned
  from public.tip_sheets;
