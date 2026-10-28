-- READ-ONLY. Why does shift_option_usage (0026) give KITCHEN 182 / BOH_AM 46
-- per-week, when the 26 Oct audit counted 201 / 51 (weeks 3 Aug – 9 Nov)?
-- Either the data changed since the audit, or the function misses rows.
-- Selects only — writes nothing. Run in the Supabase SQL editor; paste every
-- result back.
--
-- How to read it:
--   Q1 is the raw count — no option logic, no function. If Q1 says 182 / 46
--      too, the function counts every row there is: the cells changed. If Q1
--      says more than the function, the function is missing rows.
--   Q2 is the same, week by week, all weeks — shows past weeks are there.
--   Q3 lists kitchen / BOH grid cells EDITED since the audit (single-cell edits
--      stamp updated_at; seeding a new week does not), with what they hold now.
--   Q4 lists weeks first written since the audit (new weeks seeded from the
--      template add KITCHEN / BOH_AM cells, so they'd push the count UP).

-- Q1) Raw cells holding KITCHEN or BOH_AM, every grid, both tables.
select 'per-week' as source, group_key, shift_type, count(*) as cells,
       min(week_start) as first_week, max(week_start) as last_week
  from public.weekly_placeholder_schedules
 where shift_type in ('KITCHEN', 'BOH_AM')
 group by group_key, shift_type
union all
select 'template', group_key, shift_type, count(*), null, null
  from public.placeholder_schedule
 where shift_type in ('KITCHEN', 'BOH_AM')
 group by group_key, shift_type
 order by 1, 2, 3;

-- Q2) Per week: KITCHEN on the Kitchen grid, BOH_AM on the BOH grid.
select week_start,
       count(*) filter (where group_key = 'kitchen' and shift_type = 'KITCHEN') as kitchen_cells,
       count(*) filter (where group_key = 'boh' and shift_type = 'BOH_AM') as boh_am_cells
  from public.weekly_placeholder_schedules
 where group_key in ('kitchen', 'boh')
 group by week_start
 order by week_start;

-- Q3) Kitchen / BOH grid cells edited since the audit, and what they hold now.
--     (weekday 0 = Sun.) Look for cells that now hold something else on days
--     that used to be KITCHEN / BOH_AM — e.g. KITCHEN_YES, a station, Off.
select week_start, group_key, slot_name, weekday, shift_type as holds_now,
       updated_at at time zone 'America/New_York' as edited_at
  from public.weekly_placeholder_schedules
 where group_key in ('kitchen', 'boh')
   and updated_at >= timestamptz '2026-10-26 00:00 America/New_York'
 order by updated_at;

-- Q3b) The same, counted: what those edited cells hold now.
select group_key, shift_type as holds_now, count(*) as cells
  from public.weekly_placeholder_schedules
 where group_key in ('kitchen', 'boh')
   and updated_at >= timestamptz '2026-10-26 00:00 America/New_York'
 group by group_key, shift_type
 order by group_key, cells desc;

-- Q4) Weeks first written since the audit.
select week_start, min(created_at) at time zone 'America/New_York' as first_written, count(*) as rows
  from public.weekly_placeholder_schedules
 group by week_start
having min(created_at) >= timestamptz '2026-10-26 00:00 America/New_York'
 order by week_start;
