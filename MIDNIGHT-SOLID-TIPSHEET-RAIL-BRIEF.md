# HaenyeoMNG — Update Brief: Midnight Solid Calendar, Interactive Rail, Tip Sheet Linking & Shift Management

**Context:** The app is live (Vercel + Supabase). Read HANDOFF-HaenyeoMNG.md for full project context first.

---

## 1. Calendar week view — Midnight Solid dark theme

Apply the Midnight Solid style to the calendar week view schedule AND update the Rail tab background to match.

### Visual spec
- Background: #0a0a0a
- Chip background: #1a1a1a
- Chip border: 0.5px solid #2a2a2a
- Chip text: role color (Bar #c8956c, Servers #5a8a6a, Busser/Runner #4a7a9b, Host #8a5a9b, Training #2a9d8f)
- Off days: centered dot (·) in #222222
- Today column: orange underline on day header, subtle #131108 column tint
- Row borders: 0.5px solid #141414
- Section headers: role color text, small letterspaced

### Rail background update
Shift Rail to match Midnight Solid:
- Main background: #0a0a0a
- Panel/card backgrounds: #0f0f0f and #141414
- Chip/badge backgrounds: #1a1a1a

---

## 2. Fix: 5pm-SC missing from Busser/Runner dropdown

Busser/Runner options must be: Off, 4pm-FC, 5pm-SC, 5pm-CL, 6pm-CL

Verify in: live schedule grid dropdown, PDF export, email schedule, role_shift_options table in Supabase.

---

## 3. Shift option management — Add Shift button

On the Staff tab, add a Manage Shifts section showing all shift options per role.

- Each role listed with its current shift options
- Green "+ Add Shift" button next to each role
- Clicking opens an inline text field — type new shift label, press Enter to save
- Saved to role_shift_options table — immediately appears in schedule dropdowns
- Small X next to each existing option to remove it (doesn't affect already-scheduled shifts)

---

## 4. Rail — Resolved section Clear button

Add a "Clear resolved" button below the resolved list in the Rail left column.
- Display-only clear — does not delete from database
- Small, muted style
- List repopulates from database on next page load

---

## 5. Rail — Today at a Glance interactive staff swaps

Each staff member in Today at a Glance gets a swap icon. Clicking opens a dialog:
- Date: today (auto-filled, read-only)
- Removing: current staff member (auto-filled)
- Replacing with: dropdown of active staff
- New shift: dropdown for replacement's role
- Note: optional text field
- Confirm Change and Cancel buttons

### Confirmation warning before saving
"This will update [Name]'s shift on [date] on the finalized schedule and tip sheet. This change cannot be automatically undone. Are you sure?"

### What updates atomically
1. schedule_overrides: OFF for removed person, new shift for replacement
2. Calendar: finalized schedule reflects change immediately
3. Tip Sheet: auto-fill for that date uses updated schedule

---

## 6. Tip Sheet — linked to weekly schedule + slot ordering

Tip Sheet auto-fill reads from weekly_schedules for the current date, with schedule_overrides on top. Falls back to schedule_patterns if no weekly data exists.

### Slot fill order (payroll-critical)
Servers: slot 1 → earliest start (4pm first), slot 2 → second earliest, Swing → 5pm-SC
Busser/Runner: slot 1 → earlier start, slot 2 → later start
Bar: Bartender → earliest bar start, Bartender Swing → later bar start
Expo and Host: unchanged
Training: excluded from all tip slots

---

## Database changes
- role_shift_options: add Busser/Runner 5pm-SC row if missing
- No new tables needed

---

## Order of work
1. Fix 5pm-SC (item 2)
2. Midnight Solid calendar + Rail color (item 1)
3. Resolved Clear button (item 4)
4. Shift option management UI (item 3)
5. Tip Sheet linked to weekly schedule + slot ordering (item 6)
6. Today at a Glance interactive swaps (item 5)

## Explicitly unchanged
- All tip math, floor check, truncation logic
- All email/Gmail/Rail approval flow
- Print/PDF outputs
- Role colors
- Weekly schedule independence
