# HaenyeoMNG — Phase 2 Roadmap

Security and compliance items identified but **deliberately not built yet**. Recorded
here so they aren't lost. Nothing in this file is implemented.

---

## 1. Two-factor authentication on manager logins

**Why:** A manager account can read every staff member's personal email and phone
number, approve time off, and send email as the restaurant. Today a leaked or reused
password is the only thing standing in the way.

**Approach:** Supabase Auth supports TOTP MFA natively (`supabase.auth.mfa.*`) — enroll,
challenge, and verify. No third-party service needed.

**Notes:**
- Managers are few and known, so enrollment can be mandatory rather than opt-in.
- Needs a recovery path decided up front (backup codes, or an owner who can reset
  enrollment) — otherwise a lost phone locks someone out of the schedule.
- Affects `src/App.jsx` sign-in only; the `/api` routes already verify the Supabase JWT
  and inherit MFA state without changes.

## 2. Rate limiting on `/api/poll`

**Why:** `/api/poll` is authenticated but expensive — each call fans out into Gmail list,
per-message fetch, label, and modify requests. A manager JWT that leaked, or a stuck
client retry loop, could burn the Gmail API quota or the Vercel function budget.

**Approach:** A short per-caller cooldown (the `gmail_poll_log` table already records
poll times, so the last-poll timestamp is available without new infrastructure). Reject
or no-op a manual poll that arrives within N seconds of the previous one; leave the
Vercel Cron path exempt.

**Notes:**
- The daily cron only fires once, so this is really about the "Check now" button.
- Worth pairing with a visible "checked N seconds ago" hint so a rejected poll doesn't
  look like a failure.

## 3. Privacy policy page

**Why:** The app stores staff personal email addresses and phone numbers. Any published
policy should say what is collected, why, who can see it, and how someone gets their
data removed. This also matters for Google OAuth verification, which asks for a privacy
policy URL for apps handling user data.

**Approach:** A static route in the Vite app (no auth required) plus a link in the
registration/welcome email footer.

**Should cover:**
- What is stored: name, personal email, phone, schedule and time-off history.
- Why: sending schedules and processing scheduling requests.
- Who sees it: management only. Staff never sign in and cannot see each other's data.
- Retention and deletion: how a departing employee's record is removed (the Staff tab
  delete already cascades to roles, patterns, overrides, and rail requests).
- That scheduling email is processed automatically by the Gmail integration.

## 4. Unlocking a sent Tip Sheet throws away its frozen roster

**Why:** `roster_snapshot` (migration 0023) exists so a sheet that was emailed can never
be rewritten by a later schedule change. But Unlock (`toggleTipLock` in `src/App.jsx`)
writes `roster_snapshot: null`, so the unlocked sheet rebuilds its names from whatever
the schedule says *now*. Clock times are stored per **slot** (`time_entries`:
`{ bar1: { in, out } }`), not per person, so the times stay where they were while the
names under them can move. Unlocking any sent sheet can silently reattach one person's
hours to another person's name.

**Seen:** 2026-10-10, testing the tap panels in dev against a stand-in sent sheet for
8 Oct with Bernie on `bar1`: after Unlock the bar slot came back as Isabella (the dev
schedule differs), holding Bernie's TIME IN.

**The trap:** if the names come back wrong and the sheet is re-locked to undo it, Lock
pins whatever is on screen (`pinnedRosterNow()`), so the wrong roster becomes the frozen
one and the correct snapshot is gone. There is no undo.

**Fix wanted (owner, 2026-10-10):** the freeze survives the unlock when the sheet was
sent — what's being protected is that it was emailed, not that it was locked.
- Unlock on a sheet that was never sent: clears the snapshot and rebuilds freely, as today.
- Unlock on a sent sheet: keeps `roster_snapshot`; names and points stay pinned while
  times and cash are corrected; re-lock / re-send keep the same snapshot.
- Decide how a genuine roster correction on a sent sheet is made, if ever (an explicit,
  logged "re-pin from schedule" action rather than a side effect of Unlock).
- Consider storing times against the person as well as the slot, so a moved name can't
  carry someone else's hours.

**Same root cause as item 9 — scope them as one job.** Here, clock times are stored
against a Tip Sheet **slot** (`bar1`) and the person in it is re-derived from the
schedule. In item 9, BOH & Kitchen shifts are stored against a roster **slot** and the
person in it is known only by a name string. Both store data against a position and
work out who holds it after the fact. The fix is the same shape in both: record the
staff id on the slot when the data is written, and read the person from that id.
Whoever scopes either one should read both.

**Until then:** don't unlock a sent sheet to correct it. A single-field fix is a
targeted SQL update to that sheet's `time_entries` that leaves `roster_snapshot`,
`sent`, `locked` and `finalized` untouched.

## 5. A sent / locked Tip Sheet is only protected by CSS

**Why:** Sent sheets are the payroll record. What makes a sent or locked sheet read-only
today is the `.tip-locked` style (`pointer-events: none` on its inputs) in `src/App.jsx`.
Nothing in the data layer refuses a write: autosave still sends the whole row for a
frozen date, `upsertTipSheet` (`src/lib/data.js`) writes whatever it's given, and the
`tip_sheets` RLS policy (`using (true) with check (true)` for `authenticated`, migration
0001) lets **any signed-in user** write any row. There is no manager role: today the only
login is the owner's, which is why it hasn't bitten, but two or three more logins are
coming. When this is picked up, adding a role and checking it in RLS is the whole job,
not a detail of it — the same policy covers every table in 0001. Anything that
gets past the style (devtools, a future code path, a bug in the remap effect) changes a
sheet that was already emailed, and its reopened numbers with it.

**Found:** 2026-10-09, while scoping the Tip Sheet iPad input round. Noted, not fixed —
to be scoped on its own. The new time / cash pickers check `tipFrozen` in code and refuse
to open on a frozen sheet; that covers the new input path only.

**Approach to scope:**
- Roles first: a manager / staff distinction stored server-side (not in the client),
  and RLS policies that check it. Without that, "who may unlock" means "anyone signed in".
- Client: skip autosave and every `upsertTipSheet` for a frozen date except the
  Lock / Unlock / Send writes themselves.
- Database: a trigger (or RLS `with check`) that rejects updates to a row whose stored
  `sent` or `locked` is true unless the same update sets `locked = false` (Unlock) —
  so the rule holds no matter what client writes.
- Decide whether Unlock on a *sent* sheet should keep the emailed figures somewhere
  (a copy of the row at send time) before it becomes editable again.

## 6. Publish attempts leave no record anywhere

**Why:** There is no record that a publish was ever attempted. The Auto-Action Log is
in-memory only, rebuilt from Rail requests on every load (`setLog` in the initial load,
`src/App.jsx`), so a publish entry, success or failure, is gone on reload. A failure only
ever appears in the Publish dialog's red box; close the dialog or lose the page and it
is gone. A failed publish mark (`setWeekPublished`) goes only to the browser console
while the screen shows the week as sent. And Vercel's free-plan function logs roll off
within hours. So a publish that half-fails looks the same on screen as one that worked,
and afterwards the evening has to be pieced together from the Sent folder.

**Found:** 2026-10-20, investigating why the FOH schedule email never arrives (BOH &
Kitchen sent 19 Oct 9:27pm, still showing pending the next morning).

**Fix wanted (owner, 2026-10-20), once the FOH cause is known:** write each publish
attempt to the database. A small append-only table, one row per section per attempt:
- week(s), section (FOH / BOHKITCHEN), real or test, timestamp;
- result: sent count, recipients attempted, or failed;
- the error text when there is one (server error, HTTP status such as 413/504, a
  failed publish mark);
- append-only: insert only, no update or delete policy for the client.
Open a row, not the Sent folder.

## 7. Migration 0016 silently clears publish state and says it's safe to re-run

**Why:** `0016_fresh_start_clear_test_history.sql` sets `published = false,
published_at = null` on every `schedule_weeks` row and says "safe to run more than once".
That was right on 2026-09-22 (clearing test sends before real use). Any later run quietly
marks every genuinely-emailed week as never sent, so the Publish dialog offers them
again, ticked, and a Confirm would re-email staff for weeks they already have (or have
already worked). It leaves no trace except `updated_at`.

**Found:** 2026-10-20 — the most likely reason Sep 21 / Sep 28 / Oct 5 still show as
pending (to confirm with `supabase/queries/publish_state_audit.sql`).

**Fix wanted:** make 0016 refuse to run a second time. For example, have it check for a
marker (a row it writes on first run) and `raise exception` if it is already there, or
retire it out of `supabase/migrations/` into an archive folder with a do-not-run header.
Rule for the future: a migration that resets sent / published state is never
"safe to re-run".

## 8. Schedule PDFs are photographs of a web page, not text

**Applies if:** the FOH publish failure turns out to be size (the 1-week vs 5-week test
sends, 2026-10-20, with BOH & Kitchen at 5 weeks as the control). If it isn't size, this
stays a note.

**Why:** `renderSheetNodeToPdf` (`src/App.jsx`) captures the sheet with html2canvas at
scale 2 and embeds that PNG in the PDF. Every schedule PDF is a picture, so its size
grows with the sheet's height (FOH has far more rows than BOH & Kitchen), and the
base64 upload to `/api/send-schedule` adds about a third on top, against Vercel's 4.5 MB
request limit. Lossless compression already shipped (7661222, 2026-09-24).

**The real answer (owner, 2026-10-20):** more compression is not the fix. Draw the PDF
as text and vector shapes (real text, lines and fills), so a week costs kilobytes
instead of megabytes, the text is selectable and searchable, and it prints sharp at
any size. Constraint: the PDF still comes from the same layout as the print. Print and
PDF must not drift into two designs, so the work is one sheet description that both
render from, not a second hand-built PDF layout.

## 9. Personal shift lines for BOH & Kitchen

**Where it stands:** the Front of House schedule email carries each person's own
shifts in plain text under the first line ("Your week: Mon 4pm-FC, Wed 5pm-CL."),
and the sender's copy carries "Personal lines: N of M matched." (built 2026-10-25,
`api/_lib/personal-lines.js`). BOH & Kitchen was left on the plain version on purpose:
eight people on near-fixed patterns get little from it, and it's the side where a
match can't be made for certain today.

**The rule (owner, 2026-10-25), carried over unchanged:** a wrong line is worse than no
line. Anyone who can't be matched for certain gets the plain version and the PDF. No
fuzzy matching, no stripping name suffixes to force a match.

**Why BOH & Kitchen isn't safe yet:**
- **No staff id on the rows.** FOH rows come from the staff list (`fohRoster` in
  `src/App.jsx`), so each carries the staff record's id. BOH & Kitchen rows come from
  `groupRosters` (`buildGroupRows`): a list of **names** per group, with shifts stored
  by slot index in the placeholder grid (`placeholder_schedule` /
  `weekly_placeholder_schedules`). The only link from a slot to a staff record (and so
  to an email address) is the name string.
- **Names may not match the staff table.** Migration 0002 warns the live BOH / Kitchen
  rows may carry decorations ("Jenny — Head Chef" rather than "Jenny") and has to be
  renamed before its name joins work. Any name difference = no match, which under the
  rule is correct but silent until the count shows it.
- **People on two rosters.** Freddy is on Kitchen *and* BOH, so he has two rows in the
  same email. His line must merge both rows per day, and a day worked in both must
  show both. Jon is on Kitchen (slot 5, migration 0006) *and* Management. His Kitchen
  days are in the BOH & Kitchen payload, his FM days are not.
- **Managers' days come from somewhere else.** A manager's shifts are the Management
  sub-tab / the Manager On row (`buildManagerOn`), not a grid row. So a manager's line,
  in either email, needs its own source.
- **Display labels are a UI rule.** For Jenny and Ajuma, KITCHEN shows as "Yes"
  (`placeholderShiftLabel`). A line built from the payload shows "Yes", the same as
  the sheet. It should probably say the real hours instead; decide before building.

**Approach when picked up:** give each roster slot a staff id at the source (the slot
→ staff record link stored, not derived from the name), put that id on each BOH /
Kitchen row as FOH does, then reuse `personalLinesFor` with one change: merge the rows
that share an id (Freddy) instead of refusing them. Managers stay plain until the
Manager On row carries ids too. The sender's count covers it automatically.

**Same root cause as item 4 — scope them as one job.** Item 4 is the Tip Sheet storing
clock times against a slot (`bar1`) and re-deriving the person from the schedule, so
an unlock can move one person's hours onto another's name. This item is BOH & Kitchen
shifts stored against a roster slot with the person known only by name. Both store
data against a position and work out who holds it afterwards. The fix in both is a
staff id recorded on the slot. Whoever scopes either one should read both.

---

## Related hardening already in place (not Phase 2 work)

- `SUPABASE_SERVICE_ROLE_KEY` is server-only and never `VITE_`-prefixed, so it cannot
  reach the browser bundle.
- RLS is authenticated-only on every manager-facing table.
- `/api/poll` no longer logs staff email addresses (commit 4f46bb8).
- Untagged inbox mail that doesn't match a registered sender is left unread and
  unlabeled rather than being touched.
