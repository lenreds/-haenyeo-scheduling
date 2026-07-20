# HaenyeoMNG — Update Brief: Schedule Redesign + Staff Roles + Cash Box

**Context:** The app is live (Vercel + Supabase). This brief covers the first post-launch round of changes, based on the owner's smoke test. Read HANDOFF-HaenyeoMNG.md for full project context first.

---

## 1. FOH Set Schedule: replace click-to-cycle with dropdowns

The click-to-cycle interaction on the Front of House schedule is replaced by compact dropdowns (sized to content, not full-width).

**New shift labels per role** (these replace ALL existing FOH shift labels/types):

| Role | Dropdown options |
|---|---|
| Servers | Off, 4pm-FC, 5pm-CL, 5pm-SC, 6pm-CL |
| Busser/Runner | Off, 4pm-FC, 5pm-CL, 6pm-CL |
| Host | Off, Host 4pm |
| Expo | Off, Expo 5pm, Expo 6pm |
| Bar | Off, 4pm-FC, 4pm-CL, 5pm-CL, 5pm-FC, 6pm-CL |

(FC = first cut, CL = close, SC = second cut. The old labels — "4p – 1st cut", "Bar 4pm", "Bus/Run 6pm", "5p – Close", etc. — are all retired on FOH.)

**Two-step cell for multi-role staff:** If a person can work more than one role, their cell gets a role picker first; picking the role updates the shift dropdown to that role's options. Single-role staff skip the role picker entirely — just the shift dropdown.

**Role access list (drives the role picker):**
- Bernie, Isabella, Abraham → Bar
- Angel → Bar (primary/default) + Servers (emergency coverage)
- Juliette, Halle → Host
- Ivy, Mia, Reiko → Servers
- David → Servers, Busser/Runner, Expo, Host
- Daniel → Servers, Busser/Runner, Expo
- Akira → Busser/Runner (primary/default), Bar, Expo
- Emilio, Miguel, Kevin, Dennis → Busser/Runner

**Tip Sheet compatibility:** The Tip Sheet's auto-fill logic must map the new shift types correctly — the role a person is assigned for the day (via the role picker) determines which point slot they fill, same principle as the current BAR4/BUSRUN6/etc. routing. Do not change any tip math.

## 2. Management schedule: keep click-to-toggle, simplify options

Management (Lenis, Jon) keeps the click-a-cell interaction — do NOT convert to dropdowns. Its options become exactly two: **Off ↔ FM** (Floor Manager). The current Opener/Swing/Closer options are removed for Management.

## 3. Kitchen / BOH: convert to the same dropdown treatment

Kitchen and Back of House get the same dropdown interaction as FOH (item 1). Their shift OPTIONS keep the current values for now (owner will reword later — keep them configurable):
- **BOH:** Off, 3p – Close, 9a – 5p, 12p – 8p
- **Kitchen:** Off, 3p – Close (displays as "Yes" for Jenny and Ajuma), 12p – 8p

Implement all shift-option lists as configurable data (per role, stored in Supabase — e.g. a `role_shift_options` table), not hardcoded — future rewording should be a data edit, not a code change.

## 4. New feature: staff & role management screen

A manager-facing screen to:
- **Add a new staff member:** name + which section (FOH/BOH/Kitchen/Management) + checkboxes for which role(s) they can work
- **Edit existing staff:** change their name, roles, or active status
- Role assignments here drive the role picker options in the schedule (item 1)
- Backed by the existing `staff` table (extend schema as needed — e.g. a `staff_roles` join table for the multi-role support)

## 5. Tip Sheet cash box: counts → dollar amounts

The Cash Reconciliation denomination rows currently take a bill COUNT (2 twenties = type "2"). Change every denomination field to take a DOLLAR AMOUNT instead (2 twenties = type "40"). Opening/Closing totals become a straight sum of the entered amounts — no more multiplying by denomination. Keep the same rows/denominations otherwise.

## 6. Tip Sheet layout: swap Print button and point legend positions

Two placement changes, **Tip Sheet tab only** (do NOT touch the Set Schedule tab's Print button):
- **Print button:** move from the upper-right corner to the **lower-right** of the Tip Sheet.
- **Red point-reference legend** (the "SERVER 1. / SWING SERVER .55 / ..." block): move from its current spot beside the tip input fields to the **upper-right corner** where the Print button used to be.

Note: the legend's contents will also need updating once the new FOH shift labels (item 1) land, if any point-slot naming changes — but its values/points stay the same.

## 7. Remove the Timesheet tab

Remove the Timesheet tab entirely (it's an empty placeholder — the owner will handle timesheets manually for now). Clean removal: tab button + its content block. The phase-2 notes about GPS clock-in etc. in the handoff doc still stand for whenever it returns.

## 8. Calendar month view: day-click popup + holidays + time off

Currently clicking a day always zooms into the week view. Change to: clicking a day opens a **small popup/modal** for that specific date containing:
- Every Rail item touching that date — requests off, shift swaps, AND coverage requests (match by date; approved/pending both worth showing with their status)
- A button ("View week" or similar) that closes the popup and opens the existing weekly schedule zoom for that day's week

The popup should be lightweight — click outside or an X to dismiss. The existing week view itself is unchanged; it's just reached through the popup's button now instead of directly.

**Holiday markers:** Mark the following holidays visually on the month calendar (a label or colored indicator on the date cell):
- US federal: New Year's Day, MLK Day, Presidents Day, Memorial Day, July 4th, Labor Day, Columbus Day, Veterans Day, Thanksgiving, Christmas
- Restaurant holidays: Valentine's Day (Feb 14), Mother's Day (2nd Sun in May), Halloween (Oct 31), New Year's Eve (Dec 31)
These are fixed/recurring yearly — hardcode them, no need for a holiday management screen.

**Employee time off on the calendar:** Each day cell in the month view should show a visual indicator (dot, count badge, or name chips depending on space) for staff with time off touching that date — both pending and approved Rail requests. Clicking the day opens the popup which shows the full detail and status of each.

## 9. Tip Sheet: fix the floor check box calculation

The floor check should verify that the tip-out math closed correctly against what actually came in from the floor.

**Correct formula:**
`(Sum of everyone's final hourly tip payout) − (busser/runner bar tip-out slice) = Floor Pool (cash + CC)`

- "Everyone's final hourly tip payout" = every FOH person's final tip amount after hourly pooling, including Expo and Host flat amounts
- Subtract only the busser/runner share that came from the bar tip-out (that portion originated from bar, not the floor pool)
- Bar's own tips are completely excluded from this check — bar cash and bar CC do not appear anywhere in this calculation
- The result should equal floor cash + floor CC tips
- Tolerance of ~10¢ for truncation drift is fine; green if within tolerance

## 10. FOH schedule: manager on shift banner

Display a banner row of day chips **above the FOH schedule table** showing which manager is on FM for each day of the week. Pulls automatically from the Management schedule tab — no separate entry needed.

- If a manager is set to FM that day: show their name in the chip
- If both managers are FM the same day: show both names
- If no manager is set that day: show a dimmed dash so the gap is obvious
- Read-only on the FOH view — editing still happens in the Management tab only

## Explicitly unchanged
- The "Distributed: ..." footer note on the Tip Sheet stays as-is
- All other tip-out math, truncation rules, time rounding — untouched
- Kitchen/BOH schedule options wording — untouched for now (see item 3)
- Rail, login/auth — untouched
- The weekly schedule view itself — unchanged, just reached via the new popup

## Order of work suggestion
Schema first (role tables + shift-option config), then the FOH dropdown rebuild, then staff management screen, then the small items — Management toggle, cash box change, Tip Sheet layout swaps, floor check fix, Timesheet removal, calendar day popup + holidays + time off, and finally the manager banner.
