-- Migration 0013: Rail archive + per-section/per-date locking
-- (TIPSHEET-RAIL-LOCK-BRIEF.md items 2 and 3). Run in the Supabase SQL editor.
-- Idempotent — safe to run more than once.

-- 1) rail_requests: 'archived' as a valid status ------------------------------
--
-- status has always been free text (0001 documents the values in a comment, it
-- never constrained them), so 'archived' is already storable. This block makes
-- the allowed set explicit: any pre-existing status CHECK is dropped, and the
-- new one is only added when every row already fits — a live row carrying some
-- other value raises a notice instead of failing the migration.

do $$
declare
  c record;
  stray text;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.rail_requests'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.rail_requests drop constraint %I', c.conname);
  end loop;

  select string_agg(distinct status, ', ') into stray
    from public.rail_requests
   where status not in ('pending', 'approved', 'denied', 'archived');

  if stray is not null then
    raise notice 'rail_requests.status CHECK not added — unexpected values present: %', stray;
  else
    alter table public.rail_requests
      add constraint rail_requests_status_check
      check (status in ('pending', 'approved', 'denied', 'archived'));
  end if;
end $$;

comment on column public.rail_requests.status is
  'pending | approved | denied | archived. Archived requests are hidden from the pending queue but kept on record, and can be restored to pending.';

-- 2) schedule_weeks: per-section lock state -----------------------------------
--
-- 0009 created this table with primary key (week_start) and a nullable section,
-- so finalize/publish state is one row per week. Locking is per section per
-- week, which needs the key to cover both columns.
--
-- Existing week-level rows (section null) are backfilled to the sentinel 'ALL'
-- so finalize/publish keeps its state and keeps writing to that one row; the
-- lock rows use 'FOH' / 'BOHKITCHEN' / 'MANAGEMENT' alongside it.

alter table public.schedule_weeks
  add column if not exists locked    boolean not null default false,
  add column if not exists locked_at timestamptz;

update public.schedule_weeks set section = 'ALL' where section is null;

alter table public.schedule_weeks alter column section set default 'ALL';
alter table public.schedule_weeks alter column section set not null;

-- Swap the primary key from (week_start) to (week_start, section). Looked up by
-- name rather than assumed, and skipped entirely once it already covers both.
do $$
declare
  pk_name text;
  pk_cols text;
begin
  select conname, pg_get_constraintdef(oid)
    into pk_name, pk_cols
    from pg_constraint
   where conrelid = 'public.schedule_weeks'::regclass
     and contype = 'p';

  if pk_name is null then
    alter table public.schedule_weeks add primary key (week_start, section);
  elsif pk_cols not ilike '%section%' then
    execute format('alter table public.schedule_weeks drop constraint %I', pk_name);
    alter table public.schedule_weeks add primary key (week_start, section);
  end if;
end $$;

create index if not exists idx_schedule_weeks_locked
  on public.schedule_weeks (locked) where locked = true;

comment on column public.schedule_weeks.section is
  'FOH | BOHKITCHEN | MANAGEMENT for per-section lock rows, or ALL for the week-level finalize/publish row.';
comment on column public.schedule_weeks.locked is
  'True if this section of this week is locked — its schedule cells ignore clicks. Independent of finalized/published.';
comment on column public.schedule_weeks.locked_at is
  'Timestamp when this section of this week was locked; null once unlocked.';

-- 3) tip_sheets: per-date lock ------------------------------------------------
--
-- Separate from finalized (0005): locking freezes the inputs for that one date,
-- finalizing emails staff. Either can be on without the other.

alter table public.tip_sheets
  add column if not exists locked    boolean not null default false,
  add column if not exists locked_at timestamptz;

comment on column public.tip_sheets.locked is
  'True if this date''s tip sheet is locked — inputs are read-only and Finalize is disabled. Independent of finalized.';
comment on column public.tip_sheets.locked_at is
  'Timestamp when this date''s tip sheet was locked; null once unlocked.';
