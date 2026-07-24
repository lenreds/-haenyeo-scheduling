# HaenyeoMNG — Update Brief: Print Fixes, Calendar 3-Month Layout & Tip Sheet Print

**Context:** The app is live (Vercel + Supabase). This brief fixes remaining issues from the last round of smoke testing. Read HANDOFF-HaenyeoMNG.md for full project context first.

---

## 1. Calendar 3-month view — fix layout to show 3 months side by side

The 3-month view is currently only rendering one month at a time. Fix it to show 3 months simultaneously in a horizontal layout.

### Layout (flat/open, no card backgrounds)
- 3 months displayed side by side in equal-width columns
- Each month has its name above it (e.g. "JULY 2026") in small letterspaced text
- Current month label in the accent orange, other months in grey
- Each month is a standard 7-column day grid (Mon–Sun)
- Today's date gets the accent orange circle highlight
- Time-off indicators (dots) appear on relevant days in all 3 months
- Holiday markers appear in all 3 months
- Clicking any day opens the existing day popup
- Prev/Next arrows navigate 3 months at a time
- No card backgrounds, no borders around individual months — open flat layout matching the existing 1-month style

---

## 2. Set Schedule print — fix to show clean single page

### What needs to change
- Hide completely in print: sub-tab pills, navigation arrows, Today button, Lock Schedule button, Finalize button, Publish button, any hint/helper text
- Shift cells: show plain text of the selected shift value (not dropdowns)
- Role group headers: keep with role colors
- Manager banner: keep
- Today column: keep accent highlight
- One clean landscape page — white background, logo header, role colors, em-dash for Off days

### How to implement
The existing buildScheduleSheetNode() function already generates the correct HTML for the PDF. Reuse that same renderer for the print output — inject it into the page before printing and remove after, or use a @media print approach that swaps the schedule grid for the rendered sheet node. The key is the printed output uses the PDF renderer, not the live interactive grid.

---

## 3. Tip Sheet print — fix layout and orientation

### Orientation
Force portrait orientation: @page { size: portrait; }

### Layout fixes
- Add breathing room below the logo/header
- Two-column layout (cash box left, tip table right) preserved but scaled for portrait width
- All content fits on one page

### Items to remove from print/PDF
- "Custom Schedule" button/toggle
- Dimmed helper text under cash box
- Dimmed "Distributed: $X of $Y..." text in lower center
- Any other grey hint/instructional text

### Floor check and summary boxes
- Print/PDF: outline only, no filled backgrounds
- Green floor check → green border, white background
- Amber summary boxes → amber border, white background

---

## Order of work
1. Calendar 3-month layout fix
2. Set Schedule print fix — reuse PDF renderer
3. Tip Sheet print orientation and layout fixes

## Explicitly unchanged
- All schedule logic, tip math, Rail, Gmail — untouched
- Finalize/Publish workflow — untouched
- Role colors, cross-role labels — untouched
- 1-month calendar view — untouched
