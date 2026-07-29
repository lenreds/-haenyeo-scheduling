# HaenyeoMNG — Update Brief: Simplified Email Parsing, Manual Staff Emails & Unlimited Navigation

**Context:** The app is live (Vercel + Supabase). This brief simplifies the email request flow, adds manual email entry for staff, and removes hard limits on schedule and calendar navigation. Read HANDOFF-HaenyeoMNG.md for full project context first.

---

## 1. Simplified email request parsing

Replace the rigid [SCHEDULING] – TYPE – Name – Date subject line format with flexible keyword matching. Staff write naturally — the app figures out the type from keywords and the person from their registered email address.

### How it works
- Any email from a registered staff email address is checked for keywords
- Sender's email matched against staff.personal_email to identify who sent it
- Keywords in subject (case-insensitive, partial match):
  - Contains "off", "time off", "day off", "request off" → REQUEST OFF
  - Contains "swap", "switch", "trade" → SHIFT SWAP
  - Contains "cover", "coverage", "need someone" → COVERAGE REQUEST
  - Contains "time off" + date range → TIME OFF (multi-day)
- Date parsing: extract any date or date range from subject. If none found, leave blank for manager to fill in
- Email body captured as the note field on the Rail card

### What creates a Rail card
1. Sender email matches registered staff member
2. Subject contains at least one keyword
3. Rail card created as pending with: staff name, type, parsed date (if any), note (email body)
4. Apply appropriate Gmail label

### What does NOT create a Rail card
- Emails from unregistered addresses → skip silently, log to server
- Emails with no recognizable keyword → skip silently, log to server
- Old [SCHEDULING] format still works as fallback

### Auto-reply on card creation
> Hi [Name], got your message — we've logged your request and will get back to you soon.
> — Haenyeo Management

### Unmatched sender handling
Unknown address → don't create Rail card. Surface small notification on Rail tab: "1 unrecognized email — check inbox."

---

## 2. Manual staff email entry on Staff tab

### Changes to Staff tab
- Each staff member's profile gains an Edit button
- Clicking Edit makes email and phone fields directly editable inline
- Save and Cancel buttons appear while in edit mode
- Saving writes personal_email and phone directly to the staff table
- When email is saved, automatically set registered = true
- "Not yet registered" indicator updates to "Registered" immediately

### What this replaces
- QR code registration flow stays — staff can still self-register
- Manual entry is now a fully supported first-class path
- Both paths result in: email on file, registered = true

---

## 3. Unlimited schedule navigation (Set Schedule tab)

### Changes
- Week navigation arrows have no maximum forward or backward limit
- App generates schedule data for any week on demand using schedule_patterns + schedule_overrides
- No fixed week array — dynamic week generator from weekOffset state value
- Any offset from current week generates correct Mon–Sun date range and pulls right shift data
- Today button always snaps back to current week

---

## 4. Unlimited calendar navigation

### Changes
- 1-month and 3-month views have no navigation limit in either direction
- Holiday markers compute correctly for any year, not just 2026
- Time-off indicators pull from rail_requests for whatever date range is displayed
- No hardcoded window

---

## Database changes
None required — schedule_patterns + schedule_overrides already support any date.

---

## Order of work
1. Manual staff email entry (item 2)
2. Unlimited calendar navigation (item 4)
3. Unlimited schedule navigation (item 3)
4. Simplified email parsing (item 1)

## Explicitly unchanged
- All tip math, Finalize/Publish workflow, print/PDF outputs — untouched
- Old [SCHEDULING] subject format still works as fallback
- QR code registration flow stays
- Rail approval flow, auto-reply emails on approval/denial — untouched
