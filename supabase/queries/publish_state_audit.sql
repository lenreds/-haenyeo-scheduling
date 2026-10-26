-- READ-ONLY. Publish / finalize / lock state for the five weeks queued in the
-- Publish dialog (Sep 21, Sep 28, Oct 5, Oct 26, Nov 2 — week_start is the
-- Monday, so those are 09-21, 09-28, 10-05, 10-26, 11-02).
-- Run in the Supabase SQL editor. Selects only — writes nothing, emails nobody.
--
-- How to read it (one row per week per section):
--   section ALL        -> finalize state (and, for sends before 2026-09-26, the
--                         old single publish mark, which counts for both emails)
--   section FOH        -> Front of House publish mark + FOH lock
--   section BOHKITCHEN -> BOH & Kitchen publish mark + BOH/Kitchen lock
-- published_at set     -> a real send (Confirm & Send) wrote the mark at that time.
-- published false and updated_at later than the send you remember
--                      -> something cleared it afterwards: un-finalize
--                         (clears both sections) or a re-run of migration 0016.
-- No FOH / BOHKITCHEN row at all -> that section has never been marked sent
--                         or locked for that week.

select week_start,
       section,
       finalized,
       finalized_at  at time zone 'America/New_York' as finalized_at_et,
       published,
       published_at  at time zone 'America/New_York' as published_at_et,
       locked,
       locked_at     at time zone 'America/New_York' as locked_at_et,
       updated_at    at time zone 'America/New_York' as updated_at_et
  from public.schedule_weeks
 where week_start in ('2026-09-21', '2026-09-28', '2026-10-05', '2026-10-26', '2026-11-02')
 order by week_start, section;
