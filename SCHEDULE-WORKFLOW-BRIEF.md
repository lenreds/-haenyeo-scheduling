# HaenyeoMNG — Update Brief: Schedule Workflow, Print Fix, Calendar Fix, QR Fix & Tip Sheet PDF

**Context:** The app is live (Vercel + Supabase). This brief covers bugs, design fixes, and the new schedule finalize/publish workflow. Read HANDOFF-HaenyeoMNG.md for full project context first.

---

## 1. BUG FIX — Calendar 3-month view broken + can't navigate months

Two calendar navigation bugs to fix:
- The 3-month view is broken
- The 1-month view prev/next arrows are not navigating to the next/previous month

Fix both. 1-month navigates one month at a time. 3-month shows 3 months side by side and navigates 3 months at a time. Both must show today's highlight, time-off indicators, holiday markers, and day popup on click.

---

## 2. QR code registration — investigate and fix

Registration emails not being processed. Investigate:
- Check if the poller is actually running on Vercel Hobby plan (daily cron may not be triggering)
- Check Vercel function logs for errors during [REGISTER] processing
- Verify STAFF_REGISTER_CODE is set and being read correctly
- Check if Gmail label application is throwing an error blocking the rest of registration

If root cause is daily cron cadence: implement a "Check now" button on the Staff tab that manually triggers the poller — same as the Rail's "Check now" button.

Surface a clear error state on the Staff tab when the last poll failed or returned no results after a [REGISTER] email was expected.

---

## 3. Set Schedule: week navigation extended to 4 weeks ahead

Extend the existing left/right week navigation arrows to allow navigating up to 4 weeks ahead of the current week. No grid view — just extended arrow navigation range.

---

## 4. Set Schedule: Finalize and Publish buttons

### Finalize button
- Add a Finalize button next to Lock Schedule
- Per-week — each week has its own finalized state in the database
- When finalized: button shows "Finalized ✓" in green
- Pressing again un-finalizes — button returns to normal
- Finalize does NOT send emails — just marks week as ready
- Subtle indicator on the week date display shows finalized state

### Publish button
- Only appears on the current week's view (not future weeks)
- Only active if at least the current week is finalized
- When clicked: sends schedule emails for ALL currently finalized weeks (current + future finalized) using existing multi-week email logic
- After publishing: marks published weeks in database
- Remove the Publish button from the Calendar tab entirely — Calendar is now read-only

### Database changes
New table `schedule_weeks`: week_start (date), section (text), finalized (boolean, default false), published (boolean, default false), finalized_at (timestamptz), published_at (timestamptz). Primary key: (week_start, section) or simplify to one row per week if one finalize covers all sections.

---

## 5. Set Schedule: print button fix

Currently prints the app UI with tabs and dropdowns. Fix to print a clean single page:
- Print only the currently visible sub-tab (FOH, BOH+Kitchen, or Management)
- Same layout as the PDF: white header, logo + section name, week date range, role group colors, today highlight, em-dash off days, manager pills, footer legend
- Dropdowns replaced with plain text shift values
- No tabs, navigation, buttons, sub-tab pills, or hint text visible
- One landscape page

---

## 6. Tip Sheet: print and PDF fixes

### A. Header
Update to white header matching the schedule PDF: white background, logo + "HAENYEO / TIP SHEET" in dark charcoal, date on the right, thin bottom border. Remove dark band.

### B. Remove "Custom Schedule" button
Hide from print and PDF entirely.

### C. Remove dimmed helper text
Hide from print and PDF:
- Dimmed instructional text under the cash box
- Dimmed "Distributed: $X of $Y..." text in the lower center
- Any other grey helper/hint text that is not actual tip data

### D. Floor check box and summary boxes — outline only
For print and PDF: colored border with white/transparent background. No filled color backgrounds. Text and border keep their color.

### E. Fit on one portrait page
Scale font sizes and spacing as needed to fit one page.

---

## Order of work
1. Calendar navigation fix (item 1)
2. Tip Sheet print/PDF fixes (item 6)
3. Set Schedule print fix (item 5)
4. Set Schedule week navigation to 4 weeks (item 3)
5. Set Schedule Finalize + Publish buttons (item 4)
6. QR registration investigation (item 2)

## Explicitly unchanged
- All tip math, floor check calculation — untouched
- Rail, Gmail connection, staff registration poller logic — untouched
- Multi-week email and PDF attachment logic — untouched
- Role colors, cross-role labels — untouched
