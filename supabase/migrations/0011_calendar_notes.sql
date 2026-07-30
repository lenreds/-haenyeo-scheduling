-- Migration 0011: notes pinned to a single calendar date
--
-- Distinct from schedule_notes (migration 0010), which attaches to a whole
-- week for the Set Schedule tab. These hang off one date and surface in the
-- Calendar day popup, with a dot on the month cell when a date has any.

create table if not exists calendar_notes (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  note text not null,
  created_at timestamptz default now()
);

create index if not exists idx_calendar_notes_date on calendar_notes(date);

alter table calendar_notes enable row level security;

-- Same posture as the other manager-facing tables: any signed-in manager can
-- read and write. Staff never sign in.
drop policy if exists "Managers can manage calendar_notes" on calendar_notes;
create policy "Managers can manage calendar_notes" on calendar_notes
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

comment on table calendar_notes is 'Free-text notes attached to one calendar date. Shown in the Calendar day popup; schedule_notes covers whole-week notes instead.';
