# HaenyeoMNG — Update Brief: Registration Fix, QR Encoding, Printer-Friendly PDF, Calendar Multi-Month & Menu Tab

**Context:** The app is live (Vercel + Supabase). This brief covers two bug fixes, one design change, one new calendar feature, and one new tab. Read HANDOFF-HaenyeoMNG.md for full project context first.

---

## 1. BUG FIX — Staff registration not processing

Recent [REGISTER] emails are arriving but not being processed — staff not marked registered, emails not moving to Registrations label.

### Investigate and fix
- Check the poller (/api/poll) for errors specific to [REGISTER] subject handling
- Verify STAFF_REGISTER_CODE environment variable is being read correctly server-side
- Check if fuzzy name matching is failing silently
- Check if Gmail label creation/application is failing for the Registrations label
- Add better error logging so registration failures surface visibly
- Test end-to-end after fixing

### Expected behavior
Email arrives → poller detects [REGISTER] subject → verifies code word → fuzzy matches name → sets registered = true and stores email → sends welcome email → applies Registrations Gmail label

---

## 2. BUG FIX — QR code mailto links encoding spaces as + signs

Staff scanning QR codes see + signs instead of spaces in pre-filled subject/body. Spaces in mailto: links must be %20, not +.

### Fix
- Audit every mailto: link for all 7 QR codes
- Replace + encoding with %20 for spaces
- Line breaks in body must be %0A
- Verify fix works on iOS Mail and Gmail apps

### Correct encoding for all 7 QR codes
1. Register: subject [REGISTER]%20–%20Your%20Name%20Here%20–%20CODEWORD, body My%20best%20phone%20number%20is%3A%20
2. Request Off: subject [SCHEDULING]%20–%20REQUEST%20OFF%20–%20Your%20Name%20–%20Date
3. Time Off (consecutive): subject [SCHEDULING]%20–%20TIME%20OFF%20–%20Your%20Name%20–%20Start%20Date%20to%20End%20Date
4. Time Off (non-consecutive): subject [SCHEDULING]%20–%20TIME%20OFF%20–%20Your%20Name%20–%20Date%2C%20Date%2C%20Date
5. Shift Swap: subject [SCHEDULING]%20–%20SHIFT%20SWAP%20–%20Your%20Name%20–%20Date, body I%27d%20like%20to%20swap%20with%3A%20
6. Coverage Request: subject [SCHEDULING]%20–%20COVERAGE%20REQUEST%20–%20Your%20Name%20–%20Date
7. Update My Info: subject [UPDATE%20INFO]%20–%20Your%20Name%20–%20CODEWORD, body My%20new%20email%20is%3A%20%0AMy%20new%20phone%20is%3A%20

---

## 3. Printer-friendly PDF schedule

Replace the dark charcoal header band in the PDF with a clean white header to save ink. Email version keeps the dark band — this only affects Save as PDF and PDF attachments.

### New PDF header
- White background, no dark band
- Top left: real HAENYEO_ICON (~36px) next to "HAENYEO" in dark charcoal letterspaced text
- Below logo: section name in warm orange (#c8956c) — "FRONT OF HOUSE SCHEDULE" or "BOH & KITCHEN SCHEDULE"
- Top right: week date range in dark charcoal, "Printed [date]" in grey below
- Thin charcoal bottom border separating header from table

### Everything else unchanged
Role group colors, today highlight, role color cells, cross-role labels, em-dash off days, manager pills, footer legend, one landscape page — all kept exactly as-is.

---

## 4. Calendar multi-month view

Add a view selector to the Calendar tab:
- 1 Month (current default)
- 2 Months
- 3 Months
- 6 Months
- 12 Months (Full Year)

### Behavior
- View selector near existing month navigation arrows
- Prev/next arrows navigate by the selected interval
- Day cells scale down as more months shown — smaller but still readable
- Today highlight, time-off indicators, holiday markers all still show in all views
- Clicking a day opens the existing day popup in all views
- Week view (via View Week button) unchanged

### Layout
- 2 months: side by side
- 3 months: 3 columns
- 6 months: 3×2 grid
- 12 months: 4×3 grid

---

## 5. Menu tab (placeholder)

Add a Menu tab to main navigation after the Invoices tab.
- Clean placeholder: Haenyeo logo, "Menu" heading, "Coming soon." note
- No functionality — consistent with Invoices placeholder style

---

## Order of work
1. QR encoding fix (item 2)
2. Registration poller fix (item 1)
3. Printer-friendly PDF header (item 3)
4. Menu tab placeholder (item 5)
5. Calendar multi-month view (item 4)

## Explicitly unchanged
- Email body design — dark header band stays in emails
- All schedule logic, tip math, Rail, Gmail connection — untouched
- Existing month/week calendar views — extended, not replaced
- QR mailto contents — only encoding fixed
