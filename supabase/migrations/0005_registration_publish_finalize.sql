-- HaenyeoMNG — migration 0005: staff registration, tip finalize, info updates
-- (COMBINED-BUILD-BRIEF.md). Run in the Supabase SQL editor. Idempotent.

-- staff: registration contact info -------------------------------------------
alter table public.staff
  add column if not exists personal_email text,
  add column if not exists phone          text,
  add column if not exists registered     boolean not null default false;

-- tip_sheets: finalization state ---------------------------------------------
alter table public.tip_sheets
  add column if not exists finalized    boolean not null default false,
  add column if not exists finalized_at timestamptz;

-- staff_info_updates: pending contact-info changes awaiting manager review ----
create table if not exists public.staff_info_updates (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.staff(id) on delete cascade,
  new_email   text,
  new_phone   text,
  status      text not null default 'pending',  -- 'pending' | 'approved' | 'denied'
  created_at  timestamptz not null default now()
);

alter table public.staff_info_updates enable row level security;
do $$ begin
  create policy staff_info_updates_authenticated_all on public.staff_info_updates
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
