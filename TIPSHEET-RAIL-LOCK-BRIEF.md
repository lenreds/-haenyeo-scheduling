# HaenyeoMNG — Update Brief: Tip Sheet Swing Server Fix, Rail Delete/Archive & Per-Section Locking

**Context:** The app is live (Vercel + Supabase). Read HANDOFF-HaenyeoMNG.md for full project context first.

---

## 1. Tip Sheet — fix Swing Server slot assignment

### Correct behavior
- Server slot 1 → earliest start time (4pm-FC first)
- Server slot 2 → next earliest server
- Server (Swing) slot → 6pm-CL server ONLY
  - If NO 6pm-CL server is working: Swing slot stays EMPTY — do not fill with 5pm-SC
  - 5pm-SC fills Server slot 1 or 2 based on start time like any other server
  - Swing slot is reserved exclusively for 6pm-CL

This is payroll-critical — do not change any point values or math, only the slot assignment logic.

---

## 2. Rail — delete or archive pending requests

Each pending request card gets a ••• menu with two options:

**Delete:** permanently removes from database
Confirm dialog: "Delete this request from [Name] for [date]? This cannot be undone."
Buttons: Delete permanently (red) · Cancel

**Archive:** sets status to 'archived', hides from pending queue
Confirm dialog: "Archive this request from [Name] for [date]? It will be hidden from the pending queue but kept on record."
Buttons: Archive · Cancel

**Archived section:** collapsed by default at bottom of Rail left column. Shows archived requests with a Restore button that moves them back to pending.

Database: add 'archived' as valid status value in rail_requests.

---

## 3. Per-section per-week schedule locking

Each section (FOH, BOH+Kitchen, Management) has its own lock state per week — completely independent.

Lock button label: "Lock FOH — Jul 27"
When locked: "Locked ✓ — Jul 27" in red for that section only
Navigating weeks shows that week's lock state for the current section.

Database: add locked (boolean, default false) and locked_at (timestamptz) to schedule_weeks table. Unique constraint must cover (week_start, section).

**Tip Sheet per-date locking:**
Each day's Tip Sheet has its own lock — "Lock Jul 30" locks only that date.
When locked: all inputs read-only, Finalize button dims.
Unlock by pressing again.
Lock ≠ Finalize — both can exist independently.

Database: add locked (boolean, default false) and locked_at (timestamptz) to tip_sheets table if not already present.

---

## Database changes
- rail_requests: add 'archived' as valid status
- schedule_weeks: add locked (boolean, default false), locked_at (timestamptz nullable)
- tip_sheets: add locked (boolean, default false), locked_at (timestamptz nullable)

---

## Order of work
1. Tip Sheet Swing Server fix — payroll-critical, do first
2. Rail delete/archive
3. Per-section per-week schedule locking + Tip Sheet per-date locking

## Explicitly unchanged
- All tip math, floor check, truncation logic
- Finalize button behavior
- All email/Gmail/Rail approval flow
- Print/PDF outputs
- Role colors, cross-role labels
