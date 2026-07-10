-- HaenyeoMNG — seed data lifted verbatim from scheduling-hub-prototype.jsx
-- (PERSON_ROSTER, PERSON_PATTERNS, OVERRIDES). Reflects the real week of
-- Jul 6-12, 2026. weekday index: 0=Sun ... 6=Sat. Idempotent (upserts).
--
-- schedule_patterns / schedule_overrides reference staff by id, so those
-- inserts resolve the id via a subselect on staff.name.

-- staff -----------------------------------------------------------------------
insert into public.staff (name, role) values
  ('Bernie','Bar'),('Isabella','Bar'),('Angel','Bar'),('Abraham','Bar'),
  ('Juliette','Host'),('Halle','Host'),
  ('Ivy','Servers'),('Mia','Servers'),('Reiko','Servers'),('David','Servers'),('Daniel','Servers'),
  ('Akira','Busser/Runner'),('Emilio','Busser/Runner'),('Miguel','Busser/Runner'),('Kevin','Busser/Runner'),('Dennis','Busser/Runner')
on conflict (name) do update set role = excluded.role, active = true;

-- schedule_patterns -----------------------------------------------------------
-- (person, weekday 0=Sun..6=Sat, shift_type) resolved to staff_id by name.
insert into public.schedule_patterns (staff_id, weekday, shift_type)
select s.id, v.weekday, v.shift_type
from (values
  ('Bernie',0,'OPENER'),('Bernie',1,'OFF'),('Bernie',2,'OFF'),('Bernie',3,'OFF'),('Bernie',4,'OFF'),('Bernie',5,'OFF'),('Bernie',6,'OPENER'),
  ('Isabella',0,'OFF'),('Isabella',1,'OPENER'),('Isabella',2,'OPENER'),('Isabella',3,'CLOSER'),('Isabella',4,'CLOSER'),('Isabella',5,'OPENER'),('Isabella',6,'OFF'),
  ('Angel',0,'OFF'),('Angel',1,'OFF'),('Angel',2,'OFF'),('Angel',3,'OFF'),('Angel',4,'OFF'),('Angel',5,'SWING'),('Angel',6,'OPENER'),
  ('Abraham',0,'OFF'),('Abraham',1,'OFF'),('Abraham',2,'OFF'),('Abraham',3,'OPENER'),('Abraham',4,'OFF'),('Abraham',5,'OFF'),('Abraham',6,'OFF'),
  ('Juliette',0,'OFF'),('Juliette',1,'OPENER'),('Juliette',2,'OFF'),('Juliette',3,'OPENER'),('Juliette',4,'OFF'),('Juliette',5,'OFF'),('Juliette',6,'OPENER'),
  ('Halle',0,'OFF'),('Halle',1,'OFF'),('Halle',2,'OPENER'),('Halle',3,'OFF'),('Halle',4,'OPENER'),('Halle',5,'OPENER'),('Halle',6,'OFF'),
  ('Ivy',0,'OFF'),('Ivy',1,'CLOSER'),('Ivy',2,'SWING'),('Ivy',3,'OPENER'),('Ivy',4,'SWING'),('Ivy',5,'OPENER'),('Ivy',6,'OFF'),
  ('Mia',0,'CLOSER'),('Mia',1,'CLOSER'),('Mia',2,'CLOSER'),('Mia',3,'CLOSER'),('Mia',4,'CLOSER'),('Mia',5,'CLOSER'),('Mia',6,'CLOSER'),
  ('Reiko',0,'OFF'),('Reiko',1,'OPENER'),('Reiko',2,'OPENER'),('Reiko',3,'OPENER'),('Reiko',4,'SWING'),('Reiko',5,'OPENER'),('Reiko',6,'SWING'),
  ('David',0,'BUSRUN6'),('David',1,'BUSRUN6'),('David',2,'BUSRUN6'),('David',3,'BUSRUN4'),('David',4,'OFF'),('David',5,'OFF'),('David',6,'OFF'),
  ('Daniel',0,'BUSRUN6'),('Daniel',1,'OFF'),('Daniel',2,'BUSRUN6'),('Daniel',3,'BUSRUN6'),('Daniel',4,'OFF'),('Daniel',5,'BUSRUN6'),('Daniel',6,'EXPO'),
  ('Emilio',0,'OFF'),('Emilio',1,'CLOSER'),('Emilio',2,'CLOSER'),('Emilio',3,'OFF'),('Emilio',4,'OFF'),('Emilio',5,'OFF'),('Emilio',6,'OFF'),
  ('Miguel',0,'OFF'),('Miguel',1,'OFF'),('Miguel',2,'OFF'),('Miguel',3,'OPENER'),('Miguel',4,'OPENER'),('Miguel',5,'OFF'),('Miguel',6,'OFF'),
  ('Kevin',0,'OFF'),('Kevin',1,'OFF'),('Kevin',2,'OFF'),('Kevin',3,'OFF'),('Kevin',4,'CLOSER'),('Kevin',5,'OPENER'),('Kevin',6,'CLOSER'),
  ('Dennis',0,'OFF'),('Dennis',1,'OPENER'),('Dennis',2,'OPENER'),('Dennis',3,'CLOSER'),('Dennis',4,'OFF'),('Dennis',5,'SWING'),('Dennis',6,'OPENER'),
  ('Akira',0,'OPENER'),('Akira',1,'OFF'),('Akira',2,'OFF'),('Akira',3,'SWING'),('Akira',4,'OFF'),('Akira',5,'EXPO'),('Akira',6,'BAR6')
) as v(person, weekday, shift_type)
join public.staff s on s.name = v.person
on conflict (staff_id, weekday) do update set shift_type = excluded.shift_type;

-- placeholder_schedule --------------------------------------------------------
-- BOH (4 slots), Kitchen (5 slots), Management (2 slots); all OFF to start.
insert into public.placeholder_schedule (group_key, slot_index, weekday, shift_type)
select g.group_key, s.slot_index, d.weekday, 'OFF'
from (values ('boh',4),('kitchen',5),('management',2)) as g(group_key, slots)
cross join lateral generate_series(0, g.slots - 1) as s(slot_index)
cross join generate_series(0, 6) as d(weekday)
on conflict (group_key, slot_index, weekday) do nothing;

-- schedule_overrides ----------------------------------------------------------
insert into public.schedule_overrides (staff_id, date, override_type, is_swap)
select s.id, v.date::date, v.override_type, v.is_swap
from (values
  ('Bernie','2026-07-16','OFF',false),
  ('Emilio','2026-07-09','GAP',false),
  ('Reiko','2026-07-12',null,true)
) as v(person, date, override_type, is_swap)
join public.staff s on s.name = v.person
on conflict (staff_id, date) do update
  set override_type = excluded.override_type, is_swap = excluded.is_swap;
