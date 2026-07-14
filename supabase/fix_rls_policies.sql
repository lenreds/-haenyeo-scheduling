-- HaenyeoMNG — grant signed-in managers full access to every table.
--
-- Diagnosis (2026-07-12): RLS is enabled on all six tables but no policies
-- exist for the `authenticated` role, so logged-in users see 0 rows and all
-- writes return 403. This script is idempotent — safe to run more than once.
-- Paste the whole thing into the Supabase SQL editor and Run.

do $$
declare t text;
begin
  foreach t in array array[
    'staff','schedule_patterns','placeholder_schedule',
    'schedule_overrides','rail_requests','tip_sheets'
  ]
  loop
    -- make sure RLS is on (no-op if already enabled)
    execute format('alter table public.%I enable row level security;', t);
    -- drop a previous copy of the policy if one exists, then recreate it
    execute format('drop policy if exists %I on public.%I;', t || '_authenticated_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true);',
      t || '_authenticated_all', t
    );
  end loop;
end $$;

-- quick self-check: should list 6 policies, one per table
select tablename, policyname, roles
from pg_policies
where schemaname = 'public'
order by tablename;
