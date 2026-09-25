-- Migration 0018: Set Schedule notes (SCHEDULE-NOTES-BRIEF.md). Run in the
-- Supabase SQL editor. Idempotent — safe to run more than once.
--
-- Two note surfaces on the Set Schedule page:
--   1) a per-staff scheduling note ("No Tuesdays") shown as a ⚑ flag beside the
--      person's name — one short line, permanent, not per-week or per-date;
--   2) a narrow pad of general standing notes beside the grid ("Kitchen closes
--      10pm Sundays") — not tied to anyone, not per-week.
--
-- The pad gets its OWN table rather than reusing general_notes (0014). That
-- table is the Rail's Notes box; sharing it would mean a discriminator column
-- plus a filter on every Rail read, and one missed filter would leak notes
-- between the two boards. A separate table can't.

-- 1) staff.scheduling_note ----------------------------------------------------
alter table public.staff
  add column if not exists scheduling_note text;

do $$ begin
  alter table public.staff
    add constraint staff_scheduling_note_len check (char_length(scheduling_note) <= 60);
exception when duplicate_object then null; end $$;

comment on column public.staff.scheduling_note is
  'Standing scheduling constraint shown as a flag on the Set Schedule grid (e.g. "No Tuesdays"). One line, max 60 chars. Null = no flag.';

-- 2) schedule_pad_notes -------------------------------------------------------
create table if not exists public.schedule_pad_notes (
  id         uuid primary key default gen_random_uuid(),
  note       text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists idx_schedule_pad_notes_order
  on public.schedule_pad_notes(sort_order, created_at);

alter table public.schedule_pad_notes enable row level security;

drop policy if exists "Managers can manage schedule_pad_notes" on public.schedule_pad_notes;
create policy "Managers can manage schedule_pad_notes" on public.schedule_pad_notes
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

comment on table public.schedule_pad_notes is
  'Standing general notes in the Set Schedule side pad. Global — no week, no date, no staff. Separate from general_notes (Rail Notes box), schedule_notes (per week) and calendar_notes (per date).';
