-- Migration 0016: FRESH START — permanently delete testing history
-- (SCHEDULE-CALENDAR-RAIL-BRIEF.md item 0). Run in the Supabase SQL editor.
--
-- ############################################################################
-- ## THIS IS IRREVERSIBLE. It DELETES rows. Take a backup first if you want  ##
-- ## any of the testing history back — Supabase Dashboard > Database >       ##
-- ## Backups, or `pg_dump`. Once this runs there is no undo.                 ##
-- ############################################################################
--
-- It is safe to run more than once (a second run simply finds nothing to do),
-- but every run deletes whatever resolved Rail history exists at that moment.
--
-- WHAT THIS KEEPS — none of these are touched:
--   staff, staff_roles, staff_info_updates, role_shift_options,
--   schedule_patterns, placeholder_schedule,
--   weekly_schedules, weekly_placeholder_schedules,
--   schedule_overrides  (approved time off and swaps stay on the schedule),
--   tip_sheets, schedule_notes, calendar_notes, general_notes,
--   integration_tokens (the Gmail connection),
--   and schedule_weeks' finalized / finalized_at / locked / locked_at.
--
-- WHAT THIS DELETES OR RESETS is in the four sections below.

begin;

-- 1) rail_requests: drop everything already dealt with -----------------------
--
-- Pending requests are LEFT ALONE — those are live decisions still waiting on a
-- manager. Only approved / denied / archived rows go.
--
-- This is also what clears the Auto-Action Log. The log has no table of its
-- own: the app builds it on load from the approved and denied rail_requests
-- rows (see setLog in src/App.jsx), so removing them empties the log and the
-- "Show all" behind it.
--
-- Two columns point back here, both declared `on delete set null`, so nothing
-- cascades: schedule_overrides.rail_request_id and
-- schedule_notes.rail_request_id simply lose their link. The overrides
-- themselves survive — an approved day off stays off on the schedule. One
-- consequence worth knowing: the app treats an Off override WITH a rail_request_id
-- as "approved time off" and warns before you schedule over it. Those older
-- overrides lose that flag and become ordinary manual Offs, so the warning
-- stops firing for time off approved during testing. Going forward, newly
-- approved requests behave as before.

delete from public.rail_requests
 where status in ('approved', 'denied', 'archived');

-- 2) Auto-Action Log -------------------------------------------------------
--
-- Nothing to do: see section 1. Kept as its own section so the checklist in the
-- brief maps 1:1 onto this file rather than looking like something was skipped.

-- 3) schedule_weeks: clear published state -----------------------------------
--
-- So no week reads as "already emailed" going into real use, and the first real
-- Publish sends every finalized week. finalized / finalized_at / locked /
-- locked_at are deliberately untouched — the weeks you already marked final
-- stay final and stay on the Calendar.

update public.schedule_weeks
   set published = false,
       published_at = null,
       updated_at = now()
 where published is true
    or published_at is not null;

-- 4) rail_view_state: clear the hide-only watermarks --------------------------
--
-- These are the shared "Clear" timestamps for the Auto-Action Log and the
-- Resolved list. Leaving them set would hide real activity created before the
-- last time somebody pressed Clear during testing. Deleting the rows is the
-- same as never having cleared: nothing is hidden.

delete from public.rail_view_state;

commit;

-- Sanity check — run this after and expect: no non-pending rail rows, no
-- published weeks, no watermarks.
--
--   select status, count(*) from public.rail_requests group by status;
--   select count(*) from public.schedule_weeks where published is true;
--   select count(*) from public.rail_view_state;
