-- HaenyeoMNG — migration 0007: mark Jenny & Ajuma registered (manual).
--
-- Run in the Supabase SQL editor. Idempotent.
--
-- Their personal_email / phone stay null for now (to be filled in later). This
-- lets them receive schedule/tip emails once contact info is added, and clears
-- the "not yet registered" badge on the Staff tab.

update public.staff
set registered = true
where name in ('Jenny', 'Ajuma');

-- Note on staff deletion (Staff tab Delete button): no schema change needed.
-- Every table referencing staff(id) is already ON DELETE CASCADE, so deleting a
-- staff row removes the dependent rows automatically:
--   staff_roles          (0002)  on delete cascade
--   schedule_patterns    (0001)  on delete cascade
--   schedule_overrides   (0001)  on delete cascade
--   rail_requests        (0001)  on delete cascade
--   staff_info_updates   (0005)  on delete cascade
-- (schedule_overrides.rail_request_id is on delete set null, but those overrides
--  are themselves removed via their own staff_id cascade.)
