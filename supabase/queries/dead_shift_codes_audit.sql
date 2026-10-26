-- READ-ONLY. Every stored schedule cell whose code is not a current dropdown
-- option — the cells the Set Schedule grid shows as "Off" while Print, the PDFs,
-- the published schedule, Glance and the Tip Sheet treat them as a working day.
-- Selects only — writes nothing. Run in the Supabase SQL editor; paste every
-- result back.
--
-- "Current option" = what the grid itself checks:
--   kitchen slots    -> role_shift_options for role 'Kitchen'
--   boh slots        -> role 'BOH'
--   management slots -> role 'Management' or 'Expo' (managers can be put on
--                       Expo), plus 'FM'
--   FOH people       -> any FOH role's options (Servers, Busser/Runner, Host,
--                       Expo, Bar, Training). The FOH grid picks the role from
--                       the code's prefix, so a code no FOH role lists is dead.
-- 'OFF' and empty are never counted.

-- 0) The one fact the Jenny explanation rests on: is bare KITCHEN still an
--    option, and what code does the option labelled "Yes" use?
select role, code, label, is_off, sort_order
  from public.role_shift_options
 where role = 'Kitchen' and (code = 'KITCHEN' or label = 'Yes');

with opts as (
  select role, code from public.role_shift_options
),
cells as (
  select 'weekly (per-week record)' as source, week_start::text as week, group_key, slot_index, slot_name, weekday, shift_type
    from public.weekly_placeholder_schedules
  union all
  select 'template', null, group_key, slot_index, null, weekday, shift_type
    from public.placeholder_schedule
),
dead as (
  select c.* from cells c
   where coalesce(c.shift_type, '') not in ('', 'OFF')
     and not exists (
       select 1 from opts o
        where o.code = c.shift_type
          and o.role = any (case c.group_key
                              when 'kitchen'    then array['Kitchen']
                              when 'boh'        then array['BOH']
                              when 'management' then array['Management', 'Expo']
                              else array[]::text[] end))
     and not (c.group_key = 'management' and c.shift_type = 'FM')
)
-- 1) BOH / Kitchen / Management: the count by source, group and dead code.
select source, group_key, shift_type, count(*) as cells,
       min(week) as first_week, max(week) as last_week
  from dead
 group by source, group_key, shift_type
 order by source, group_key, cells desc;

-- 2) The same cells one by one (who, which week, which day; weekday 0 = Sun).
with opts as (select role, code from public.role_shift_options),
cells as (
  select 'weekly' as source, week_start::text as week, group_key, slot_index, slot_name, weekday, shift_type
    from public.weekly_placeholder_schedules
  union all
  select 'template', null, group_key, slot_index, null, weekday, shift_type
    from public.placeholder_schedule
)
select c.source, c.week, c.group_key, c.slot_index, c.slot_name, c.weekday, c.shift_type
  from cells c
 where coalesce(c.shift_type, '') not in ('', 'OFF')
   and not exists (
     select 1 from opts o
      where o.code = c.shift_type
        and o.role = any (case c.group_key
                            when 'kitchen'    then array['Kitchen']
                            when 'boh'        then array['BOH']
                            when 'management' then array['Management', 'Expo']
                            else array[]::text[] end))
   and not (c.group_key = 'management' and c.shift_type = 'FM')
 order by c.source, c.week nulls first, c.group_key, c.slot_index, c.weekday;

-- 3) Front of House: per-week records and the template, by person.
with fohcodes as (
  select code from public.role_shift_options
   where role in ('Servers', 'Busser/Runner', 'Host', 'Expo', 'Bar', 'Training')
),
cells as (
  select 'weekly' as source, w.week_start::text as week, w.staff_id, w.weekday, w.shift_type
    from public.weekly_schedules w
  union all
  select 'template', null, p.staff_id, p.weekday, p.shift_type
    from public.schedule_patterns p
)
select c.source, c.week, s.name, s.section, c.weekday, c.shift_type
  from cells c
  join public.staff s on s.id = c.staff_id
 where coalesce(c.shift_type, '') not in ('', 'OFF')
   and lower(coalesce(s.section, 'foh')) = 'foh'
   and c.shift_type not in (select code from fohcodes)
 order by c.source, c.week nulls first, s.name, c.weekday;
