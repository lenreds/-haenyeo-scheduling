# HaenyeoMNG — Combined Build Brief: Staff Registration, Schedule Publish, Tip Sheet Finalization, Gmail Labels & Extended Time Off

**Context:** The app is live (Vercel + Supabase) with Gmail integration and Rail auto-actions working. This brief covers the next full round of features. Read HANDOFF-HaenyeoMNG.md for full project context first. Work through sections in order — each builds on the previous.

---

## 1. Staff email registration flow

### Subject line convention
Staff register by emailing the scheduling inbox with:
[REGISTER] – FirstName LastName – CODEWORD

Body must include their best phone number.

### What the poller does on receiving a [REGISTER] email
1. Verify the code word matches STAFF_REGISTER_CODE environment variable
2. Match the name against the staff table (fuzzy — "Bernie" matches "Bernie")
3. If matched: store email + phone, mark registered = true, send welcome email
4. If name not matched: reply asking them to check spelling and try again
5. If code word wrong: ignore silently

### Database changes
- staff table: add personal_email (text, nullable), phone (text, nullable), registered (boolean, default false)

### Environment variables
- STAFF_REGISTER_CODE — server-side only, Vercel env var, never in code
- VITE_STAFF_REGISTER_CODE — client-side, same value, used for QR code generation

---

## 2. Automatic welcome email on registration

Sent immediately when staff successfully registers. From haenyeo.schedule@gmail.com to their personal email.

Subject: You're registered — here's how scheduling works at Haenyeo

Body:
Hi [Name],

You're all set on the Haenyeo scheduling system. From now on, the weekly schedule will be sent directly to this email every week.

For any scheduling requests, email haenyeo.schedule@gmail.com with the subject line in exactly this format:

SINGLE DAY OFF:
[SCHEDULING] – REQUEST OFF – [Your Name] – [Date]

CONSECUTIVE TIME OFF (date range):
[SCHEDULING] – TIME OFF – [Your Name] – Jul 28 to Aug 4

NON-CONSECUTIVE DAYS OFF (specific dates):
[SCHEDULING] – TIME OFF – [Your Name] – Jul 28, Jul 30, Aug 2

SHIFT SWAP:
[SCHEDULING] – SHIFT SWAP – [Your Name] – [Date]
(In the body, mention who you're swapping with: "swapping with Reiko")

COVERAGE NEEDED:
[SCHEDULING] – COVERAGE REQUEST – [Your Name] – [Date]

You'll receive a reply once your request has been reviewed by management.

If your email or phone number ever changes, scan the "Update My Info" QR code posted in the restaurant and follow the same steps.

— Haenyeo Management

Apply Gmail label Sent/Welcome to sent copy.

---

## 3. Schedule publish emails

When the manager clicks Publish on the Calendar and confirms the preview, the full FOH schedule for that week is emailed to every registered staff member.

### Preview before send
Clicking Publish opens a preview modal showing:
- The week being published (date range)
- The full FOH schedule
- Count: "Sending to X of Y staff (Z not yet registered — will be skipped)"
- Confirm & Send button and Cancel button

### The email
Subject: Haenyeo Schedule — Week of [Mon Date] – [Sun Date]
Body: Full FOH schedule for the week — each person's name and their shift for each day. Clean table format, readable on mobile.

### Rules
- Only send to staff where registered = true
- Skip unregistered staff silently — preview modal shows the count
- Apply Gmail label Sent/Schedules to sent copies

---

## 4. QR codes on the Staff tab

A row of QR code buttons at the top of the Staff tab. Each button opens a modal showing that QR code as a printable/screenshottable image.

### Seven QR codes, each as a separate button:

1. Register
- To: haenyeo.schedule@gmail.com
- Subject: [REGISTER] – Your Name Here – [VITE_STAFF_REGISTER_CODE]
- Body: My best phone number is:

2. Request Off (single day)
- To: haenyeo.schedule@gmail.com
- Subject: [SCHEDULING] – REQUEST OFF – Your Name – Date

3. Time Off (consecutive)
- To: haenyeo.schedule@gmail.com
- Subject: [SCHEDULING] – TIME OFF – Your Name – Start Date to End Date

4. Time Off (non-consecutive)
- To: haenyeo.schedule@gmail.com
- Subject: [SCHEDULING] – TIME OFF – Your Name – Date, Date, Date

5. Shift Swap
- To: haenyeo.schedule@gmail.com
- Subject: [SCHEDULING] – SHIFT SWAP – Your Name – Date
- Body: I'd like to swap with:

6. Coverage Request
- To: haenyeo.schedule@gmail.com
- Subject: [SCHEDULING] – COVERAGE REQUEST – Your Name – Date

7. Update My Info
- To: haenyeo.schedule@gmail.com
- Subject: [UPDATE INFO] – Your Name – [VITE_STAFF_REGISTER_CODE]
- Body: My new email is: \nMy new phone is:

### Implementation note
Generate QR codes client-side using the qrcode npm package encoding mailto: links. No external service needed.

---

## 5. Staff contact directory

### Clickable staff profiles
Each staff member's name in the Staff tab is clickable. Opens a small profile panel showing:
- Name
- Personal email (tap to copy)
- Phone number (tap to copy)
- Registration status (Registered / Not yet registered)

### Unregistered indicator
Staff rows where registered = false show a subtle badge or dot next to their name.

---

## 6. Info update flow

### Subject line convention
[UPDATE INFO] – FirstName LastName – CODEWORD

Body contains new email and/or phone (staff fill in only what changed).

### What the poller does
1. Verify code word
2. Match name to staff table
3. Parse new email/phone from body
4. Do NOT auto-apply — create a pending record in staff_info_updates
5. Show notification on Staff tab: "[Name] has requested an info update"

### Manager review
"Pending updates" section at top of Staff tab (only visible when updates exist). Manager approves or denies each. Approve writes new data. Deny discards.

### Database changes
- New table staff_info_updates (id, staff_id, new_email, new_phone, status: pending/approved/denied, created_at)

---

## 7. Tip Sheet: Finalize button

### UI change
Add a Finalize button to the Tip Sheet tab near the Print button. When clicked:
1. Show confirmation: "Finalize tonight's tip sheet? This will email all staff who worked tonight and lock the sheet. Sending to X staff — Y have no email on file and will be skipped."
2. On confirm: lock sheet, send tip sheet emails, mark as finalized in database
3. On cancel: do nothing

### Locked state
- All input fields become read-only after finalization
- Clear "FINALIZED" indicator at top of sheet
- Unlock button appears — requires confirmation before unlocking
- Unlocking allows edits and re-finalization — does NOT unsend previous emails

### Database changes
- tip_sheets table: add finalized (boolean, default false), finalized_at (timestamptz, nullable)

---

## 8. Tip sheet email on finalization

Sent immediately on finalization. From haenyeo.schedule@gmail.com to every staff member who worked that night AND has a registered email.

### Who gets it
Anyone with a non-Off, non-Gap shift on that date with registered = true. Skip unregistered staff silently.

### Subject line
Haenyeo Tip Sheet — [Day], [Date]
Example: Haenyeo Tip Sheet — Thursday, Jul 24

### Email body (same for all recipients, full breakdown)
- Date and total floor pool (cash + CC)
- Each person who worked: name, position, points, hours, final tip payout
- Bar tip-out amount and recipients
- Floor check confirmation
- "YOUR PAYOUT: $X.XX" line highlighted for the specific recipient (personalize per email)

Apply Gmail label Sent/Tip Sheets to sent copies.

---

## 9. Gmail label organization

Create and apply Gmail labels automatically. Create labels via Gmail API if they don't exist — no manual Gmail setup needed.

### Incoming labels:
- Registrations → all [REGISTER] emails
- Requests/Request Off → [SCHEDULING] – REQUEST OFF emails
- Requests/Shift Swap → [SCHEDULING] – SHIFT SWAP emails
- Requests/Coverage → [SCHEDULING] – COVERAGE REQUEST emails
- Requests/Time Off → [SCHEDULING] – TIME OFF emails
- Info Updates → all [UPDATE INFO] emails

### Outgoing labels:
- Sent/Schedules → weekly schedule publish emails
- Sent/Tip Sheets → finalized tip sheet emails
- Sent/Welcome → registration welcome emails
- Sent/Replies → approval/denial reply emails

---

## 10. Extended and non-consecutive time off requests

### Two new subject line formats

Consecutive:
[SCHEDULING] – TIME OFF – Name – Jul 28 to Aug 4

Non-consecutive:
[SCHEDULING] – TIME OFF – Name – Jul 28, Jul 30, Aug 2

### Rail display
Both create a TIME OFF Rail card showing:
- Staff name
- All dates covered
- Type: "Consecutive" or "Non-consecutive"
- Standard pending/approved/denied status

### Approval behavior
- Both types stay pending for manual manager approval — no auto-approve
- On full approval: write Off override for each date in the range or list
- On approval of range: generate all dates between start and end inclusive
- On approval of non-consecutive: write Off override for each listed date

### Partial Approve option
TIME OFF cards get a Partial Approve button in addition to Approve/Deny. Partial Approve opens a field where manager enters which specific dates are approved. Schedule updates only for approved dates. Manager note required for partial approvals.

### Auto-reply templates

Time Off — Approved (full):
Hi [Name], your time off request for [dates] has been approved. [manager note if provided, otherwise: "Enjoy your time off!"]
— Haenyeo Management

Time Off — Approved (partial):
Hi [Name], your time off request has been partially approved. Approved dates: [approved dates]. [manager note — required]
— Haenyeo Management

Time Off — Denied:
Hi [Name], unfortunately your time off request for [dates] has been denied. [manager note if provided, otherwise: "Please reach out if you have any questions."]
— Haenyeo Management

---

## Database migration summary
- staff: add personal_email, phone, registered
- tip_sheets: add finalized, finalized_at
- New table: staff_info_updates (id, staff_id, new_email, new_phone, status, created_at)

---

## Environment variables needed (add to Vercel before starting)
- STAFF_REGISTER_CODE — server-side, the registration code word
- VITE_STAFF_REGISTER_CODE — client-side, same value

---

## Order of work
1. Database migration (all schema changes)
2. Update Gmail poller: handle [REGISTER], [UPDATE INFO], and TIME OFF formats; apply Gmail labels to all incoming emails
3. Build staff registration logic + welcome email sender
4. Build Staff tab directory: clickable profiles, unregistered indicators, pending info updates section
5. Build QR code buttons on Staff tab
6. Build schedule publish email: preview modal + send on confirm + Sent/Schedules label
7. Build Finalize button + locked state + Unlock on Tip Sheet
8. Build tip sheet email sender: personalized payout highlight, Sent/Tip Sheets label
9. Build TIME OFF Rail card with Partial Approve option + schedule overrides for all affected dates
10. Apply outgoing Gmail labels to all sent email types

## Explicitly unchanged
- All tip math, floor check logic — untouched
- Existing [SCHEDULING] request types (Request Off, Shift Swap, Coverage) — untouched
- Rail approval flow for existing types — untouched
- Gmail connection and OAuth — untouched
- All schedule logic, FOH dropdowns, Management toggle — untouched
