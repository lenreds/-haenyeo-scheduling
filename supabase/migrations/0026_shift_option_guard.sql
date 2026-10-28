-- Migration 0026: shift options can be retired, can't be deleted while in use,
-- and their code and role can't be changed once they exist.
-- Run in the Supabase SQL editor. Emails nobody; changes no existing value.
--
-- Why: deleting a shift option that cells still held (KITCHEN, BOH_AM) left
-- 284 stored cells pointing at nothing, and nothing said so for weeks. Changing
-- an option's code would do exactly the same with no delete involved.
--
-- retired       A retired option is still a valid option for every cell that
--               already holds it (normal label, normal colour, no flag). It is
--               only left out of the dropdowns when someone picks a shift for a
--               new cell. Reversible: set it back to false.
--
-- shift_option_usage(role, code)
--               How many stored cells would be left holding an unknown code if
--               this option were gone, by where they are: per-week records and
--               templates for Front of House, BOH & Kitchen and Management, and
--               Rail / day-of overrides. A cell only counts if no OTHER option
--               that applies to the same grid carries the same code. Read-only.
--               Manage Shifts asks this before offering Delete.
--
-- Trigger role_shift_options_guard
--               - code and role are READ-ONLY once an option exists. Schedules
--                 store codes, so changing one orphans every cell holding it.
--                 (The app never changes them; this closes every other route —
--                 direct API calls, the table editor, the SQL editor, a future
--                 migration.) Renaming the LABEL is fine and stays allowed.
--               - a DELETE is refused while shift_option_usage counts any cell.
--                 Retire it instead. Deleting an option nothing uses still works.
--
-- NOT RLS. Any signed-in user can still write to this table (and every other).
-- This trigger limits what a write can break; it doesn't decide who may write.
-- Real RLS with a manager role is still needed before any new login is made.
--
-- ---- DELIBERATELY OVERRIDING THE GUARD -----------------------------------------
-- If you ever see "code and role are read-only" or "is used by N cell(s)" and
-- there is a genuine reason to go ahead (e.g. you are moving every cell to a new
-- code in the same change), the app isn't broken — this trigger is doing its job.
-- To override it, do the whole change in ONE transaction so the guard is never
-- left off:
--
--   begin;
--   alter table public.role_shift_options disable trigger role_shift_options_guard;
--   -- ... your change, AND the matching update to every cell holding the old
--   --     code (weekly_schedules, schedule_patterns, weekly_placeholder_schedules,
--   --     placeholder_schedule, schedule_overrides.override_type) ...
--   alter table public.role_shift_options enable trigger role_shift_options_guard;
--   commit;
--
-- If anything fails before commit, run `rollback;` — the trigger comes back on
-- with it. Check it's on afterwards (last query at the bottom of this file).
-- --------------------------------------------------------------------------------

alter table public.role_shift_options
  add column if not exists retired boolean not null default false;

comment on column public.role_shift_options.retired is
  'Retired: still valid for cells that hold it, not offered for new cells. Reversible.';

-- Which grids an option's role applies to (mirrors the app):
--   kitchen grid    -> Kitchen
--   boh grid        -> BOH
--   management grid -> Management, Expo (managers can be put on Expo)
--   Front of House  -> Servers, Busser/Runner, Host, Expo, Bar, Training
--                      (staff.section FOH; the FOH grid picks the role from the
--                      code, so any FOH role's option makes a code valid there)
--   Rail / day-of   -> any role (an override holds a bare code)
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
  having count(*) > 0;
$$;

comment on function public.shift_option_usage(text, text) is
  'Read-only: stored cells that would hold an unknown code if this shift option were gone, by source.';

create or replace function public.role_shift_options_guard()
returns trigger
language plpgsql
as $$
declare
  n bigint;
  detail text;
begin
  if tg_op = 'UPDATE' then
    if new.code is distinct from old.code or new.role is distinct from old.role then
      raise exception 'role_shift_options: code and role are read-only once a shift option exists (% / %, attempted % / %). Schedules store the code, so changing it would orphan every cell holding it. Rename the label instead; see migration 0026 for a deliberate override.',
        old.role, old.code, new.role, new.code
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- DELETE
  select coalesce(sum(u.cells), 0), string_agg(u.source || ' ' || u.cells, ', ')
    into n, detail
    from public.shift_option_usage(old.role, old.code) u;
  if n > 0 then
    raise exception 'role_shift_options: % / % is used by % cell(s) (%). Retire it instead (retired = true); see migration 0026 for a deliberate override.',
      old.role, old.code, n, detail
      using errcode = 'restrict_violation';
  end if;
  return old;
end
$$;

drop trigger if exists role_shift_options_guard on public.role_shift_options;
create trigger role_shift_options_guard
  before update or delete on public.role_shift_options
  for each row execute function public.role_shift_options_guard();

-- Checks (read-only):
--   1) the column, and nothing retired yet:
--        select count(*) as options, count(*) filter (where retired) as retired from public.role_shift_options;
--   2) the counts for the two options to be retired (expect KITCHEN ~226, BOH_AM ~56):
--        select * from public.shift_option_usage('Kitchen', 'KITCHEN');
--        select * from public.shift_option_usage('BOH', 'BOH_AM');
--   3) the trigger is present and ENABLED (tgenabled 'O'; 'D' = disabled):
--        select tgname, tgenabled from pg_trigger
--         where tgrelid = 'public.role_shift_options'::regclass and not tgisinternal;
