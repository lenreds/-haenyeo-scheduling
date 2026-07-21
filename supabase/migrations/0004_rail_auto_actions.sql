-- HaenyeoMNG — migration 0004: Rail auto-actions (RAIL-AUTO-ACTIONS-BRIEF.md).
--
-- Run this in the Supabase SQL editor (same as 0001–0003). Idempotent.
--
-- Supports: auto-updating the schedule when a Rail request is approved, and
-- auto-replying to the original email thread on approve/deny.

-- rail_requests: thread id for threaded replies + the manager's note ----------
alter table public.rail_requests
  add column if not exists gmail_thread_id text,  -- Gmail thread id (stored by the poller)
  add column if not exists manager_note    text;  -- optional note entered at approve/deny

-- schedule_overrides: link an override back to the request that created it ----
-- Nullable so manual overrides (created by editing the schedule directly) still
-- work with no linked request.
alter table public.schedule_overrides
  add column if not exists rail_request_id uuid references public.rail_requests(id) on delete set null;

-- Note on override_type: it already stores 'OFF' | 'GAP' | null (swap flag).
-- Shift-swap approvals reuse it to hold the *swapped shift code* (e.g. 'SV_5CL')
-- for each person on that date — personShiftFor() treats any non-null value as
-- the forced shift, so no schema change is needed for swaps.
