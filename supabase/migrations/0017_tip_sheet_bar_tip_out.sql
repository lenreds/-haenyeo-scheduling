-- Migration 0017: optional bar tip-out per night. Run in the Supabase SQL editor.
-- Idempotent — safe to run more than once.
--
-- The 10% bar tip-out (split among Busser/Runners and Expo) was always applied.
-- On slow bar nights the manager can now turn it off for a date from the Tip
-- Sheet: the tip-out is $0.00, the bar keeps its full tips, and no bar share is
-- distributed. Default true, so every existing sheet keeps its tip-out.

alter table public.tip_sheets
  add column if not exists bar_tip_out boolean not null default true;

comment on column public.tip_sheets.bar_tip_out is
  'Whether the 10% bar tip-out was charged on this date. False = bar kept its full tips; Busser/Runner and Expo got no bar share.';
