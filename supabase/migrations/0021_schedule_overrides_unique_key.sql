-- Migration 0021: unique (staff_id, date) on schedule_overrides. Run in the
-- Supabase SQL editor. Idempotent — safe to run more than once.
--
-- Why: every override write in the app is an upsert keyed on (staff_id, date)
-- — Today at a Glance swap / remove, Tip Sheet day-of add / remove, and every
-- Rail approval (Request Off, Time Off, Coverage, Shift Swap). 0001 declares
-- that key, but 0001 used "create table if not exists", so a live table that
-- already existed never got it. Without it Postgres rejects every one of those
-- upserts: "there is no unique or exclusion constraint matching the ON
-- CONFLICT specification". The constraint also stops two override rows ever
-- existing for one person on one date.
--
-- If duplicate (staff_id, date) rows already exist, adding the constraint
-- would fail with a different-looking error. This checks first and stops with
-- a count instead, changing nothing — inspect and resolve them, then rerun.

do $$
declare
  dupes integer;
begin
  if exists (
    select 1
      from pg_index i
     where i.indrelid = 'public.schedule_overrides'::regclass
       and i.indisunique
       and i.indpred is null
       and (select array_agg(a.attname::text) from pg_attribute a
             where a.attrelid = i.indrelid and a.attnum = any(i.indkey))
           @> array['staff_id', 'date']
       and (select array_agg(a.attname::text) from pg_attribute a
             where a.attrelid = i.indrelid and a.attnum = any(i.indkey))
           <@ array['staff_id', 'date']
  ) then
    raise notice 'schedule_overrides already has unique (staff_id, date) — nothing to do';
    return;
  end if;

  select count(*) into dupes
    from (select 1 from public.schedule_overrides
           group by staff_id, date having count(*) > 1) d;

  if dupes > 0 then
    raise exception '% person/date pair(s) in schedule_overrides have more than one row. Nothing was changed. Inspect them with the duplicates query, resolve, then rerun 0021.', dupes;
  end if;

  alter table public.schedule_overrides
    add constraint schedule_overrides_staff_id_date_key unique (staff_id, date);
  raise notice 'added schedule_overrides_staff_id_date_key unique (staff_id, date)';
end $$;
