-- Migration 0024: keep the "$0.00 checked" ticks given before Lock / Send.
-- Run in the Supabase SQL editor. Idempotent — safe to run more than once.
-- Adds one column; no existing value is changed.
--
-- zero_tip_acks  Append-only list, one entry per tick:
--                { slot, name, tip: "0.00", reason, action: "lock" | "send",
--                  by: manager email, at: ISO time }.
--                Written when someone carrying points was paid $0.00 and the
--                manager ticked them as checked to Lock or Send. Never shown
--                on the sheet; kept so a sent sheet that paid someone nothing
--                can always say who checked it and when. Unlocking keeps it.
--                Every existing row gets '[]'.

alter table public.tip_sheets
  add column if not exists zero_tip_acks jsonb not null default '[]'::jsonb;

comment on column public.tip_sheets.zero_tip_acks is
  'Ticks given for $0.00 payouts before Lock/Send: [{slot,name,tip,reason,action,by,at}]. Append-only record, not displayed.';

-- Check: every existing row should show 0 acknowledgements.
select count(*) as tip_sheets,
       count(*) filter (where jsonb_array_length(zero_tip_acks) > 0) as with_acks
  from public.tip_sheets;
