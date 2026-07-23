# HaenyeoMNG — Update Brief: Manual Rail Entry, PDF Export & Invoices Tab

**Context:** The app is live (Vercel + Supabase). This brief covers three additions. Read HANDOFF-HaenyeoMNG.md for full project context first.

---

## 1. Manual Rail entry form

Add a **+ Add Request** button on the Rail tab that opens a modal form for manually logging a scheduling request made in person.

### Form fields
- **Staff member** — dropdown populated from the staff table (active staff only)
- **Type** — dropdown: Request Off / Shift Swap / Coverage Request / Time Off
- **Dates** — text input (free text, e.g. "Jul 28" or "Jul 28 to Aug 4" or "Jul 28, Jul 30")
- **Note** — text area for any context or details
- **Logged by** — dropdown: Lenis / Jon (pull from Management section of staff table)
- **Submit** and **Cancel** buttons

### On submit
1. Create a new rail_requests row with status = 'pending', staff_id matched from the dropdown, and all form fields populated
2. Send confirmation email to both:
   - haenyeo.schedule@gmail.com (paper trail)
   - Staff member's registered personal email if on file
3. Rail entry appears in pending queue immediately
4. gmail_thread_id will be null — existing fallback handles this gracefully

### Confirmation email copy

To scheduling inbox:
Subject: [MANUAL ENTRY] – [Type] – [Name] – [Dates]

A scheduling request was manually logged by [Manager Name].

Staff: [Name]
Type: [Type]
Dates: [Dates]
Note: [Note if provided]

This entry is now pending in the Rail.
— Haenyeo Management

To staff member (if registered):
Subject: Your scheduling request has been logged

Hi [Name], just confirming that your [type] request for [dates] has been logged in the system. You'll hear back once it's been reviewed.

[Note if provided by manager]

— Haenyeo Management

### Gmail label
Apply Requests/[Type] label to the scheduling inbox copy.

---

## 2. PDF export for Schedule and Tip Sheet

Add a **Save as PDF** button to both the Set Schedule tab and the Tip Sheet tab.

### Set Schedule PDF
- Button near the existing Print button
- Exports currently visible schedule (whichever sub-tab is active) as a clean PDF download
- Filename: Haenyeo-Schedule-[section]-[week-date-range].pdf
- Same layout as print view — Haenyeo logo at top, schedule table, no navigation chrome

### Tip Sheet PDF
- Button near the existing Print and Finalize buttons
- Exports current day's tip sheet as a PDF download
- Filename: Haenyeo-TipSheet-[date].pdf
- Same layout as print view — full tip sheet with logo, cash reconciliation, and tip breakdown

### Implementation
Prefer direct download (not print dialog) — use html2canvas + jsPDF or equivalent client-side library so the user gets a downloaded file without interacting with a print dialog.

---

## 3. Invoices tab (placeholder)

Add a new **Invoices** tab to the main navigation after the Staff tab.

- Clean placeholder page with Haenyeo logo, "Invoices" heading, and "Invoice tracking coming soon." note
- No functionality — placeholder only
- Future build (out of scope now): invoice logging, file upload, filtering, export

---

## Database changes
- Add logged_by (text, nullable) to rail_requests — store manager name who logged the entry
- Include in migration file

---

## Order of work
1. Manual Rail entry form + confirmation emails (item 1)
2. PDF export buttons on Schedule and Tip Sheet (item 2)
3. Invoices placeholder tab (item 3)

## Explicitly unchanged
- All existing Rail entries and approval flow — untouched
- Tip math, finalize logic — untouched
- Gmail integration, staff registration — untouched
- All schedule logic — untouched
