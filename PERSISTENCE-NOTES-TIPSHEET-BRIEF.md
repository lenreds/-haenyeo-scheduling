# HaenyeoMNG — Update Brief: Persistent Clears, Notes Box, Save Buttons, Tip Sheet PDF & Send Confirmation

## 1. Rail clears must persist across refresh
Currently "Clear" on the auto-action log and "Clear resolved" on the Rail are display-only, so everything comes back on refresh. Make them persistent:
- Store a per-user "cleared_at" timestamp (e.g. a small `rail_view_state` table or a column keyed by user id) for each list: auto-action log, resolved list.
- On load, only show entries created after the saved cleared_at.
- Nothing is deleted from the database — history stays intact, it's just hidden from view.
- Pending decisions are NOT affected by Clear — pending items only leave the queue via approve / deny / archive / delete (already built).

## 2. Rail notes box — bigger, simpler, general notes
- Increase the size of the Notes box in the Rail's right column so notes are readable at a glance without expanding.
- Remove dates from the notes display — these are general notes, not dated entries.
- Manager can add, edit inline, and delete notes directly in the box.
- Notes persist in the database (general notes table, not tied to a week or date).
- Keep the note count in the header ("Notes (4)").

## 3. Save buttons on Tip Sheet and Set Schedule
- Add a **Save** button to the Tip Sheet and to Set Schedule.
- Save writes the current state to Supabase immediately.
- Also autosave in the background (debounced ~2 seconds after the last edit) so a refresh never loses work.
- Show a small status indicator next to the button: "Saved" / "Saving…" / "Unsaved changes".
- Warn before leaving the page (beforeunload) if there are unsaved changes.

## 4. Tip Sheet PDF — fill the page
The saved PDF leaves a large empty band at the bottom of the landscape page. Scale the capture to fill the page:
- Compute the scale from both page width AND page height, and use whichever fills the page best while keeping aspect ratio.
- Target ≥90% of the usable page height; center horizontally if width has slack.
- Increase row height / font size in `.tip-pdf-mode` if needed so the content itself is taller.
- Must stay one landscape page. Verify with the actual exported file.

## 5. Tip Sheet send — confirmation screen before sending
Clicking "Send Tip Sheet" opens a confirmation modal instead of sending immediately. The modal shows:
- **Recipients:** every staff member who worked that night, each with their email address. Checkbox per person (default checked) so individuals can be excluded. Staff with no email on file listed as "no email — will be skipped".
- **Subject line:** editable text field, pre-filled with the default subject.
- **Message body notes:** editable textarea for optional notes that get added above the tip breakdown in the email.
- **Confirm & Send** and **Cancel** buttons.
Only after Confirm & Send does the email go out.

## Order of work
1. Tip Sheet send confirmation (item 5)
2. Save buttons + autosave (item 3)
3. Persistent Rail clears (item 1)
4. Rail notes box (item 2)
5. Tip Sheet PDF fill (item 4)

Include any needed migration as a new numbered file and tell me to run it.

## Explicitly unchanged
- All tip math, slot ordering, floor check
- Rail approve/deny/archive/delete flow
- Finalize, Lock, Publish behavior

## Change to item 1
Make the Rail clears **global, not per user**. Store one shared cleared_at timestamp for the auto-action log and one for the resolved list — when any manager clears a list, it's cleared for everyone. Still hide-only, nothing deleted from the database.
