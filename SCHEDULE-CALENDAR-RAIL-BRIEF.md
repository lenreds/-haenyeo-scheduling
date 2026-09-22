# HaenyeoMNG — Update Brief: Fresh Start, Schedule Access Rules, Calendar Tip Sheets & Rail Polish

## 0. Fresh start — clear historical data
The app has been in testing; the owner is starting real use now. Provide a SQL script (as a numbered migration file) that permanently deletes test/history data:
- Delete all rows in `rail_requests` with status 'approved', 'denied', or 'archived'. Leave 'pending' rows alone.
- Delete all auto-action log entries (whatever table backs the log / "Show all").
- Reset published state: clear `published` and `published_at` on all rows in `schedule_weeks` so nothing reads as already published going forward. Leave finalized/locked state alone.
- Reset the Rail cleared_at watermarks in `rail_view_state` so the cleared lists start empty rather than hiding new activity.
Do NOT delete: staff, schedules, weekly_schedules, tip_sheets, notes, calendar notes, shift options.
Tell the owner to run it and flag that it is irreversible.

## 1. Header
Remove "/ SCHEDULING" from the top-left. The H logo plus "HAENYEO" is the whole header brand.

## 2. Set Schedule — limited look-back, read-only past
- Prev navigation stops 2 weeks before the current week.
- Those past weeks are read-only: dropdowns disabled, no Finalize / Publish / Lock. Small "Past week — view only" label.
- Forward navigation unlimited. Older weeks are viewable only via the Calendar tab.

## 3. Set Schedule — Finalize and Publish roles
- **Finalize** = marks the week final so it appears on the Calendar. Pressing again un-finalizes and removes it from Calendar view. Sends no email.
- **Publish** = emails staff.
  - Active only when the viewed week is finalized. Available on any current or future finalized week, not just the current one.
  - Sends all finalized, not-yet-published weeks (existing multi-week logic).
  - Shows "Published ✓ [date/time]" after sending.
  - If a published week is un-finalized, edited, and re-finalized, its published state clears so it can be re-sent.

## 4. Calendar — access tip sheets by date
- On the date notes page, add a tip sheet icon beside the existing schedule icon.
- It opens that date's Tip Sheet — read-only if sent/locked, editable otherwise — with an icon back to the date notes page.
- Works for any past date.

## 5. Rail — quick-add strip
Remove the words "DATE NOTE". The calendar icon alone is enough.

## 6. Rail — shorter notes box
Fixed, comfortable height rather than running the full column. Scroll inside the box when notes overflow.

## 7. Rail — click a date to view that day's staff
- Clicking a date in the 7-day strip loads that date's staff into the Today at a Glance box.
- Header changes from "TODAY AT A GLANCE" to the selected day and date, e.g. "THURSDAY, SEP 24".
- Clicked date gets the highlight; today keeps its dot. Clicking today returns to "TODAY AT A GLANCE".
- Swaps made from that box apply to the selected date, and the confirmation warning names that date.

## Order of work
1. Fresh-start SQL script (item 0)
2. Header (item 1)
3. Rail label + notes box (items 5, 6)
4. Rail date click → staff view (item 7)
5. Set Schedule look-back + read-only (item 2)
6. Finalize / Publish roles (item 3)
7. Calendar tip sheet access (item 4)

## Explicitly unchanged
- All tip math, slot ordering, send/lock flow
- Calendar past-or-finalized display rule
- Email parsing, Rail approval logic
- Staff, schedules, tip sheets, notes data
