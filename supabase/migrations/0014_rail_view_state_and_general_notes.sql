-- Migration 0014: persistent (global) Rail clears + general notes
-- (PERSISTENCE-NOTES-TIPSHEET-BRIEF.md items 1 and 2). Run in the Supabase SQL
-- editor. Idempotent — safe to run more than once.

-- 1) rail_view_state: one shared cleared_at per Rail list ---------------------
--
-- "Clear" on the Auto-Action Log and "Clear resolved" on the Rail used to be
-- display-only, so everything came back on refresh. This table makes them
-- stick. It is deliberately GLOBAL, not per user: one row per list, so when any
-- manager clears a list it is cleared for every manager.
--
-- Nothing is ever deleted — rail_requests keeps the full history and the UI
-- simply hides entries created at or before cleared_at. Clearing again just
-- moves the timestamp forward; setting cleared_at back to null unhides
-- everything.
--
-- Pending decisions are NOT filtered by this table. Pending items only leave
-- the queue via approve / deny / archive / delete.

create table if not exists rail_view_state (
  list       text primary key,      -- 'auto_log' | 'resolved'
  cleared_at timestamptz,
  cleared_by uuid,                  -- auth.users id of whoever cleared last (audit only)
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.rail_view_state'::regclass
       and conname = 'rail_view_state_list_check'
  ) then
    alter table public.rail_view_state
      add constraint rail_view_state_list_check check (list in ('auto_log', 'resolved'));
  end if;
end $$;

alter table rail_view_state enable row level security;

-- Same posture as the other manager-facing tables: any signed-in manager can
-- read and write. Staff never sign in.
drop policy if exists "Managers can manage rail_view_state" on rail_view_state;
create policy "Managers can manage rail_view_state" on rail_view_state
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

comment on table rail_view_state is
  'Shared (not per-user) hide-only watermarks for the Rail lists. One row per list: auto_log and resolved. The UI hides entries created at or before cleared_at; nothing is deleted from rail_requests.';
comment on column rail_view_state.list is 'auto_log for the Auto-Action Log, resolved for the Resolved list.';
comment on column rail_view_state.cleared_at is 'Entries created at or before this moment are hidden for everyone. Null = nothing hidden.';
comment on column rail_view_state.cleared_by is 'Which manager last pressed Clear. Audit only — the watermark itself is global.';

-- 2) general_notes: undated notes for the Rail's Notes box --------------------
--
-- Distinct from schedule_notes (0010, attached to a week) and calendar_notes
-- (0011, attached to one date). These are standing notes with no date at all —
-- the Rail's Notes box shows them as a plain list, and the manager adds, edits
-- and deletes them inline.

create table if not exists general_notes (
  id         uuid primary key default gen_random_uuid(),
  note       text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists idx_general_notes_order on general_notes(sort_order, created_at);

alter table general_notes enable row level security;

drop policy if exists "Managers can manage general_notes" on general_notes;
create policy "Managers can manage general_notes" on general_notes
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

comment on table general_notes is
  'Standing, undated notes shown in the Rail Notes box. No week and no date — schedule_notes covers per-week notes and calendar_notes covers per-date notes.';
comment on column general_notes.sort_order is
  'Manual ordering hint; ties break on created_at. Reserved for drag-reorder — the UI does not set it yet.';
