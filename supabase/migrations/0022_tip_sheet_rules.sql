-- Migration 0022: per-date Tip Sheet rules. Run in the Supabase SQL editor.
-- Idempotent — safe to run more than once. Adds columns only; no existing
-- value is changed.
--
-- expo_as_busser    The night's Expo ran as a 3rd Busser/Runner (0.6 points
--                   instead of 0.3). Default false, so every existing sheet
--                   stays Expo.
-- bar_tip_out_auto  How bar_tip_out was decided: true = the automatic rule (bar
--                   cash + CC tips strictly over $60.00), false = set by hand.
--                   NULL on every existing row = decided before the rule
--                   existed; a sent or locked sheet with NULL keeps the
--                   bar_tip_out it recorded and is never re-run.
-- closing_sum_auto  true = closing_sum was filled from the Closing column
--                   total, false = typed by hand. NULL on existing rows: the
--                   recorded closing_sum stands as typed.

alter table public.tip_sheets
  add column if not exists expo_as_busser boolean not null default false;
alter table public.tip_sheets
  add column if not exists bar_tip_out_auto boolean;
alter table public.tip_sheets
  add column if not exists closing_sum_auto boolean;

comment on column public.tip_sheets.expo_as_busser is
  'True = the Expo slot ran as a 3rd Busser/Runner at 0.6 points on this date.';
comment on column public.tip_sheets.bar_tip_out_auto is
  'True = bar_tip_out set by the over-$60 rule; false = set by hand; null = recorded before the rule.';
comment on column public.tip_sheets.closing_sum_auto is
  'True = closing_sum filled from the Closing count total; false = typed by hand; null = recorded before auto-fill.';

-- Check: every row should show expo_as_busser = false and both flags null.
select count(*) as tip_sheets,
       count(*) filter (where expo_as_busser) as expo_as_busser_true,
       count(bar_tip_out_auto) as bar_flag_set,
       count(closing_sum_auto) as closing_flag_set
  from public.tip_sheets;
