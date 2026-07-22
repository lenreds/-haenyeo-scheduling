-- HaenyeoMNG — migration 0006: Jon cross-works Kitchen (Management + Kitchen).
--
-- Run in the Supabase SQL editor. Idempotent.
--
-- Adds Jon to the Kitchen roster (sort_order 5, after Freddy at 4) so he shows
-- as a Kitchen row in the combined "BOH & Kitchen" tab. The app's existing
-- cross-scheduling then blocks him from Kitchen + Management on the same day.
-- Section stays 'Management'; this only grants the extra Kitchen role.

insert into public.staff_roles (staff_id, role, is_primary, sort_order)
select s.id, 'Kitchen', false, 5
from public.staff s
where s.name = 'Jon'
on conflict (staff_id, role) do update set is_primary = excluded.is_primary, sort_order = excluded.sort_order;

-- Kitchen schedule grid: give Jon a slot-5 row (all OFF) so the roster and the
-- schedule rows line up from the start (the app also pads on write, so this is
-- belt-and-suspenders).
insert into public.placeholder_schedule (group_key, slot_index, weekday, shift_type)
select 'kitchen', 5, d.weekday, 'OFF'
from generate_series(0, 6) as d(weekday)
on conflict (group_key, slot_index, weekday) do nothing;
