-- Migration 0009: Add schedule_weeks table for Set Schedule finalize/publish workflow
-- Tracks which weeks have been finalized (ready for publishing) and published (emails sent)

create table if not exists schedule_weeks (
  week_start date not null,
  section text,
  finalized boolean default false,
  published boolean default false,
  finalized_at timestamptz,
  published_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (week_start)
);

-- Index for querying finalized weeks
create index if not exists idx_schedule_weeks_finalized on schedule_weeks(finalized) where finalized = true;

-- Index for querying published weeks
create index if not exists idx_schedule_weeks_published on schedule_weeks(published) where published = true;

-- Enable RLS (not strictly necessary since managers manage this, but good practice)
alter table schedule_weeks enable row level security;

-- Allow authenticated managers to see and modify schedule_weeks
create policy "Managers can manage schedule_weeks" on schedule_weeks
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Comment for clarity
comment on table schedule_weeks is 'Tracks which weeks of the Set Schedule have been finalized (approved for email sending) and published (emails sent to staff)';
comment on column schedule_weeks.week_start is 'Monday date of the week (ISO format YYYY-MM-DD)';
comment on column schedule_weeks.section is 'Schedule section (FOH, BOHKITCHEN, MANAGEMENT) - currently nullable, can be extended for per-section finalization';
comment on column schedule_weeks.finalized is 'True if the schedule for this week has been finalized and is ready to send';
comment on column schedule_weeks.published is 'True if the schedule emails have been sent for this week';
comment on column schedule_weeks.finalized_at is 'Timestamp when the week was finalized';
comment on column schedule_weeks.published_at is 'Timestamp when the schedule emails were published';
