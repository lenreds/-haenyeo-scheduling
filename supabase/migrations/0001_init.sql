-- HaenyeoMNG — schema reference
--
-- NOTE: this file documents the schema that is ALREADY LIVE in the Supabase
-- project (the owner applied it directly in the SQL editor). It is kept here so
-- the repo is reproducible and the column shapes are version-controlled. The
-- column names below were confirmed against the live REST API on 2026-07-10.
--
-- weekday convention: JS Date.getDay() index — 0 = Sunday ... 6 = Saturday,
-- matching the PERSON_PATTERNS arrays in scheduling-hub-prototype.jsx. The
-- Monday-first *display* order is a UI concern only (WEEKDAY_ORDER in the
-- component); do not re-index stored data.

-- staff (replaces the PERSON_ROSTER constant) --------------------------------
create table if not exists public.staff (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  role        text not null,          -- 'Bar' | 'Host' | 'Servers' | 'Busser/Runner'
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- schedule_patterns (replaces PERSON_PATTERNS) -------------------------------
-- one row per staff member per weekday; person is a FK, not a name string.
create table if not exists public.schedule_patterns (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.staff(id) on delete cascade,
  weekday     smallint not null check (weekday between 0 and 6),
  shift_type  text not null,
  unique (staff_id, weekday)
);

-- placeholder_schedule (Back of House / Kitchen / Management grids) ----------
create table if not exists public.placeholder_schedule (
  id          uuid primary key default gen_random_uuid(),
  group_key   text not null,          -- 'boh' | 'kitchen' | 'management'
  slot_index  smallint not null,
  weekday     smallint not null check (weekday between 0 and 6),
  shift_type  text not null default 'OFF',
  unique (group_key, slot_index, weekday)
);

-- schedule_overrides (one-off Rail-approved exceptions) ----------------------
create table if not exists public.schedule_overrides (
  id             uuid primary key default gen_random_uuid(),
  staff_id       uuid not null references public.staff(id) on delete cascade,
  date           date not null,
  override_type  text,               -- 'OFF' | 'GAP' | null (null when purely a swap)
  is_swap        boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (staff_id, date)
);

-- rail_requests (pending decisions + resolved log) ---------------------------
create table if not exists public.rail_requests (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.staff(id) on delete cascade,
  type        text not null,          -- 'REQUEST OFF' | 'SHIFT SWAP' | 'COVERAGE REQUEST'
  dates       text not null,          -- display string, e.g. '07/16'
  notice      text,
  note        text,
  status      text not null default 'pending',  -- 'pending' | 'approved' | 'denied'
  urgent      boolean not null default false,
  created_at  timestamptz not null default now()
);

-- tip_sheets (one row per business date) -------------------------------------
create table if not exists public.tip_sheets (
  id             uuid primary key default gen_random_uuid(),
  date           date not null unique,
  floor_cash     numeric,
  floor_credit   numeric,
  bar_cash       numeric,
  bar_credit     numeric,
  covers         integer,
  opening_counts jsonb not null default '{}'::jsonb,  -- { denom: count }
  closing_counts jsonb not null default '{}'::jsonb,  -- { denom: count }
  payouts        jsonb not null default '[]'::jsonb,   -- [ { id, desc, amount } ]
  cash_sales     numeric,
  closing_sum    numeric,
  slot_overrides jsonb not null default '{}'::jsonb,   -- { slotId: { name, pts } }
  time_entries   jsonb not null default '{}'::jsonb,   -- { slotId: { in, out } }
  sent           boolean not null default false,
  created_at     timestamptz not null default now()
);

-- Row Level Security — manager-only app, authenticated users get full access.
alter table public.staff                enable row level security;
alter table public.schedule_patterns    enable row level security;
alter table public.placeholder_schedule enable row level security;
alter table public.schedule_overrides   enable row level security;
alter table public.rail_requests        enable row level security;
alter table public.tip_sheets           enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'staff','schedule_patterns','placeholder_schedule',
    'schedule_overrides','rail_requests','tip_sheets'
  ]
  loop
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true);',
      t || '_authenticated_all', t
    );
  end loop;
end $$;
