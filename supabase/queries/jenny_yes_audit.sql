-- READ-ONLY. Why the BOH & Kitchen print shows Jenny as "Yes" on a day the
-- Set Schedule screen shows her Off. Selects only — writes nothing.
-- Run in the Supabase SQL editor; paste all three results back.
--
-- The print shows "Yes" only when the stored cell code is exactly 'KITCHEN'
-- (and the name starts with Jenny or Ajuma). The screen shows any code that
-- is NOT in the Kitchen dropdown's current options as Off. So the question is:
-- what code is stored on that day, and is it still an option?

-- 1) The Kitchen dropdown's options as the app loads them. Is 'KITCHEN' here?
--    Is any option marked "Counts as off"?
select role, code, label, is_off, sort_order
  from public.role_shift_options
 where role in ('Kitchen', 'BOH')
 order by role, sort_order;

-- 2) Jenny's stored cells, week by week (kitchen slot 0 is Jenny on the
--    default roster). weekday: 0 = Sun … 6 = Sat.
select week_start, slot_index, slot_name, weekday, shift_type, updated_at
  from public.weekly_placeholder_schedules
 where group_key = 'kitchen'
   and (slot_name ilike 'Jenny%' or slot_index = 0)
 order by week_start desc, slot_index, weekday
 limit 70;

-- 3) The template (used for any week with no record of its own).
select group_key, slot_index, weekday, shift_type
  from public.placeholder_schedule
 where group_key = 'kitchen' and slot_index = 0
 order by weekday;
