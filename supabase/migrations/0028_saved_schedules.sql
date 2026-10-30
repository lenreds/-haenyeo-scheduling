-- Migration 0028: saved schedules — named copies of one section's week, to apply
-- to another week — and a record of every apply, so it can be undone.
-- Run in the Supabase SQL editor. Emails nobody; changes no existing value.
--
-- schedule_templates    One saved schedule: a name, a section, and the week's
--                       cells BY PERSON (staff id), never by roster row — rows
--                       move when the roster changes; people don't.
--   section             'foh' | 'bohkitchen' | 'management' (the units the app
--                       locks and publishes; BOH & Kitchen is one unit)
--   cells               [{ staff_id, name, group_key, weekday, code }]
--                       group_key: null for Front of House, else 'boh' /
--                       'kitchen' / 'management'. weekday 0 = Sunday.
--                       name = the name when saved, to say who was skipped
--                       even if that staff record is later deleted.
--   Names are unique per section (case-insensitive); saving under an existing
--   name is an overwrite, and the app asks first.
--
-- schedule_template_applies   One row per apply.
--   changes             [{ staff_id, name, group_key, slot_index, weekday, before, after }]
--                       every cell the apply changed, with what it held before.
--   undone_at           set when undone. Undo refuses if any of those cells no
--                       longer holds what the apply wrote (edited since).
--
-- shift_option_usage (0026) now also counts saved schedules, so a shift option
-- that only a saved schedule uses still can't be deleted.
--
-- NOT RLS: like every table here, any signed-in user (roadmap item 10).

create table if not exists public.schedule_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  section     text not null check (section in ('foh', 'bohkitchen', 'management')),
  cells       jsonb not null default '[]'::jsonb check (jsonb_typeof(cells) = 'array'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists schedule_templates_name_per_section
  on public.schedule_templates (section, lower(btrim(name)));

create table if not exists public.schedule_template_applies (
  id             uuid primary key default gen_random_uuid(),
  template_id    uuid references public.schedule_templates(id) on delete set null,
  template_name  text not null,
  section        text not null check (section in ('foh', 'bohkitchen', 'management')),
  week_start     date not null,
  changes        jsonb not null default '[]'::jsonb check (jsonb_typeof(changes) = 'array'),
  applied_at     timestamptz not null default now(),
  undone_at      timestamptz
);
create index if not exists schedule_template_applies_week
  on public.schedule_template_applies (week_start, section, applied_at desc);

alter table public.schedule_templates enable row level security;
alter table public.schedule_template_applies enable row level security;
do $$ begin
  create policy schedule_templates_authenticated_all on public.schedule_templates
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy schedule_template_applies_authenticated_all on public.schedule_template_applies
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

comment on table public.schedule_templates is
  'Saved schedules: one section''s week by staff id, applied to other weeks from Set Schedule (migration 0028).';
comment on table public.schedule_template_applies is
  'Every apply of a saved schedule, with each changed cell''s before/after, for undo (migration 0028).';

-- shift_option_usage, as in 0026, plus a 'saved schedules' source.
create or replace function public.shift_option_usage(p_role text, p_code text)
returns table (source text, cells bigint)
language sql
stable
as $$
  with places(place, roles) as (
    values ('kitchen',    array['Kitchen']),
           ('boh',        array['BOH']),
           ('management', array['Management', 'Expo']),
           ('foh',        array['Servers', 'Busser/Runner', 'Host', 'Expo', 'Bar', 'Training'])
  ),
  -- the grids where this option is the only one carrying this code
  mine as (
    select p.place from places p
     where p_role = any (p.roles)
       and not exists (select 1 from public.role_shift_options o
                        where o.code = p_code and o.role = any (p.roles) and o.role <> p_role)
  ),
  only_anywhere as (
    select not exists (select 1 from public.role_shift_options o
                        where o.code = p_code and o.role <> p_role) as yes
  )
  select 'per-week, ' || case w.group_key when 'boh' then 'BOH' when 'kitchen' then 'Kitchen' else 'Management' end, count(*)
    from public.weekly_placeholder_schedules w
   where w.shift_type = p_code and w.group_key in (select place from mine)
   group by w.group_key
  union all
  select 'template, ' || case t.group_key when 'boh' then 'BOH' when 'kitchen' then 'Kitchen' else 'Management' end, count(*)
    from public.placeholder_schedule t
   where t.shift_type = p_code and t.group_key in (select place from mine)
   group by t.group_key
  union all
  select 'per-week, Front of House', count(*)
    from public.weekly_schedules w join public.staff s on s.id = w.staff_id
   where w.shift_type = p_code and lower(coalesce(s.section, 'foh')) = 'foh'
     and 'foh' in (select place from mine)
  having count(*) > 0
  union all
  select 'template, Front of House', count(*)
    from public.schedule_patterns t join public.staff s on s.id = t.staff_id
   where t.shift_type = p_code and lower(coalesce(s.section, 'foh')) = 'foh'
     and 'foh' in (select place from mine)
  having count(*) > 0
  union all
  select 'Rail / day-of overrides', count(*)
    from public.schedule_overrides r
   where r.override_type = p_code and p_code not in ('OFF', 'GAP')
     and (select yes from only_anywhere)
  having count(*) > 0
  union all
  select 'saved schedules', count(*)
    from public.schedule_templates st, jsonb_array_elements(st.cells) c
   where c->>'code' = p_code
     and coalesce(c->>'group_key', 'foh') in (select place from mine)
  having count(*) > 0;
$$;

-- Checks (read-only):
--   1) both tables, empty:
--        select (select count(*) from public.schedule_templates) as saved,
--               (select count(*) from public.schedule_template_applies) as applies;
--   2) the usage count still matches 0026 for the two retired options
--      (KITCHEN 182 + 25, BOH_AM 46 + 5 as of 2026-10-29; no 'saved schedules' line yet):
--        select * from public.shift_option_usage('Kitchen', 'KITCHEN');
