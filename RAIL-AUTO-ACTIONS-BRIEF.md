# HaenyeoMNG — Rail Auto-Actions Brief

**Context:** The app is live (Vercel + Supabase) with Gmail integration working. This brief adds two connected features: automatic schedule updates when Rail requests are approved, and automatic email replies to staff when their requests are approved or denied. Read HANDOFF-HaenyeoMNG.md for full project context first.

---

## 1. Auto-update schedule on Rail approval

When a manager approves or denies a Rail request, the schedule should update automatically — no manual Set Schedule edit needed.

### Request Off (approved)
- Find the staff member's `schedule_patterns` row for the matching weekday
- Insert a `schedule_overrides` row for that specific date with `override_type = 'OFF'`
- That date now shows as Off on the schedule, overriding whatever the recurring pattern says
- On denial: no schedule change

### Shift Swap (approved)
- Parse the Rail request to identify the two people swapping (name + date)
- Swap their `schedule_overrides` for that date — Person A gets Person B's shift, Person B gets Person A's shift
- If either person has no existing override for that date, pull their pattern shift as the base value before swapping
- On denial: no schedule change

### Coverage Request (approved)
- Insert a `schedule_overrides` row for that date with `override_type = 'GAP'`
- The schedule shows that slot as needing coverage (existing GAP display logic handles this)
- On denial: no schedule change

### General rules
- Overrides only affect the specific date in the request — never touch the recurring weekly pattern
- If a date is already overridden, surface a warning before overwriting — don't silently clobber existing data
- The Rail approval UI itself is untouched — the schedule update happens as a side effect of the existing approve/deny action, not a new button

---

## 2. Auto-reply emails to staff on approval/denial

When a manager approves or denies a Rail request, the app automatically sends a reply to the original email thread.

### Gmail scope
Add `gmail.send` to the existing OAuth scope. This requires:
1. Adding the scope in the code
2. Adding `https://www.googleapis.com/auth/gmail.send` in Google Cloud Console → Data Access
3. The owner will redo the OAuth flow once (`/api/auth/start`) to grant the new scope

### Reply logic
Reply to the original email thread (use the Gmail thread ID stored with the rail_request) so it appears as a reply, not a new email.

### Message templates (per request type)

**Request Off — Approved:**
> Hi [Name], your time off request for [date] has been approved. [manager note if provided, otherwise: "Enjoy your day off!"]
> — Haenyeo Management

**Request Off — Denied:**
> Hi [Name], unfortunately your time off request for [date] has been denied. [manager note if provided, otherwise: "Please reach out if you have any questions."]
> — Haenyeo Management

**Shift Swap — Approved:**
> Hi [Name], your shift swap request for [date] has been approved. [manager note if provided, otherwise: "The schedule has been updated accordingly."]
> — Haenyeo Management

**Shift Swap — Denied:**
> Hi [Name], unfortunately your shift swap request for [date] has been denied. [manager note if provided, otherwise: "Please reach out if you have any questions."]
> — Haenyeo Management

**Coverage Request — Approved:**
> Hi [Name], your coverage request for [date] has been approved. [manager note if provided, otherwise: "We'll find coverage for your shift."]
> — Haenyeo Management

**Coverage Request — Denied:**
> Hi [Name], unfortunately your coverage request for [date] has been denied. [manager note if provided, otherwise: "Please reach out if you have any questions."]
> — Haenyeo Management

### Manager note field
The Rail approval UI needs a small optional note field when approving or denying — a single text input that appears inline on the card before confirming. If left blank, the default message fills in. If filled, it replaces the default in the reply.

### Fallback
If the original email has no thread ID stored (manually created Rail entries), skip the email reply silently — log it but don't error.

---

## Database changes needed
- `rail_requests`: add `gmail_thread_id` (text, nullable) — store when poller parses emails
- `rail_requests`: add `manager_note` (text, nullable) — stores note entered at approval/denial
- `schedule_overrides`: add `rail_request_id` (uuid, nullable, references rail_requests) — links override back to the request

---

## Order of work
1. Database migration (add the three columns)
2. Update Gmail poller to store `gmail_thread_id` on new rail_requests
3. Build schedule auto-update logic on approval
4. Add manager note field to Rail approval UI
5. Build auto-reply sender — add `gmail.send` scope, wire replies to approval/denial
6. Owner redoes OAuth flow at `/api/auth/start` to grant `gmail.send`

## Explicitly unchanged
- All tip math, schedule logic, Rail display — untouched
- Approval/denial UI flow — only adding the optional note field
- Manually created Rail entries work normally — just no email reply (no thread ID)
