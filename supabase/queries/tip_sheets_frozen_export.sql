-- READ-ONLY. Every sent, locked or finalized Tip Sheet's stored inputs, as one
-- JSON array, for the offline "method 1 hasn't moved" check (item 1).
-- Selects only — writes nothing.
--
-- Run in the Supabase SQL editor. Copy the single cell it returns into a file
-- OUTSIDE the repo (the repo must never hold real payroll data), e.g.
--   C:\Users\Lenre\haenyeo-tip-export.json
-- and tell me the path. The check script reads it from there and writes nothing.
--
-- select * on purpose: the check needs every input the sheet computes from
-- (cash and CC, covers, opening/closing counts, payouts, cash sales, clock
-- times, roster snapshot, slot overrides and the rule flags), and taking the
-- whole row means a column we forgot can't quietly drop out of the check.

select json_agg(t order by t.date)
  from (
    select *
      from public.tip_sheets
     where sent is true or locked is true or finalized is true
  ) t;
