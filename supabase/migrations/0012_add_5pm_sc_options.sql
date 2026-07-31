-- Migration 0012: add the 5pm-SC shift option for Busser/Runner and Bar
--
-- Why this is needed even though the codes already exist in the app:
-- src/App.jsx carries DEFAULT_ROLE_OPTIONS, but fetchRoleShiftOptions() REPLACES
-- a role's whole option array when role_shift_options has rows for that role
-- (setRoleOptions does { ...prev, ...fromDb }). Migration 0002 seeded
-- Busser/Runner and Bar without a 5pm-SC row, so on the live site the DB list
-- wins and the option never appears — even though it is present in the code and
-- in SHIFT_META. Adding the rows here is what actually makes it selectable.
--
-- sort_order is rewritten for the affected roles so the dropdown reads in start
-- order: Off, 4pm-FC, 5pm-SC, 5pm-CL, 6pm-CL (Busser/Runner) and Off, 4pm-FC,
-- 4pm-CL, 5pm-SC, 5pm-CL, 5pm-FC, 6pm-CL (Bar).
--
-- Idempotent: safe to run more than once.

insert into role_shift_options (role, code, label, sort_order) values
  ('Busser/Runner', 'BR_5SC', '5pm-SC', 2),
  ('Bar',           'BAR_5SC', '5pm-SC', 3)
on conflict (role, code) do update
  set label = excluded.label, sort_order = excluded.sort_order;

-- Renumber the rows that sit after the new option so the order is right.
update role_shift_options set sort_order = 3 where role = 'Busser/Runner' and code = 'BR_5CL';
update role_shift_options set sort_order = 4 where role = 'Busser/Runner' and code = 'BR_6CL';

update role_shift_options set sort_order = 4 where role = 'Bar' and code = 'BAR_5CL';
update role_shift_options set sort_order = 5 where role = 'Bar' and code = 'BAR_5FC';
update role_shift_options set sort_order = 6 where role = 'Bar' and code = 'BAR_6CL';
