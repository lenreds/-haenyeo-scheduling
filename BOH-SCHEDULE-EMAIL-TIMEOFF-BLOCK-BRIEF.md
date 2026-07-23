# HaenyeoMNG — Update Brief: BOH+Kitchen Schedule Emails & Approved Time-Off Blocking

**Context:** The app is live (Vercel + Supabase). This brief covers two focused additions. Read HANDOFF-HaenyeoMNG.md for full project context first.

---

## 1. BOH+Kitchen schedule publish emails

When the manager clicks Publish on the Calendar, two separate emails go out:
- FOH email → sent to all registered FOH staff (existing behavior, unchanged)
- BOH+Kitchen email → sent to all registered BOH and Kitchen staff showing only the BOH+Kitchen schedule

### Preview modal update
The existing Publish preview modal should show two send counts:
- "FOH: Sending to X of Y staff (Z not yet registered)"
- "BOH+Kitchen: Sending to X of Y staff (Z not yet registered)"
One Confirm & Send button sends both emails simultaneously.

### The BOH+Kitchen email
Subject: Haenyeo Schedule — BOH & Kitchen — Week of [Mon Date] – [Sun Date]
Body: BOH+Kitchen schedule for that week — Kitchen section first, divider, BOH section below. Same clean table format as the FOH email, readable on mobile. Jon appears in the Kitchen section if scheduled there.

### Who receives it
- Staff in section = 'BOH' or section = 'Kitchen' where registered = true
- Management staff do NOT receive this email
- FOH staff do NOT receive this email
- Apply Gmail label Sent/Schedules to the sent copy

---

## 2. Approved time-off blocking on the schedule

When a manager tries to change a schedule cell for a staff member on a day they have an approved time-off override (schedule_overrides row with override_type = 'OFF' and rail_request_id is not null), the app blocks the change and shows a dialog.

### Dialog copy
"[Name] has approved time off on [day]. Their request was approved — are you sure you want to schedule them anyway?"

Two buttons:
- Override — proceeds with the schedule change, overwrites the Off override for that date
- Keep Time Off — closes the dialog, no change made

### Trigger condition
- Only fires for approved Rail-sourced overrides (rail_request_id is not null)
- Does NOT fire for manually set Off cells (no rail_request_id)
- Does NOT fire for pending requests — only approved ones
- Applies to both FOH and BOH+Kitchen schedule dropdowns

### On override confirmed
- Overwrite the schedule_overrides row with the new shift type
- Rail request status stays "approved" — don't change it
- No automatic email to staff member

### Visual indicator (passive)
Add a subtle visual indicator on cells that have an approved time-off override — a small icon or color on the cell so the manager can see blocked days at a glance before clicking.

---

## Database changes
None required — schedule_overrides.rail_request_id already exists.

---

## Order of work
1. Approved time-off blocking + visual indicator (item 2)
2. BOH+Kitchen schedule email + preview modal update (item 1)

## Explicitly unchanged
- FOH schedule publish email — untouched
- All tip math, Rail, Gmail connection — untouched
- Staff registration flow — untouched
- The approved/denied Rail flow itself — untouched
