-- Migration 0027: a locked section-week can't be changed — enforced by the
-- database, whatever any open copy of the app believes.
-- Run in the Supabase SQL editor. Emails nobody; changes no existing value.
--
-- Why: the section lock (0013) was only ever checked by the app, from what it
-- loaded when it opened. A phone left open since Tuesday didn't know about a
-- lock set on Wednesday: no banner, and its dropdowns (and its Save button)
-- still wrote to the locked week. The emailed / printed copy was then the only
-- record of what had actually been sent.
--
-- What it guards: the per-week cells —
--   weekly_schedules              -> Front of House    (schedule_weeks section 'FOH')
--   weekly_placeholder_schedules  -> boh / kitchen     ('BOHKITCHEN')
--                                    management        ('MANAGEMENT')
-- A cell whose (week_start, section) row in schedule_weeks has locked = true:
--   - UPDATE that changes the shift (or moves the row)    -> refused
--   - INSERT of anything but what the week already shows -> refused
--       (an untouched week shows the template, so inserting the template's
--        value is a snapshot, not a change — older copies of the app seed a
--        whole week when any one section is edited, and that must still work)
--   - DELETE                                              -> refused, except
--       when the staff member is being deleted (the cascade from staff)
-- An UPDATE that leaves the shift as it is (a re-save of the same value, a
-- slot_name or updated_at change) is allowed.
--
-- NOT guarded, on purpose: schedule_overrides (Rail time off, swaps, day-of
-- changes). Approving time off on a published week must keep working; those
-- are separate records on top of the schedule, not edits to it.
-- NOT guarded: the templates (schedule_patterns / placeholder_schedule). The
-- app snapshots a week into its own rows when it's locked, so a later template
-- edit can't move it — see check 2 below for locked weeks that predate that.
--
-- NOT RLS. Who may lock and unlock is still "anyone signed in" (roadmap item 10).
--
-- ---- DELIBERATELY OVERRIDING THE GUARD -----------------------------------------
-- A refusal reading "… is locked for the week of …" means the guard is doing its
-- job, not that the app is broken. The normal way through is to UNLOCK the
-- section in Set Schedule, change it, and lock it again. If you ever need to
-- change a locked week in SQL without unlocking, do it in ONE transaction so
-- the guard is never left off:
--
--   begin;
--   alter table public.weekly_schedules disable trigger weekly_schedules_lock_guard;
--   alter table public.weekly_placeholder_schedules disable trigger weekly_placeholder_schedules_lock_guard;
--   -- ... your change ...
--   alter table public.weekly_schedules enable trigger weekly_schedules_lock_guard;
--   alter table public.weekly_placeholder_schedules enable trigger weekly_placeholder_schedules_lock_guard;
--   commit;
--
-- If anything fails before commit, run `rollback;` — the triggers come back on
-- with it. Check they're on afterwards (check 1 at the bottom of this file).
-- --------------------------------------------------------------------------------

create or replace function public.schedule_section_locked(p_week date, p_section text)
returns boolean
language sql
stable
as $$
  select coalesce((select locked from public.schedule_weeks
                    where week_start = p_week and section = p_section), false);
$$;

comment on function public.schedule_section_locked(date, text) is
  'True when that section of that week is locked (schedule_weeks, migration 0013).';

create or replace function public.weekly_schedules_lock_guard()
returns trigger
language plpgsql
as $$
declare
  tmpl text;
begin
  if tg_op = 'INSERT' then
    if public.schedule_section_locked(new.week_start, 'FOH') then
      select shift_type into tmpl from public.schedule_patterns
       where staff_id = new.staff_id and weekday = new.weekday;
      if new.shift_type is distinct from coalesce(tmpl, 'OFF') then
        raise exception 'Front of House is locked for the week of % — unlock it in Set Schedule to change it.', new.week_start
          using errcode = 'check_violation';
      end if;
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if (new.shift_type is distinct from old.shift_type or new.week_start is distinct from old.week_start
        or new.staff_id is distinct from old.staff_id or new.weekday is distinct from old.weekday)
       and (public.schedule_section_locked(old.week_start, 'FOH') or public.schedule_section_locked(new.week_start, 'FOH')) then
      raise exception 'Front of House is locked for the week of % — unlock it in Set Schedule to change it.', old.week_start
        using errcode = 'check_violation';
    end if;
    return new;
  else -- DELETE
    if public.schedule_section_locked(old.week_start, 'FOH')
       and exists (select 1 from public.staff where id = old.staff_id) then
      raise exception 'Front of House is locked for the week of % — unlock it in Set Schedule to change it.', old.week_start
        using errcode = 'check_violation';
    end if;
    return old;
  end if;
end
$$;

create or replace function public.weekly_placeholder_schedules_lock_guard()
returns trigger
language plpgsql
as $$
declare
  sec_old text;
  sec_new text;
  label text;
  tmpl text;
begin
  if tg_op <> 'INSERT' then
    sec_old := case old.group_key when 'management' then 'MANAGEMENT' else 'BOHKITCHEN' end;
  end if;
  if tg_op <> 'DELETE' then
    sec_new := case new.group_key when 'management' then 'MANAGEMENT' else 'BOHKITCHEN' end;
  end if;
  label := case coalesce(sec_new, sec_old) when 'MANAGEMENT' then 'Management' else 'BOH+Kitchen' end;

  if tg_op = 'INSERT' then
    if public.schedule_section_locked(new.week_start, sec_new) then
      select shift_type into tmpl from public.placeholder_schedule
       where group_key = new.group_key and slot_index = new.slot_index and weekday = new.weekday;
      if new.shift_type is distinct from coalesce(tmpl, 'OFF') then
        raise exception '% is locked for the week of % — unlock it in Set Schedule to change it.', label, new.week_start
          using errcode = 'check_violation';
      end if;
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if (new.shift_type is distinct from old.shift_type or new.week_start is distinct from old.week_start
        or new.group_key is distinct from old.group_key or new.slot_index is distinct from old.slot_index
        or new.weekday is distinct from old.weekday)
       and (public.schedule_section_locked(old.week_start, sec_old) or public.schedule_section_locked(new.week_start, sec_new)) then
      raise exception '% is locked for the week of % — unlock it in Set Schedule to change it.', label, old.week_start
        using errcode = 'check_violation';
    end if;
    return new;
  else -- DELETE
    if public.schedule_section_locked(old.week_start, sec_old) then
      raise exception '% is locked for the week of % — unlock it in Set Schedule to change it.', label, old.week_start
        using errcode = 'check_violation';
    end if;
    return old;
  end if;
end
$$;

drop trigger if exists weekly_schedules_lock_guard on public.weekly_schedules;
create trigger weekly_schedules_lock_guard
  before insert or update or delete on public.weekly_schedules
  for each row execute function public.weekly_schedules_lock_guard();

drop trigger if exists weekly_placeholder_schedules_lock_guard on public.weekly_placeholder_schedules;
create trigger weekly_placeholder_schedules_lock_guard
  before insert or update or delete on public.weekly_placeholder_schedules
  for each row execute function public.weekly_placeholder_schedules_lock_guard();

-- Checks (read-only):
--   1) both triggers present and ENABLED (tgenabled 'O'; 'D' = disabled):
--        select tgrelid::regclass as tbl, tgname, tgenabled from pg_trigger
--         where tgname in ('weekly_schedules_lock_guard', 'weekly_placeholder_schedules_lock_guard');
--   2) locked section-weeks that have NO cells of their own: they still show
--      the template, so a template edit would change them. Unlock + relock in
--      the new app (which snapshots the week on lock) to pin each one.
--        select w.week_start, w.section, w.locked_at
--          from public.schedule_weeks w
--         where w.locked and w.section in ('FOH', 'BOHKITCHEN', 'MANAGEMENT')
--           and not exists (
--             select 1 from public.weekly_schedules c
--              where w.section = 'FOH' and c.week_start = w.week_start
--             union all
--             select 1 from public.weekly_placeholder_schedules c
--              where w.section <> 'FOH' and c.week_start = w.week_start
--                and (case c.group_key when 'management' then 'MANAGEMENT' else 'BOHKITCHEN' end) = w.section)
--         order by w.week_start, w.section;
