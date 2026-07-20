-- HaenyeoMNG — migration 0002: staff sections, multi-role support, configurable
-- shift options, and the FOH shift-label redesign (UPDATE-BRIEF-schedule-redesign.md).
--
-- Run this in the Supabase SQL editor (same as 0001). Idempotent — safe to re-run.
--
-- Shift codes are role-prefixed so a stored cell value carries both the role a
-- person works that day AND the shift: SV_* = Servers, BR_* = Busser/Runner,
-- HOST_* = Host, EXPO_* = Expo, BAR_* = Bar. The Tip Sheet routes people to
-- point slots by that prefix (same principle as the old BAR4/BUSRUN6 codes).

-- 1) staff.section — which schedule a person appears on ------------------------
alter table public.staff
  add column if not exists section text not null default 'FOH';
-- 'FOH' | 'BOH' | 'Kitchen' | 'Management'

-- 2) BOH / Kitchen / Management staff -----------------------------------------
-- NOTE: the live staff table already holds these people (seeded earlier, some
-- with a blank role ''). If any live name differs from the plain names below
-- (e.g. 'Jenny — Head Chef' instead of 'Jenny'), rename the live row FIRST so
-- these upserts and the staff_roles joins in section 3 line up:
--   update public.staff set name = 'Jenny' where name like 'Jenny%';
insert into public.staff (name, role, section) values
  ('Hector','BOH','BOH'),
  ('Freddy','BOH','BOH'),
  ('Temo','BOH','BOH'),
  ('Oryan','BOH','BOH'),
  ('Jenny','Kitchen','Kitchen'),
  ('Ajuma','Kitchen','Kitchen'),
  ('Kelvin','Kitchen','Kitchen'),
  ('Jason','Kitchen','Kitchen'),
  ('Lenis','Management','Management'),
  ('Jon','Management','Management')
on conflict (name) do update
  set section = excluded.section,
      -- fill the blank '' roles left from the original 26-person seed
      role = case when public.staff.role is null or public.staff.role = '' then excluded.role else public.staff.role end;

-- 3) staff_roles — which role(s) each person can work --------------------------
-- is_primary marks the default role for the schedule's role picker.
-- sort_order fixes grid row order for BOH/Kitchen/Management so rows keep
-- lining up with the slot_index-keyed placeholder_schedule data.
create table if not exists public.staff_roles (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.staff(id) on delete cascade,
  role        text not null,
  is_primary  boolean not null default false,
  sort_order  smallint not null default 0,
  unique (staff_id, role)
);

alter table public.staff_roles enable row level security;
do $$ begin
  create policy staff_roles_authenticated_all on public.staff_roles
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- FOH role access list (from the update brief)
insert into public.staff_roles (staff_id, role, is_primary, sort_order)
select s.id, v.role, v.is_primary, v.sort_order
from (values
  ('Bernie',   'Bar',            true,  0),
  ('Isabella', 'Bar',            true,  0),
  ('Abraham',  'Bar',            true,  0),
  ('Angel',    'Bar',            true,  0),
  ('Angel',    'Servers',        false, 0),
  ('Juliette', 'Host',           true,  0),
  ('Halle',    'Host',           true,  0),
  ('Ivy',      'Servers',        true,  0),
  ('Mia',      'Servers',        true,  0),
  ('Reiko',    'Servers',        true,  0),
  ('David',    'Servers',        true,  0),
  ('David',    'Busser/Runner',  false, 0),
  ('David',    'Expo',           false, 0),
  ('David',    'Host',           false, 0),
  ('Daniel',   'Servers',        true,  0),
  ('Daniel',   'Busser/Runner',  false, 0),
  ('Daniel',   'Expo',           false, 0),
  ('Akira',    'Busser/Runner',  true,  0),
  ('Akira',    'Bar',            false, 0),
  ('Akira',    'Expo',           false, 0),
  ('Emilio',   'Busser/Runner',  true,  0),
  ('Miguel',   'Busser/Runner',  true,  0),
  ('Kevin',    'Busser/Runner',  true,  0),
  ('Dennis',   'Busser/Runner',  true,  0),
  -- section roles: BOH/Kitchen/Management grids read their rosters from these.
  -- sort_order mirrors the old hardcoded row order (slot_index alignment).
  ('Hector',   'BOH',            true,  0),
  ('Freddy',   'BOH',            true,  1),
  ('Temo',     'BOH',            true,  2),
  ('Oryan',    'BOH',            true,  3),
  ('Jenny',    'Kitchen',        true,  0),
  ('Ajuma',    'Kitchen',        true,  1),
  ('Kelvin',   'Kitchen',        true,  2),
  ('Jason',    'Kitchen',        true,  3),
  ('Freddy',   'Kitchen',        false, 4),  -- also works Kitchen (5th row)
  ('Lenis',    'Management',     true,  0),
  ('Jon',      'Management',     true,  1)
) as v(person, role, is_primary, sort_order)
join public.staff s on s.name = v.person
on conflict (staff_id, role) do update
  set is_primary = excluded.is_primary, sort_order = excluded.sort_order;

-- 4) role_shift_options — configurable dropdown lists per role -----------------
-- Rewording a shift later = edit the label here, no code change.
create table if not exists public.role_shift_options (
  id          uuid primary key default gen_random_uuid(),
  role        text not null,
  code        text not null,
  label       text not null,
  sort_order  smallint not null default 0,
  unique (role, code)
);

alter table public.role_shift_options enable row level security;
do $$ begin
  create policy role_shift_options_authenticated_all on public.role_shift_options
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

insert into public.role_shift_options (role, code, label, sort_order) values
  -- Servers
  ('Servers','OFF','Off',0),
  ('Servers','SV_4FC','4pm-FC',1),
  ('Servers','SV_5CL','5pm-CL',2),
  ('Servers','SV_5SC','5pm-SC',3),
  ('Servers','SV_6CL','6pm-CL',4),
  -- Busser/Runner
  ('Busser/Runner','OFF','Off',0),
  ('Busser/Runner','BR_4FC','4pm-FC',1),
  ('Busser/Runner','BR_5CL','5pm-CL',2),
  ('Busser/Runner','BR_6CL','6pm-CL',3),
  -- Host
  ('Host','OFF','Off',0),
  ('Host','HOST_4','Host 4pm',1),
  -- Expo
  ('Expo','OFF','Off',0),
  ('Expo','EXPO_5','Expo 5pm',1),
  ('Expo','EXPO_6','Expo 6pm',2),
  -- Bar
  ('Bar','OFF','Off',0),
  ('Bar','BAR_4FC','4pm-FC',1),
  ('Bar','BAR_4CL','4pm-CL',2),
  ('Bar','BAR_5CL','5pm-CL',3),
  ('Bar','BAR_5FC','5pm-FC',4),
  ('Bar','BAR_6CL','6pm-CL',5),
  -- BOH (wording unchanged for now — owner will reword later)
  ('BOH','OFF','Off',0),
  ('BOH','BOH_STD','3p – Close',1),
  ('BOH','BOH_AM','9a – 5p',2),
  ('BOH','MID_12_8','12p – 8p',3),
  -- Kitchen ("3p – Close" displays as "Yes" for Jenny/Ajuma — a UI rule)
  ('Kitchen','OFF','Off',0),
  ('Kitchen','KITCHEN','3p – Close',1),
  ('Kitchen','MID_12_8','12p – 8p',2),
  -- Management (click-to-toggle in the UI, exactly two options)
  ('Management','OFF','Off',0),
  ('Management','FM','FM',1)
on conflict (role, code) do update
  set label = excluded.label, sort_order = excluded.sort_order;

-- 5) Convert legacy shift codes in stored schedules ----------------------------
-- Role-dependent legacy codes (Opener/Swing/Closer meant different things per role)
update public.schedule_patterns sp
set shift_type = m.new_code
from public.staff s,
  (values
    ('Bar','OPENER','BAR_4FC'),('Bar','SWING','BAR_5CL'),('Bar','CLOSER','BAR_6CL'),('Bar','FIVE_CLOSE','BAR_5CL'),
    ('Host','OPENER','HOST_4'),('Host','SWING','HOST_4'),('Host','CLOSER','HOST_4'),
    ('Servers','OPENER','SV_4FC'),('Servers','SWING','SV_5SC'),('Servers','CLOSER','SV_6CL'),('Servers','FIVE_CLOSE','SV_5CL'),
    ('Busser/Runner','OPENER','BR_4FC'),('Busser/Runner','SWING','BR_5CL'),('Busser/Runner','CLOSER','BR_6CL')
  ) as m(role, old_code, new_code)
where sp.staff_id = s.id and s.role = m.role and sp.shift_type = m.old_code;

-- Role-independent legacy codes
update public.schedule_patterns sp
set shift_type = m.new_code
from (values
    ('BUSRUN4','BR_4FC'),('BUSRUN6','BR_6CL'),
    ('EXPO','EXPO_5'),
    ('BAR4','BAR_4FC'),('BAR6','BAR_6CL'),
    ('HOST','HOST_4')
  ) as m(old_code, new_code)
where sp.shift_type = m.old_code;

-- Management placeholder grid: anything scheduled becomes FM
update public.placeholder_schedule
set shift_type = 'FM'
where group_key = 'management' and shift_type not in ('OFF','FM');
