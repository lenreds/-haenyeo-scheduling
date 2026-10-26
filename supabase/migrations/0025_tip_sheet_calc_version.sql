-- Migration 0025: tip_sheets.calc_version — the arithmetic a sheet was paid with.
-- Run in the Supabase SQL editor. Emails nobody; changes no existing value.
--
-- calc_version   Which calculation method produced the sheet's figures.
--                NULL = method 1 (truncate once, at display). Every row that
--                exists when this runs stays NULL, i.e. method 1, for good —
--                including unsent drafts, because a printed, paid, never-locked
--                sheet is still a payment record.
--                Only a date with NO row yet can become method 2, and only once
--                the app that implements method 2 is deployed.
--
-- The trigger makes the value permanent: it can be set when a row is created
-- and never changed afterwards, by anything. If the app ever believes a date
-- has no sheet when it does (a failed load) and tries to stamp a method onto an
-- existing paid sheet, the save fails loudly instead.

alter table public.tip_sheets
  add column if not exists calc_version smallint;

alter table public.tip_sheets
  drop constraint if exists tip_sheets_calc_version_valid;
alter table public.tip_sheets
  add constraint tip_sheets_calc_version_valid check (calc_version is null or calc_version >= 1);

create or replace function public.tip_sheets_calc_version_fixed()
returns trigger
language plpgsql
as $$
begin
  if new.calc_version is distinct from old.calc_version then
    raise exception 'tip_sheets.calc_version can only be set when a sheet is created (date %, stored %, attempted %)',
      old.date, coalesce(old.calc_version::text, 'none = method 1'), coalesce(new.calc_version::text, 'none')
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

drop trigger if exists tip_sheets_calc_version_fixed on public.tip_sheets;
create trigger tip_sheets_calc_version_fixed
  before update on public.tip_sheets
  for each row execute function public.tip_sheets_calc_version_fixed();

comment on column public.tip_sheets.calc_version is
  'Calculation method the sheet was paid with. NULL = method 1. Set on insert only (trigger tip_sheets_calc_version_fixed).';

-- Check (read-only): every existing row should be NULL, and the trigger present.
--   select count(*) as rows, count(calc_version) as stamped from public.tip_sheets;
--   select tgname from pg_trigger where tgrelid = 'public.tip_sheets'::regclass and not tgisinternal;
