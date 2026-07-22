# HaenyeoMNG — Update Brief: Staff Delete, QR Print Sheet & Manual Registration

**Context:** The app is live (Vercel + Supabase). Small focused round of changes. Read HANDOFF-HaenyeoMNG.md for full project context first.

---

## 1. Delete staff from the Staff tab

Add a **Delete** button to each staff member's row in the Staff tab, alongside the existing Active toggle.

### Behavior
- Clicking Delete opens a confirmation dialog: "Are you sure you want to delete [Name]? This cannot be undone."
- Two buttons: **Delete** (confirms, red/danger style) and **Cancel**
- On confirm: permanently delete the staff member from the `staff` table — this cascades to their `staff_roles`, `schedule_patterns`, and any `rail_requests` or `schedule_overrides` tied to them (use ON DELETE CASCADE or handle explicitly)
- On cancel: close dialog, no change

### UI placement
- Delete button sits next to the Active toggle on each staff row
- Style it as a small danger/red button or a trash icon to distinguish it from the Active toggle
- Always show the Delete button but include in the confirmation dialog: "This person is currently on the schedule — deleting them will remove all their shifts."

### Important
This is permanent and immediate — no soft delete, no recovery. The confirmation dialog is the only safeguard.

---

## 2. QR code print sheet

Add a **Print QR Codes** button at the top of the Staff tab, near the existing QR code buttons. Clicking it opens a print-optimized page or triggers the browser print dialog showing all 7 QR codes on one sheet.

### Layout
- Haenyeo logo and wordmark centered at the top
- Subtitle: "Scan the code that matches your request and follow the instructions"
- 7 QR codes in a clean grid
- Each QR code has a clear label above and a one-line instruction below
- Clean, professional, black and white friendly

### Instructions per QR code

| QR | Label | Instruction |
|---|---|---|
| Register | Register | Replace "Your Name Here" with your full name, add your phone number, and send |
| Request Off | Request Off | Replace "Your Name" with your name, add the date, and send |
| Time Off (consecutive) | Time Off — Date Range | Replace "Your Name" with your name, add your start and end dates, and send |
| Time Off (non-consecutive) | Time Off — Specific Dates | Replace "Your Name" with your name, list each date separated by commas, and send |
| Shift Swap | Shift Swap | Replace "Your Name" with your name, add the date, and mention who you're swapping with in the body |
| Coverage Request | Coverage Request | Replace "Your Name" with your name, add the date, and send |
| Update My Info | Update Contact Info | Replace "Your Name" with your name and fill in your new email and/or phone number |

---

## 3. Mark Jenny and Ajuma as registered

Include this in the migration file:

```sql
update staff
set registered = true
where name in ('Jenny', 'Ajuma');
```

Their personal_email and phone stay null — to be updated later.

---

## Database changes
- Migration file includes the Jenny/Ajuma registration update
- Ensure DELETE on staff cascades properly to staff_roles, schedule_patterns, schedule_overrides, rail_requests

---

## Order of work
1. Jenny/Ajuma registration (item 3) — included in migration
2. Delete button on Staff tab (item 1)
3. QR print sheet (item 2)

## Explicitly unchanged
- All tip math, Rail, Gmail, schedule logic — untouched
- Active toggle stays as-is alongside the new Delete button
- Existing QR code modals — untouched, Print QR Codes is a separate button
