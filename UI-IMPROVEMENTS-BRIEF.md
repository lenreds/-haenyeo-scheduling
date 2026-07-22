# HaenyeoMNG — Update Brief: Email Rewrites, Cross-Scheduling, BOH+Kitchen Merge & Navigation

**Context:** The app is live (Vercel + Supabase). This brief covers the next round of improvements based on smoke test feedback. Read HANDOFF-HaenyeoMNG.md for full project context first.

---

## 1. Auto-reply email rewrites

Rewrite all auto-reply email templates to feel warm but professional — like a message from a real person, not a system notification. Signed "— Haenyeo Management" throughout.

### Tone guidelines
- Warm and direct — acknowledges the person, not just the request
- No robotic phrasing ("Your request has been processed", "This is an automated message")
- Short — one or two sentences is enough
- Contractions are fine ("we'll", "you're")

### New templates

**Request Off — Approved:**
> Hi [Name], we got your request and you're all set — [date] is yours. Enjoy the time off!
> [manager note if provided]
> — Haenyeo Management

**Request Off — Denied:**
> Hi [Name], unfortunately we can't approve the time off for [date] this time around. [manager note if provided, otherwise: "Reach out if you'd like to talk through it."]
> — Haenyeo Management

**Shift Swap — Approved:**
> Hi [Name], the swap is confirmed for [date] — the schedule's been updated. Thanks for coordinating!
> [manager note if provided]
> — Haenyeo Management

**Shift Swap — Denied:**
> Hi [Name], we weren't able to approve the swap for [date]. [manager note if provided, otherwise: "Feel free to reach out if you have questions."]
> — Haenyeo Management

**Coverage Request — Approved:**
> Hi [Name], got it — we'll get coverage sorted for [date]. Thanks for the heads up!
> [manager note if provided]
> — Haenyeo Management

**Coverage Request — Denied:**
> Hi [Name], we can't approve the coverage request for [date] right now. [manager note if provided, otherwise: "Please reach out directly if this is urgent."]
> — Haenyeo Management

**Time Off — Approved (full):**
> Hi [Name], your time off for [dates] is approved — you're all set. Enjoy!
> [manager note if provided]
> — Haenyeo Management

**Time Off — Approved (partial):**
> Hi [Name], we were able to approve part of your time off request. Approved dates: [approved dates]. [manager note — required for partial approvals]
> — Haenyeo Management

**Time Off — Denied:**
> Hi [Name], unfortunately we can't approve the time off for [dates] this time. [manager note if provided, otherwise: "Feel free to reach out if you'd like to discuss."]
> — Haenyeo Management

**Welcome (registration confirmation):**
> Hi [Name], you're all set on the Haenyeo scheduling system! From now on, your weekly schedule will come straight to this email.
>
> To send any scheduling requests, email haenyeo.schedule@gmail.com using these subject line formats:
>
> Single day off: [SCHEDULING] – REQUEST OFF – [Your Name] – [Date]
> Consecutive time off: [SCHEDULING] – TIME OFF – [Your Name] – Jul 28 to Aug 4
> Non-consecutive days: [SCHEDULING] – TIME OFF – [Your Name] – Jul 28, Jul 30, Aug 2
> Shift swap: [SCHEDULING] – SHIFT SWAP – [Your Name] – [Date] (mention who you're swapping with in the body)
> Coverage needed: [SCHEDULING] – COVERAGE REQUEST – [Your Name] – [Date]
>
> You'll hear back once your request is reviewed. If your contact info ever changes, scan the "Update My Info" QR code posted at the restaurant.
>
> — Haenyeo Management

---

## 2. Jon and Freddy cross-scheduling

### Jon — Management + Kitchen
Jon appears in the Management tab only (not in the combined BOH+Kitchen tab). However, when Jon is scheduled in Management (FM), the app must check if he is already scheduled in Kitchen on the same day and block it — and vice versa.

- If Jon is set to FM on Monday in Management, the Kitchen schedule should not allow him to be scheduled on Monday (show his cell as blocked/unavailable with a tooltip: "Already scheduled in Management")
- If Jon is already scheduled in Kitchen on a day, Management should block FM for that day with the same warning
- The schedule should never allow Jon on two different sections on the same day

### Freddy — BOH + Kitchen
Freddy appears in both sections of the combined BOH+Kitchen tab. Same conflict prevention applies:
- If Freddy is scheduled in Kitchen on a day, his BOH cell for that day is blocked
- If Freddy is scheduled in BOH on a day, his Kitchen cell for that day is blocked
- Blocked cells show a tooltip: "Already scheduled in [other section]"

---

## 3. Combine BOH and Kitchen into one tab

Replace the separate "Back of House" and "Kitchen" sub-tabs with a single **"BOH & Kitchen"** tab. Layout:

- Kitchen staff shown first (Jenny, Ajuma, Kelvin, Jason, Freddy)
- A thin visual divider/separator between the two groups
- BOH staff shown below (Hector, Freddy, Temo, Oryan)
- Freddy appears in both sections (with cross-scheduling conflict prevention from item 2)
- Same dropdown system as before for both groups
- Management tab stays separate and unchanged

---

## 4. "Today" button on Set Schedule week navigation

Add a **Today** button near the week navigation arrows on the Set Schedule tab.

- When the manager is on the current week: Today button is dimmed/disabled
- When the manager is on any other week: Today button is active — clicking it jumps straight back to the current week
- The date range display stays as display only — not clickable
- Current week date range gets a subtle highlight (accent color background) so it's visually obvious when you're on the current week vs. a past or future week

---

## 5. Current date indicator on Tip Sheet

- When the Tip Sheet is on today's date: show a subtle "Today" label or highlight near the date display
- The date stepper (Prev Day / Next Day) stays as-is — just add the visual indicator
- Only shows on today — absent on past or future dates

---

## 6. Current date indicator on Calendar

- Month view: highlight today's date cell with an accent color dot or filled circle behind the date number
- Week view: highlight today's column header similarly
- Read-only visual indicators only — no behavior change

---

## Order of work
1. Email template rewrites (item 1)
2. Today button on Set Schedule (item 4)
3. Current date indicators on Tip Sheet and Calendar (items 5 and 6)
4. Combine BOH+Kitchen tab (item 3)
5. Jon/Freddy cross-scheduling conflict prevention (item 2)

## Explicitly unchanged
- All tip math, floor check, finalize logic — untouched
- Rail, Gmail integration, staff registration — untouched
- Management tab — untouched
- FOH schedule dropdowns and role picker — untouched
- All existing shift options for BOH and Kitchen — untouched
