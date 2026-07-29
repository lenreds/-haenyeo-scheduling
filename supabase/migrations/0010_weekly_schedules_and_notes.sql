-- Migration 0010: Independent weekly schedules + per-week notes
--
-- Until now the Set Schedule grid was backed by schedule_patterns /
-- placeholder_schedule, which are RECURRING templates: one row per
-- (staff, weekday), shared by every week. Editing any week edited them all.
--
-- weekly_schedules and weekly_placeholder_schedules store one row per
-- (week_start, ...) so each week is its own independent record. The template
-- tables stay exactly as they are and are still the starting point: a week with
-- no rows here renders from the template, and is snapshotted into these tables
-- the first time anything in it is edited.
--
-- week_start is always the MONDAY of the week (the app's weeks run Mon-Sun).
-- weekday keeps the existing 0=Sun..6=Sat convention used by schedule_patterns
-- and the PERSON_PATTERNS arrays in App.jsx -- do not "fix" it to Mon-first
-- without changing both sides.

create table if not exists weekly_schedules (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  staff_id uuid references staff(id) on delete cascade,
  weekday int not null check (weekday between 0 and 6),
  shift_type text not null default 'OFF',
  role text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (week_start, staff_id, weekday)
);

create index if not exists idx_weekly_schedules_week on weekly_schedules(week_start);

create table if not exists weekly_placeholder_schedules (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  group_key text not null,
  slot_index int not null,
  slot_name text not null,
  weekday int not null check (weekday between 0 and 6),
  shift_type text not null default 'OFF',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (week_start, group_key, slot_index, weekday)
);

create index if not exists idx_weekly_placeholder_week on weekly_placeholder_schedules(week_start);

-- Per-week notes. Manual notes are typed by a manager; 'rail' notes are written
-- automatically when a Rail request is approved for a date in that week, and
-- carry rail_request_id so they can be traced back. Both kinds are editable and
-- deletable -- an auto-note is just a starting point, not a locked audit record.
create table if not exists schedule_notes (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  staff_id uuid references staff(id) on delete set null,
  note text not null,
  source text default 'manual',
  rail_request_id uuid references rail_requests(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_schedule_notes_week on schedule_notes(week_start, created_at desc);

alter table weekly_schedules enable row level security;
alter table weekly_placeholder_schedules enable row level security;
alter table schedule_notes enable row level security;

-- Same posture as the other manager-facing tables: any authenticated session
-- (i.e. a signed-in manager) can read and write. Staff never sign in.
drop policy if exists "Managers can manage weekly_schedules" on weekly_schedules;
create policy "Managers can manage weekly_schedules" on weekly_schedules
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "Managers can manage weekly_placeholder_schedules" on weekly_placeholder_schedules;
create policy "Managers can manage weekly_placeholder_schedules" on weekly_placeholder_schedules
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "Managers can manage schedule_notes" on schedule_notes;
create policy "Managers can manage schedule_notes" on schedule_notes
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

comment on table weekly_schedules is 'Per-week FOH staff schedule. One row per (week_start, staff, weekday). Absence of rows for a week_start means that week has never been edited and renders from schedule_patterns.';
comment on table weekly_placeholder_schedules is 'Per-week BOH/Kitchen/Management slot schedule. Mirrors placeholder_schedule but scoped to a single week_start.';
comment on table schedule_notes is 'Free-text notes attached to one week of the schedule. source=manual (typed) or rail (auto-added on Rail approval).';
comment on column weekly_schedules.weekday is '0=Sunday .. 6=Saturday (matches schedule_patterns, NOT the Mon-first display order)';
comment on column weekly_schedules.week_start is 'Monday of the week, ISO YYYY-MM-DD';
