# HaenyeoMNG — Update Brief: Colored Schedule PDF/Email & QR Sheet Redesign

**Context:** The app is live (Vercel + Supabase). This brief redesigns the schedule PDF export, schedule email, and QR print sheet with color and branding. Read HANDOFF-HaenyeoMNG.md for full project context first.

**CRITICAL: Use the actual embedded logo assets** — the HAENYEO_ICON (H hexagon mark) and HAENYEO_LOGO (wordmark) base64 images already in the codebase. Do NOT recreate, redraw, or approximate the logos.

---

## 1. Schedule PDF redesign (both FOH and BOH+Kitchen exports)

### Header band
- Dark charcoal (#1a1a1a) band across the top with rounded top corners
- Left: the real HAENYEO_ICON H hexagon image (~36px) next to "HAENYEO" in white letterspaced text, section subtitle below in warm orange (#c8956c): "FRONT OF HOUSE SCHEDULE" or "BOH & KITCHEN SCHEDULE"
- Right: week date range in white, "Printed [date]" below in grey

### Day columns
- Day headers (MON–SUN) in uppercase grey
- Today's column highlighted: header cell filled with warm orange (#c8956c), white text, ★, and the entire column gets a subtle warm tint (#fff8f4) — only when the printed week contains today

### Role group sections
- Each role group gets a colored section header row with colored top border and dot:
  - Bar → warm orange (#c8956c)
  - Servers → green (#5a8a6a)
  - Busser/Runner → blue (#4a7a9b)
  - Host → purple (#8a5a9b)
  - Kitchen → warm orange, BOH → blue on the BOH+Kitchen version
  - Manager On → neutral grey
- Staff names medium weight; shifts centered in day cells
- Off days shown as italic grey em dash (—) instead of "Off"

### Manager On row
- Manager names as small dark pill badges (dark bg, white text, rounded)

### Footer legend
- Today indicator swatch, "— Day off" explanation, role color dots with labels aligned right

### Constraints
- One single page — scale to fit (landscape)
- Black and white printer friendly — colors are accents, not heavy fills

---

## 2. Schedule email redesign (both FOH and BOH+Kitchen emails)

- Same design language as the PDF: dark header band with real logo images (inline base64 or CID attachments so they render in email clients)
- Same role group colors, today highlighting, em-dash off days, manager pills
- Must render correctly in Gmail mobile and desktop — table-based HTML layout with inline styles
- Keep lightweight — compress/resize logos for email

---

## 3. QR print sheet redesign

### Header band
- Dark charcoal band: real HAENYEO_ICON + "HAENYEO" centered, subtitle in warm orange: "SCHEDULING SYSTEM — SCAN THE CODE THAT MATCHES YOUR REQUEST"

### Register block — "START HERE"
- Full-width highlighted block: warm tint background (#fff8f4) with orange border
- Register QR (~90px) on the left
- Right: orange "START HERE" pill badge + "Register (first time only)" heading, instruction: "Scan, replace 'Your Name Here' with your full name, add your phone number, and hit send. You'll get a welcome email explaining everything."

### The 6 remaining codes — 3×2 grid
Each card: QR centered (~70px), label below, one-line instruction, colored top border:
- Request Off, Time Off — Date Range, Time Off — Specific Days → green
- Shift Swap, Coverage Request → blue
- Update My Info → purple

Instructions:
| Card | Instruction |
|---|---|
| Request Off | Single day off — add your name and the date |
| Time Off — Date Range | Multiple days in a row — add start and end dates |
| Time Off — Specific Days | Scattered dates — list each one separated by commas |
| Shift Swap | Add the date + say who you're swapping with |
| Coverage Request | Need your shift covered — add your name and date |
| Update My Info | New email or phone? Fill in what changed |

### Footer
- Thin divider, then: "All requests go to haenyeo.schedule@gmail.com — you'll get a reply once reviewed" left, "Questions? Ask a manager" right

### Constraints
- One single page, portrait
- QR codes fully scannable at printed size (~2cm minimum)
- Black and white printer friendly

---

## Order of work
1. Schedule PDF redesign — FOH first, then BOH+Kitchen variant
2. Schedule email redesign — same layout adapted for email-safe HTML
3. QR sheet redesign

## Explicitly unchanged
- All schedule logic, publish flow, recipient logic — visual only
- Tip Sheet PDF — untouched this round
- QR code contents/mailto links — untouched, layout only
- All tip math, Rail, Gmail — untouched
