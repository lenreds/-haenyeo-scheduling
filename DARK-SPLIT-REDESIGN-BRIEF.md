# HaenyeoMNG — Update Brief: Dark Split Redesign + Schedule Improvements

**Context:** The app is live (Vercel + Supabase). This is a major visual redesign round combined with several feature additions. Read HANDOFF-HaenyeoMNG.md for full project context first.

**CRITICAL:** The Dark Split redesign must preserve ALL existing functionality exactly as it works today. This is a visual/layout overhaul, not a rebuild. Every feature — Rail, Calendar, Set Schedule, Tip Sheet, Staff, Invoices, Menu — must work identically after the redesign. Test each tab thoroughly before pushing.

---

## 1. Dark Split — full app skin redesign

Apply the Dark Split visual language (from rail-redesign-concepts-4-5.jsx, Concept 4) across the entire app.

### Color palette
- Background: #0c0c0c
- Surface 1 (panels): #111111
- Surface 2 (cards/inputs): #141414
- Border: #1e1e1e / #222222
- Text primary: #ffffff
- Text secondary: #aaaaaa
- Text muted: #555555
- Accent orange: #c8956c (Haenyeo brand — Bar color, today highlights, active states)
- Role colors unchanged: Bar #c8956c, Servers #5a8a6a, Busser/Runner #4a7a9b, Host #8a5a9b, Expo #c8956c, Training #2a9d8f

### Global header
- Dark charcoal (#111111) top bar, full width
- Left: real HAENYEO_ICON (H hexagon) + "HAENYEO / SCHEDULING" in white letterspaced text
- Right: TODAY date + logged-in email + Sign Out button
- Tab navigation sits below the header as a dark bar with tab labels in muted text, active tab in white with orange underline

### Tab order (left to right)
RAIL · CALENDAR · TIP SHEET · SET SCHEDULE · STAFF · INVOICES · MENU

### Rail tab — Dark Split layout
Three-column layout matching Concept 4:

**Left column (220px) — Pending queue:**
- Section header: "PENDING DECISIONS" in small letterspaced muted text
- Each pending request: avatar circle (initials, role color), name, request type in role color, date, urgent dot if urgent
- Selected request gets left border in its role color
- Resolved requests appear below, dimmed

**Center column (flex) — Detail panel:**
- When a request is selected: shows name, type badge, urgent badge, date, note from staff, manager note textarea, Approve and Deny buttons
- When nothing selected: shows "TODAY AT A GLANCE" with today's staff on floor, then "SELECT A REQUEST TO REVIEW" prompt

**Right column (160px) — Auto-action log + Notes:**
- "AUTO-ACTION LOG" section: recent approvals/denials with name, type, action, time
- "CLEAR" button next to AUTO-ACTION LOG header — clears the log entries display (not the database, just the visible list)
- Below the log: "NOTES" section header with note count
- Notes box: compact, shows up to 5 notes, minimized to fit under the log
- Clicking Notes expands to a window showing all notes, with add/edit/delete

**Top bar — 7-day strip:**
- Dark background, each day shows abbreviated day name + date number
- Today highlighted with orange accent dot and subtle orange tint
- Pending request indicators (dots) on days that have pending requests

**Header area:**
- Instead of "RAIL" as the large heading, show the real HAENYEO_ICON + "HAENYEO" in white
- "RAIL" appears only on the tab label
- Gmail connected/disconnected status dot
- Pending count badge

### All other tabs
Apply the dark background and surface colors consistently:
- Calendar, Set Schedule, Tip Sheet, Staff, Invoices, Menu all use #0c0c0c background
- Cards, panels, and sections use #111111 / #141414
- All existing UI elements (dropdowns, buttons, inputs, tables) restyled to match the dark palette
- Role colors remain exactly the same
- The Haenyeo wordmark and H icon remain in all branded positions (Tip Sheet header, print/PDF outputs)
- Print/PDF outputs remain white-background (dark skin is screen-only)

---

## 2. Lock Schedule — per sub-tab

Currently one Lock Schedule button locks all sections at once. Change to per-sub-tab locking:
- FOH has its own Lock button — locking FOH does not lock BOH+Kitchen or Management
- BOH+Kitchen has its own Lock button
- Management has its own Lock button
- Each lock button shows its section name: "Lock FOH" / "Lock BOH+Kitchen" / "Lock Management"
- When locked: that sub-tab's cells are dimmed and non-interactive; the button shows "Locked ✓" in red
- Clicking again unlocks that sub-tab only

---

## 3. Date numbers on schedule column headers

Add the actual date number to each day column header in Set Schedule.
- Format: "Mon 28" / "Tue 29" / "Wed 30" etc.
- The date corresponds to the actual calendar date for that weekday in the currently viewed week
- Today's column gets the existing accent highlight plus the date
- Applies to all sub-tabs (FOH, BOH+Kitchen, Management)

---

## 4. Training role

Add Training as a new schedulable role/shift option.

### Shift options
- Training 4pm
- Training 6pm

### Color
Teal: #2a9d8f — used in the schedule grid cells, role group headers, and the role color legend

### Where it appears
- FOH schedule: Training appears as a new role group section below Host, above Busser/Runner (or at bottom of FOH — wherever makes operational sense)
- Staff tab: when adding/editing a staff member, "Training" is available as a role checkbox
- Any staff member with Training checked gets Training 4pm and Training 6pm as dropdown options for any day
- Training shifts are included in the PDF and email schedule exports with the teal color

### Tip Sheet
Training staff do not appear in the Tip Sheet tip-out slots (they are not tipped) — skip them in the auto-fill logic

---

## 5. Bar and Busser/Runner shift options — add 5pm-SC

Add 5pm-SC to both Bar and Busser/Runner dropdown options:
- Bar: Off, 4pm-FC, 4pm-CL, 5pm-SC, 5pm-CL, 5pm-FC, 6pm-CL
- Busser/Runner: Off, 4pm-FC, 5pm-SC, 5pm-CL, 6pm-CL

---

## 6. Delete button — two-step activation

Currently delete buttons appear on every staff row. Change to a two-step flow:
- A single "Enable Delete" toggle button appears at the top of the Staff tab (above the staff list)
- By default, no delete buttons are visible on any staff row
- Clicking "Enable Delete" turns it on — all staff rows now show their delete buttons (red trash icon)
- The Enable Delete button changes to "Cancel" while active
- Clicking Cancel hides all delete buttons again
- Clicking a delete button still shows the confirmation dialog before actually deleting
- This prevents accidental deletions

---

## 7. Calendar — notes on individual dates

Add the ability to add a note to any specific date on the Calendar.

### How it works
- In the day popup (already exists — shows Rail requests, time off, holiday, View Week button), add a Notes section at the bottom
- A small text input + Add button lets the manager type a note for that specific date
- Notes appear in the popup below the Rail activity
- Notes can be deleted from the popup (X button on each note)
- On the month calendar cell, if a date has a note, show a small pencil icon or dot indicator

### Database
New table `calendar_notes`:

```sql
create table calendar_notes (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  note text not null,
  created_at timestamptz default now()
);
```

---

## 8. Schedule cell buttons — oval/pill shape

Change the shift dropdown/selector buttons in the Set Schedule grid from square/rectangular to oval pill shape. This applies to:
- The shift dropdown selects in FOH, BOH+Kitchen, and Management
- The role picker dropdowns for multi-role staff
- Consistent rounded pill style: border-radius: 20px (or enough to be fully oval)
- Style should feel modern and clean against the dark background

---

## 9. Tip Sheet — Today button on date navigation

Add a **Today** button to the Tip Sheet date navigation (next to Prev Day / Next Day).
- Clicking Today jumps the Tip Sheet directly to today's date
- Button is dimmed/disabled when already viewing today
- Same behavior and style as the Today button on Set Schedule week navigation

---

## 10. 3-month calendar — larger cells

The 3-month calendar view cells are too small and hard to read. Make them larger:
- Increase the cell size in 3-month view
- Day numbers should be clearly readable
- Time-off indicators and holiday markers should still be visible
- If it requires horizontal scrolling on smaller screens that's acceptable — readability is priority

---

## 11. Auto-action log — Clear button

Add a **Clear** button next to the "AUTO-ACTION LOG" header on the Rail tab.
- Clicking Clear removes all entries from the visible auto-action log
- This is a display-only clear — it does not delete anything from the database
- The log repopulates from the database on next page load
- Clear button style: small, muted, unobtrusive — "Clear" in small text

---

## Order of work
1. Dark Split redesign (item 1) — do this first since it affects all tabs
2. Tab order change (part of item 1)
3. Lock per sub-tab (item 2)
4. Date numbers on column headers (item 3)
5. Training role (item 4)
6. Bar/Busser 5pm-SC addition (item 5)
7. Delete button two-step (item 6)
8. Calendar date notes (item 7) — needs migration
9. Oval schedule buttons (item 8)
10. Tip Sheet Today button (item 9)
11. 3-month calendar larger cells (item 10)
12. Auto-action log Clear button (item 11)

## Database migrations needed
- `calendar_notes` table (item 7)

## Explicitly unchanged
- All tip math, floor check, finalize/publish logic
- All email/Gmail/Rail approval logic
- Print/PDF outputs (white background, unchanged)
- All existing shift options (additions only, no removals)
- Staff registration, email parsing
- Weekly schedule independence (just built)
- Notes panel on Set Schedule (just built)
