-- Migration 0029: a locked or finalized tip sheet can't be changed — enforced
-- by the database, whatever any open copy of the app believes.
-- Run in the Supabase SQL editor. Emails nobody; changes no existing value.
--
-- Why: a sheet's lock (0013) and finalized flag (0005) were only ever enforced
-- by the app, and only partly: the time and cash tap panels refused in code,
-- but the typed fields (tips, covers, cash sales, payouts) were blocked by
-- styling alone. Tab reached them, and autosave didn't check the lock — so a
-- sheet already emailed as the payroll record could be rewritten.
--
-- What it guards: a tip_sheets row whose stored locked OR finalized is true —
--   - UPDATE that changes anything the sheet pays from     -> refused
--       (every column except the lock / send / finalize state below)
--   - UPDATE that replaces a pinned roster_snapshot         -> refused,
--       unless the same statement unlocks the sheet (unlocking un-pins it)
--   - DELETE                                                -> refused
-- Allowed on a locked / finalized sheet, because they ARE the lock and send:
--   locked, locked_at, finalized, finalized_at, sent, sent_at,
--   zero_tip_acks (the record of "$0.00 checked" ticks), rev (0030),
--   roster_snapshot set where there was none (pinning a pre-0023 sheet).
-- Unlocking is allowed — but an unlock can't change a figure in the same
-- statement: the figures change only once the stored row is unlocked.
-- Columns added later are guarded automatically: the check compares the whole
-- row minus the allowed list above, not a list of guarded columns.
--
-- calc_version stays guarded by its own trigger (0025) on every sheet.
-- A sent sheet that has been unlocked is editable, as in the app: that is the
-- deliberate correct-and-resend path.
--
-- NOT RLS. Who may lock and unlock is still "anyone signed in" (roadmap item 10).
--
-- ---- DELIBERATELY OVERRIDING THE GUARD -----------------------------------------
-- A refusal reading "The tip sheet for … is locked" means the guard is doing
-- its job. The normal way through is to UNLOCK the sheet on the Tip Sheet,
-- change it, and lock (or re-send) it. If you ever need to change a locked
-- sheet in SQL without unlocking, do it in ONE transaction so the guard is
-- never left off:
--
--   begin;
--   alter table public.tip_sheets disable trigger tip_sheets_lock_guard;
--   -- ... your change ...
--   alter table public.tip_sheets enable trigger tip_sheets_lock_guard;
--   commit;
--
-- If anything fails before commit, run `rollback;` — the trigger comes back on
-- with it. Check it's on afterwards (check 1 at the bottom of this file).
-- --------------------------------------------------------------------------------

create or replace function public.tip_sheets_lock_guard()
returns trigger
language plpgsql
as $$
declare
  status_cols constant text[] := array[
    'locked', 'locked_at', 'finalized', 'finalized_at', 'sent', 'sent_at',
    'zero_tip_acks', 'roster_snapshot', 'rev'
  ];
  changed text[];
begin
  if not (old.locked or old.finalized) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'The tip sheet for % is locked — it can''t be deleted. Unlock it on the Tip Sheet first.', old.date
      using errcode = 'check_violation';
  end if;

  select array_agg(n.key order by n.key) into changed
    from jsonb_each(to_jsonb(new) - status_cols) n
   where n.value is distinct from (to_jsonb(old) - status_cols) -> n.key;
  if changed is not null then
    raise exception 'The tip sheet for % is locked — unlock it on the Tip Sheet to change it (tried to change: %).',
      old.date, array_to_string(changed, ', ')
      using errcode = 'check_violation';
  end if;

  -- A pinned roster is who the sheet paid. It may be set where there was none,
  -- or cleared by the statement that unlocks, never swapped while frozen.
  if (new.locked or new.finalized)
     and old.roster_snapshot is not null
     and new.roster_snapshot is distinct from old.roster_snapshot then
    raise exception 'The tip sheet for % is locked — its pinned roster can''t be replaced. Unlock it on the Tip Sheet first.', old.date
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

drop trigger if exists tip_sheets_lock_guard on public.tip_sheets;
create trigger tip_sheets_lock_guard
  before update or delete on public.tip_sheets
  for each row execute function public.tip_sheets_lock_guard();

-- Check 1 (read-only): the trigger is present and enabled ('O').
--   select tgname, tgenabled from pg_trigger
--    where tgrelid = 'public.tip_sheets'::regclass and not tgisinternal order by tgname;
--
-- Check 2 (read-only): how many sheets the guard now protects.
--   select count(*) filter (where locked or finalized) as protected,
--          count(*) filter (where sent and not (locked or finalized)) as sent_but_unlocked,
--          count(*) as all_sheets
--     from public.tip_sheets;
