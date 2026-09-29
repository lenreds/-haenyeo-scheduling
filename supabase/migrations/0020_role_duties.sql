-- Migration 0020: Responsibilities & Duties (Staff tab). Run in the Supabase
-- SQL editor. Idempotent — safe to run more than once.
--
-- A written list of duties per role, as a reference sheet: add, edit, reorder,
-- delete, print. Nothing else — no assignment, no tracking, no per-shift
-- checklists. `role` is the display name the tab uses (Server, Busser/Runner,
-- Expo, Host, Bartender, BOH, Kitchen, Management).

create table if not exists public.role_duties (
  id         uuid primary key default gen_random_uuid(),
  role       text not null,
  duty       text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists idx_role_duties_role_order on public.role_duties(role, sort_order, created_at);

alter table public.role_duties enable row level security;

drop policy if exists "Managers can manage role_duties" on public.role_duties;
create policy "Managers can manage role_duties" on public.role_duties
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

comment on table public.role_duties is
  'Written duties per role for the Staff > Responsibilities & Duties reference sheet. Ordered by sort_order within a role.';
