-- Re-add the two retired shift codes that 280+ stored schedule cells still use,
-- so those cells are valid options again: the red "? KITCHEN" / "? BOH_AM" flags
-- clear and the Set Schedule screen agrees with Print. NO schedule cell changes.
-- Nothing here emails anyone or publishes anything.
--
-- Run in the Supabase SQL editor, ONE STEP AT A TIME, reading each result.
--
-- Labels are chosen to match what Print already shows for these codes (Print
-- reads the app's built-in labels first, so a different label here would make
-- the dropdown and the printed sheet disagree):
--   KITCHEN -> "3p – Close"  (Jenny and Ajuma still see and print "Yes")
--   BOH_AM  -> "9a – 5p"
-- KITCHEN_FM (2 cells, week of 3 Aug, past) is left as it is: it stays flagged
-- on screen, and that week is never offered for publishing.

-- STEP 1 — look first. Is either code already present (then step 2 skips it)?
-- And is there already an option with the same label, under another code?
-- If a BOH "9a – 5p" or Kitchen "3p – Close" exists with a different code,
-- re-adding gives that dropdown two identical-looking entries. Tell me before
-- running step 2 if so.
select role, code, label, is_off, sort_order
  from public.role_shift_options
 where (role = 'Kitchen' and (code = 'KITCHEN' or label in ('3p – Close', 'Yes')))
    or (role = 'BOH'     and (code = 'BOH_AM'  or label = '9a – 5p'))
 order by role, sort_order;

-- STEP 2 — the two inserts. Each only inserts if that code isn't there already.
insert into public.role_shift_options (role, code, label, is_off, sort_order)
select 'Kitchen', 'KITCHEN', '3p – Close', false, 90
 where not exists (select 1 from public.role_shift_options where role = 'Kitchen' and code = 'KITCHEN');

insert into public.role_shift_options (role, code, label, is_off, sort_order)
select 'BOH', 'BOH_AM', '9a – 5p', false, 90
 where not exists (select 1 from public.role_shift_options where role = 'BOH' and code = 'BOH_AM');

-- STEP 3 — check. Re-run part 1 of supabase/queries/dead_shift_codes_audit.sql:
-- only KITCHEN_FM (2 cells) should remain. Then reload the app.
