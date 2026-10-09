-- Look-back: saved Tip Sheets with a payout-hours problem. READ ONLY — a
-- single SELECT; it creates, changes and recalculates nothing. Run it in the
-- Supabase SQL editor. This is not a migration.
--
-- Two lists, one row per person-slot, ordered by date:
--   list 1 "0 HRS"  someone carrying points with HRS 0.00 (missing or
--                   unreadable time). Servers / Busser/Runners: their share
--                   went to the others in the same role. Bar, when they were
--                   the only bartender with hours, Expo, Host: nobody got it.
--   list 2 ">14 HRS" HRS above 14 — the midnight wrap (TIME OUT "1" or
--                   "12:30" after an evening start reads as the next afternoon).
--
-- HRS is computed exactly as the sheet computes it (lib/tipTimes.js
-- parseTimeInput -> roundToQuarter -> hoursBetween), from the stored text.
--
-- Names: the sheet only stores who was in a slot when it was pinned on
-- send/lock (roster_snapshot, migration 0023) or in Custom Schedule
-- (slot_overrides). Otherwise the name comes from the schedule and shows here
-- as "(from schedule)" — open that date on the Tip Sheet to see who it was.
-- Time cells can't be typed into an empty slot, so a slot with any time typed
-- had a person in it. A slot with NO times and no stored name can't be told
-- apart from an empty slot here, so those aren't listed; see the note in the
-- report.

with slot_defs(slot_id, ord, role, default_pts) as (
  values ('server1', 1, 'Server', 1.0), ('server2', 2, 'Server', 1.0),
         ('server3', 3, 'Server (Swing)', 0.55), ('busser1', 4, 'Busser/Runner', 0.6),
         ('busser2', 5, 'Busser/Runner', 0.6), ('expo', 6, 'Expo', 0.3),
         ('host', 7, 'Host', 0.1), ('bar1', 8, 'Bartender', 0.85),
         ('bar2', 9, 'Bartender (Swing)', 0.3)
),
sheets as (
  -- to_jsonb(t) so this runs whether or not 0022 / 0023 have been applied.
  select t.date, to_jsonb(t) as j from public.tip_sheets t
),
cells as (
  select s.date, d.slot_id, d.ord, d.role, d.default_pts, s.j,
         coalesce(s.j->'time_entries'->d.slot_id->>'in', '')  as time_in,
         coalesce(s.j->'time_entries'->d.slot_id->>'out', '') as time_out,
         coalesce((s.j->>'sent')::boolean, false) or coalesce((s.j->>'locked')::boolean, false)
           or coalesce((s.j->>'finalized')::boolean, false) as frozen,
         coalesce(s.j->'slot_overrides', '{}'::jsonb) <> '{}'::jsonb as custom
    from sheets s cross join slot_defs d
),
named as (
  select c.*,
         case
           when c.frozen and jsonb_typeof(c.j->'roster_snapshot') = 'object' then c.j->'roster_snapshot'->c.slot_id->>'name'
           when c.custom then c.j->'slot_overrides'->c.slot_id->>'name'
         end as stored_name,
         case
           when c.frozen and jsonb_typeof(c.j->'roster_snapshot') = 'object' then (c.j->'roster_snapshot'->c.slot_id->>'pts')::numeric
           when c.custom and c.j->'slot_overrides'->c.slot_id ? 'pts' then (c.j->'slot_overrides'->c.slot_id->>'pts')::numeric
           when c.slot_id = 'host' then case when coalesce((c.j->>'covers')::numeric, 0) > 80 then 0.1 else 0 end
           when c.slot_id = 'expo' and coalesce((c.j->>'expo_as_busser')::boolean, false) then 0.6
           else c.default_pts
         end as pts,
         (c.frozen and jsonb_typeof(c.j->'roster_snapshot') = 'object') or c.custom as name_is_stored
    from cells c
),
parsed as (
  select n.*, pin.m as in_min, pout.m as out_min
    from named n
    cross join lateral (
      select case when r is null then null else
        (case when r[3] = 'pm' and r[1]::int <> 12 then r[1]::int + 12
              when r[3] = 'am' and r[1]::int = 12 then 0
              when r[3] is null and r[1]::int between 1 and 11 then r[1]::int + 12
              else r[1]::int end) * 60 + coalesce(r[2]::int, 0) end as raw
        from (select regexp_match(lower(regexp_replace(n.time_in, '^\s+|\s+$', '', 'g')),
                                  '^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$') as r) x
    ) a
    cross join lateral (select case when a.raw is null then null
                                    when a.raw % 15 <= 7 then a.raw - a.raw % 15
                                    else a.raw + 15 - a.raw % 15 end as m) pin
    cross join lateral (
      select case when r is null then null else
        (case when r[3] = 'pm' and r[1]::int <> 12 then r[1]::int + 12
              when r[3] = 'am' and r[1]::int = 12 then 0
              when r[3] is null and r[1]::int between 1 and 11 then r[1]::int + 12
              else r[1]::int end) * 60 + coalesce(r[2]::int, 0) end as raw
        from (select regexp_match(lower(regexp_replace(n.time_out, '^\s+|\s+$', '', 'g')),
                                  '^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$') as r) x
    ) b
    cross join lateral (select case when b.raw is null then null
                                    when b.raw % 15 <= 7 then b.raw - b.raw % 15
                                    else b.raw + 15 - b.raw % 15 end as m) pout
),
hrs as (
  select p.*,
         case when p.in_min is null or p.out_min is null then 0
              else ((case when p.out_min < p.in_min then p.out_min + 1440 else p.out_min end) - p.in_min) / 60.0
         end as hrs
    from parsed p
)
select case when h.hrs > 14 then '2: >14 HRS' else '1: 0 HRS' end as list,
       h.date,
       case when h.name_is_stored then nullif(h.stored_name, '') else '(from schedule)' end as name,
       h.role,
       h.pts,
       to_char(h.hrs, 'FM990.00') as hrs,
       nullif(h.time_in, '') as time_in,
       nullif(h.time_out, '') as time_out,
       case when h.frozen then 'sent/locked' else 'open' end as sheet
  from hrs h
 where h.hrs > 14
    or (h.hrs = 0 and h.pts > 0 and (
          (h.name_is_stored and coalesce(h.stored_name, '') <> '')
          or (not h.name_is_stored and (h.time_in <> '' or h.time_out <> ''))))
 order by list, h.date, h.ord;
