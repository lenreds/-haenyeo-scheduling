# HaenyeoMNG — Update Brief: Multi-Week Schedule Publish with PDF Attachments

**Context:** The app is live (Vercel + Supabase). This brief upgrades the Publish flow to support sending multiple weeks at once with PDF attachments. Read HANDOFF-HaenyeoMNG.md for full project context first.

---

## Overview

When the manager clicks Publish on the Calendar, they can now choose to send 1, 2, 3, or 4 weeks at once. All selected weeks go in one email (stacked), and each week is also attached as its own PDF file.

---

## 1. Updated Publish preview modal

### Week selector
- Show the current week and up to 3 future weeks as checkboxes (4 total max)
- Each checkbox shows the week date range: e.g. "Jul 20 – Jul 26" / "Jul 27 – Aug 2"
- Current week pre-checked by default
- At least 1 must be selected to proceed
- Send counts update to reflect all selected weeks combined

### Preview
- Condensed preview of each selected week stacked
- Confirm & Send and Cancel buttons unchanged

---

## 2. The email

### Subject line
- 1 week: Haenyeo Schedule — Week of [Mon] – [Sun] (unchanged)
- 2+ weeks: Haenyeo Schedule — [Mon of first week] – [Sun of last week]

### Body
- Same branded header (real H hexagon icon + HAENYEO, dark band)
- Each week as a full colored table, stacked with a clear week label above each (e.g. "Week of Jul 20 – Jul 26")
- Thin divider between weeks
- Today highlighting only on the week that contains today
- Off em-dashes, role colors, cross-role labels, manager pills — all unchanged

### PDF attachments
- One PDF per selected week, attached to the email
- Filename: Haenyeo-Schedule-[section]-[Mon-date]-to-[Sun-date].pdf
- Each PDF is the existing single-page branded schedule for that week
- Both FOH and BOH+Kitchen PDFs attach when both groups are being sent

---

## 3. Generating schedule data for future weeks

Future weeks use schedule_patterns + schedule_overrides layered on top — same logic as current single-week publish, applied to each selected week.

---

## 4. BOH+Kitchen publish

Same multi-week logic — stacked weeks in one email, individual PDF attachments per week.

---

## Database changes
None required.

---

## Order of work
1. Update Publish preview modal — week selector checkboxes, updated send counts
2. Build multi-week email body (stacked tables, week labels, dividers)
3. Build PDF attachment generation per week (reuse existing PDF renderer)
4. Wire into existing publish endpoint

## Explicitly unchanged
- FOH vs BOH+Kitchen recipient logic — untouched
- Role colors, today highlight, cross-role labels — untouched
- All tip math, Rail, Gmail connection — untouched
- Single-week publish still works if only one week is selected
