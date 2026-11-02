-- Migration 0030: tip sheets save field by field, and a save built from an
-- out-of-date copy is refused instead of overwriting what another device wrote.
-- Run in the Supabase SQL editor, AFTER 0029. Emails nobody; changes no
-- existing value (adds a counter column, starting at 0).
--
-- Why: the app saved a sheet by writing the whole row from its own copy. Two
-- devices on one date — a phone during service, the desktop to check — each
-- held a copy of every field, including time_entries (everyone's clock times
-- in one field), and whichever saved last silently replaced the other's edits.
--
-- How it works now: the app sends only what it changed, each change as
--   { "path": ["covers"],                        "before": 80,   "after": 84 }
--   { "path": ["time_entries", "server1", "out"], "before": null, "after": "11:15 PM" }
-- save_tip_sheet() applies them only if every field still holds its "before"
-- value. If any doesn't (someone else changed that same field since this
-- device loaded it), NOTHING is written and the current row comes back with
-- the list of fields that clashed; the app reloads them and says so. Changes to
-- different fields — or different people's clock times — never clash.
-- A field that already holds the "after" value counts as done, not a clash.
--
-- p_expect_rev (optional): Lock and Send pass the rev this device loaded. If
-- the row has changed at all since — even a field this device didn't touch —
-- nothing is written: a sheet is only ever locked or sent as the manager saw it.
--
-- The first save of a date creates the row (with its calc_version, as 0025
-- requires). Two devices creating the same date at once: one creates it, the
-- other's save is then checked against it like any other.
--
-- 0029's lock guard and 0025's calc_version guard still apply to every write
-- this makes — this function runs as the signed-in user, not as an owner.
--
-- rev: a counter the database bumps on every update. The app compares it on
-- focus to notice that another device changed the sheet.

-- Needs the columns from 0005, 0013, 0015, 0017, 0022, 0023, 0024, 0025.
do $$
declare missing text;
begin
  select string_agg(c, ', ') into missing
    from unnest(array['finalized','locked','sent_at','bar_tip_out','expo_as_busser','bar_tip_out_auto',
                      'closing_sum_auto','roster_snapshot','zero_tip_acks','calc_version']) c
   where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'tip_sheets' and column_name = c);
  if missing is not null then
    raise exception 'tip_sheets is missing column(s) %, run the earlier migrations first', missing;
  end if;
end $$;

alter table public.tip_sheets
  add column if not exists rev bigint not null default 0;
comment on column public.tip_sheets.rev is
  'Bumped by the database on every update (trigger tip_sheets_bump_rev). The app uses it to notice another device''s save.';

create or replace function public.tip_sheets_bump_rev()
returns trigger
language plpgsql
as $$
begin
  new.rev := old.rev + 1;
  return new;
end
$$;

drop trigger if exists tip_sheets_bump_rev on public.tip_sheets;
create trigger tip_sheets_bump_rev
  before update on public.tip_sheets
  for each row execute function public.tip_sheets_bump_rev();

-- What a change may touch, and how deep: 1 = the whole column, 2 = one key of
-- a map column, 3 = one field inside that key (a clock time's in / out).
create or replace function public.tip_sheet_path_depth(p_col text)
returns int
language sql
immutable
as $$
  select case p_col
    when 'time_entries'   then 3
    when 'slot_overrides' then 3
    when 'opening_counts' then 2
    when 'closing_counts' then 2
    when 'floor_cash' then 1 when 'floor_credit' then 1 when 'bar_cash' then 1 when 'bar_credit' then 1
    when 'covers' then 1 when 'cash_sales' then 1 when 'closing_sum' then 1 when 'payouts' then 1
    when 'bar_tip_out' then 1 when 'bar_tip_out_auto' then 1 when 'closing_sum_auto' then 1
    when 'expo_as_busser' then 1 when 'calc_version' then 1
    when 'sent' then 1 when 'sent_at' then 1 when 'finalized' then 1 when 'finalized_at' then 1
    when 'locked' then 1 when 'locked_at' then 1 when 'roster_snapshot' then 1 when 'zero_tip_acks' then 1
    else 0
  end
$$;

drop function if exists public.save_tip_sheet(date, jsonb);
-- Same value? Timestamps compare as times, not text: the app writes
-- "…41.097Z" and the database hands back "…41.097+00:00" for the same moment.
create or replace function public.tip_sheet_same(p_col text, a jsonb, b jsonb)
returns boolean
language sql
immutable
as $$
  select case
    when p_col in ('locked_at', 'finalized_at', 'sent_at')
         and jsonb_typeof(a) = 'string' and jsonb_typeof(b) = 'string'
      then (a #>> '{}')::timestamptz = (b #>> '{}')::timestamptz
    else a is not distinct from b
  end
$$;

create or replace function public.save_tip_sheet(p_date date, p_changes jsonb, p_expect_rev bigint default null)
returns jsonb
language plpgsql
security invoker
as $$
declare
  ch        jsonb;
  path      text[];
  cur       jsonb;
  doc       jsonb;
  stored    jsonb;
  before_v  jsonb;
  after_v   jsonb;
  created   boolean := false;
  conflicts jsonb := '[]'::jsonb;
  new_cv    int;
  saved     public.tip_sheets;
begin
  if p_date is null or jsonb_typeof(p_changes) is distinct from 'array' then
    raise exception 'save_tip_sheet: a date and an array of changes are required';
  end if;

  for ch in select * from jsonb_array_elements(p_changes) loop
    path := array(select jsonb_array_elements_text(ch -> 'path'));
    if coalesce(array_length(path, 1), 0) = 0
       or array_length(path, 1) > public.tip_sheet_path_depth(path[1]) then
      raise exception 'save_tip_sheet: % can''t be saved this way', coalesce(ch ->> 'path', '(no path)');
    end if;
    if path[1] = 'calc_version' then new_cv := (ch ->> 'after')::int; end if;
  end loop;

  if jsonb_array_length(p_changes) = 0 then
    return jsonb_build_object('ok', true, 'row', (select to_jsonb(t) from public.tip_sheets t where t.date = p_date));
  end if;

  -- First save of this date creates the row, calc_version and all (0025 only
  -- lets it be set on insert). Nobody else can have written a row this call
  -- created, so its changes need no checking.
  insert into public.tip_sheets (date, calc_version) values (p_date, new_cv)
  on conflict (date) do nothing;
  created := found;

  select to_jsonb(t) into cur from public.tip_sheets t where t.date = p_date for update;

  if not created and p_expect_rev is not null and (cur ->> 'rev')::bigint <> p_expect_rev then
    return jsonb_build_object('ok', false, 'conflicts', jsonb_build_array(jsonb_build_object('path', '["rev"]'::jsonb, 'stored', cur -> 'rev')), 'row', cur);
  end if;

  if not created then
    for ch in select * from jsonb_array_elements(p_changes) loop
      path := array(select jsonb_array_elements_text(ch -> 'path'));
      stored   := coalesce(cur #> path, 'null'::jsonb);
      before_v := coalesce(ch -> 'before', 'null'::jsonb);
      after_v  := coalesce(ch -> 'after', 'null'::jsonb);
      if not public.tip_sheet_same(path[1], stored, before_v) and not public.tip_sheet_same(path[1], stored, after_v) then
        conflicts := conflicts || jsonb_build_array(jsonb_build_object('path', to_jsonb(path), 'stored', stored));
      end if;
    end loop;
    if jsonb_array_length(conflicts) > 0 then
      return jsonb_build_object('ok', false, 'conflicts', conflicts, 'row', cur);
    end if;
  end if;

  doc := cur;
  for ch in select * from jsonb_array_elements(p_changes) loop
    path := array(select jsonb_array_elements_text(ch -> 'path'));
    after_v := coalesce(ch -> 'after', 'null'::jsonb);
    if path[1] = 'calc_version' then continue; end if; -- set by the insert, or already equal
    if array_length(path, 1) = 1 then
      doc := jsonb_set(doc, path, after_v);
    elsif after_v = 'null'::jsonb then
      doc := doc #- path;
    else
      -- make sure each level above exists before setting the leaf
      if jsonb_typeof(doc -> path[1]) is distinct from 'object' then
        doc := jsonb_set(doc, path[1:1], '{}'::jsonb);
      end if;
      if array_length(path, 1) = 3 and jsonb_typeof(doc #> path[1:2]) is distinct from 'object' then
        doc := jsonb_set(doc, path[1:2], '{}'::jsonb);
      end if;
      doc := jsonb_set(doc, path, after_v);
    end if;
  end loop;

  update public.tip_sheets t set
    floor_cash = r.floor_cash, floor_credit = r.floor_credit,
    bar_cash = r.bar_cash, bar_credit = r.bar_credit,
    covers = r.covers, cash_sales = r.cash_sales, closing_sum = r.closing_sum,
    opening_counts = r.opening_counts, closing_counts = r.closing_counts,
    payouts = r.payouts, slot_overrides = r.slot_overrides, time_entries = r.time_entries,
    bar_tip_out = r.bar_tip_out, bar_tip_out_auto = r.bar_tip_out_auto,
    closing_sum_auto = r.closing_sum_auto, expo_as_busser = r.expo_as_busser,
    sent = r.sent, sent_at = r.sent_at, finalized = r.finalized, finalized_at = r.finalized_at,
    locked = r.locked, locked_at = r.locked_at,
    roster_snapshot = r.roster_snapshot, zero_tip_acks = r.zero_tip_acks
  from jsonb_populate_record(null::public.tip_sheets, doc) r
  where t.date = p_date
  returning t.* into saved;

  return jsonb_build_object('ok', true, 'row', to_jsonb(saved));
end
$$;

revoke all on function public.save_tip_sheet(date, jsonb, bigint) from public;
grant execute on function public.save_tip_sheet(date, jsonb, bigint) to authenticated;

-- The original column notes (0001) said these hold bill counts. They never
-- have: each denomination holds a dollar amount ("2 twenties = 40").
comment on column public.tip_sheets.opening_counts is
  'Opening bank: denomination -> DOLLAR AMOUNT in that denomination (2 twenties = "40"), not a bill count.';
comment on column public.tip_sheets.closing_counts is
  'Closing count: denomination -> DOLLAR AMOUNT in that denomination (2 twenties = "40"), not a bill count.';

-- Check 1 (read-only): both tip_sheets triggers from 0029 / 0030 present and
-- enabled ('O'), plus 0025's.
--   select tgname, tgenabled from pg_trigger
--    where tgrelid = 'public.tip_sheets'::regclass and not tgisinternal order by tgname;
--
-- Check 2 (read-only): the function exists and every sheet starts at rev 0.
--   select (select count(*) from pg_proc where proname = 'save_tip_sheet') as fn,
--          count(*) as sheets, max(rev) as max_rev from public.tip_sheets;
