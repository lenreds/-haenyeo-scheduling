-- Migration 0019: "counts as off" flag on shift options. Run in the Supabase
-- SQL editor. Idempotent — safe to run more than once.
--
-- Why: an "RO" option added to a role's dropdown gets a real shift code
-- (e.g. SV_RO), so the who-is-working gate treated those staff as working —
-- they showed on Today at a Glance (labelled "RO") and could take a paid Tip
-- Sheet slot. Matching on the label would just move the bug to the next
-- wording, so the option itself now says whether it means "off".
--
-- The app treats a cell as off when its option has is_off = true, and ALSO
-- (regardless of this column) when the cell is empty or plain OFF — so nothing
-- about Off depends on this migration having run.

-- 1) The flag ------------------------------------------------------------------
alter table public.role_shift_options
  add column if not exists is_off boolean not null default false;

comment on column public.role_shift_options.is_off is
  'Counts as off: staff on this option are excluded from Today at a Glance and the Tip Sheet, but the option still shows on the schedule grid. Set per option in Staff > Manage Shifts.';

-- 2) Flag the options that already mean "off" ----------------------------------
-- One-time data fix so cells already on the grid read correctly without
-- editing any schedules. This label match is ONLY for this backfill — the app
-- never matches labels. Anything it misses (or wrongly catches) can be ticked
-- or unticked in Manage Shifts; the SELECT at the bottom shows what it set.
update public.role_shift_options
   set is_off = true
 where is_off = false
   and (
         code = 'OFF'
      or label ~* '^\s*(r\s*[./]?\s*o\.?|req(uest)?\.?\s*off|off)\s*$'
      or code ~* '_(RO|REQOFF|REQUESTOFF)\d*$'
   );

-- 3) Show every flagged option so you can check the backfill ------------------
select role, code, label, is_off
  from public.role_shift_options
 where is_off
 order by role, sort_order;
