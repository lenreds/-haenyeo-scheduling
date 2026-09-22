# HaenyeoMNG — Update Brief: Rail Layout, Calendar Rework, Tip Sheet Flow & PDF Polish

## 1. Tip Sheet — simplify Finalize / Send
- Remove the Finalize button.
- "Send Tip Sheet" opens the existing confirmation modal. Confirm & Send emails staff AND marks the sheet finalized + locked in the same action.
- Lock / Unlock stays for freezing or reopening a sheet without sending.
- Button order, left to right: Save · Lock · Send Tip Sheet · Save as PDF · Print.
- Remove the old "[SCHEDULING] – TIP SHEET – 07/02" subject preview box next to Send — the subject now lives in the confirmation modal.
- If a sheet was already sent, Send Tip Sheet shows "Sent ✓ [time]" and asks for confirmation before resending.

## 2. Tip Sheet PDF/print polish
- Cash box: add borderless horizontal rule lines across each denomination row, spanning the Opening and Closing columns, so the blank space reads as intentional writing lines (thin #d0d0d0 bottom rule per row, no vertical borders, no boxes).
- Hide the "+ Add" payouts button in print and PDF.
- Keep one landscape page filling the page as it does now.

## 3. Rail — rearrange layout
Three columns:
- **Left:** Today at a Glance
- **Center:** Notes (general notes)
- **Right:** Pending Decisions, with Auto-Action Log directly underneath

Top strip changes:
- The row where "Gmail connected" currently sits becomes a **Date Note quick-add**: a date picker + note text field + Add button. Adding a note here saves it to that date on the Calendar.
- Gmail status moves to the top-right corner (where the "0 PENDING" badge is now). Compact form: a green dot + "Gmail", with "last checked 2:37 AM" underneath in smaller text. If the connection has a problem: red dot + "Gmail", no last-checked line. Keep the Check now action as a small icon or on click of the status.
- Pending count moves into the Pending Decisions header.

## 4. Calendar — open to current month
The month view always opens on January. It must open on the current month with today highlighted.

## 5. Calendar — date notes page + week schedule
Clicking an individual date opens a **date notes page** for that date (replaces the current popup):
- Shows all notes for that date — add, edit, delete.
- Also shows that date's Rail activity (time off, swaps, holidays) as today's popup does.
- An icon at the top opens the **week schedule** for that date's week.
- On the week schedule page, an icon at the top returns to the date notes page.

Date notes are the same data as the Rail quick-add (item 3) and use the existing calendar_notes table — adding, editing, or deleting from either place updates both.

## 6. Calendar — only show real schedules
In the calendar week schedule view, only show schedules that are either:
- a past week, or
- a week that has been finalized in Set Schedule.
Any other week shows a blank state: "Schedule not finalized yet."
Set Schedule itself is unchanged — you still build any week there.

## Order of work
1. Calendar opens to current month (item 4)
2. Tip Sheet button simplification (item 1)
3. Tip Sheet PDF polish (item 2)
4. Rail layout + quick-add + Gmail status (item 3)
5. Calendar date notes page + week schedule (item 5)
6. Only-real-schedules rule (item 6)

## Explicitly unchanged
- All tip math, slot ordering, floor check
- Autosave, persistent clears, general notes data
- Set Schedule editing, Publish flow, email parsing
