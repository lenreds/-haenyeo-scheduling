# HaenyeoMNG — Project Handoff

**What this is:** A single-file React prototype (`scheduling-hub-prototype.jsx`) built as a Claude artifact — Haenyeo's all-in-one restaurant scheduling, tip-out, and time-off management hub. This doc is the "resume where we left off" reference.

**How to resume:** Paste or upload this file (and the main `scheduling-hub-prototype.jsx` if you have it) at the start of a new conversation and say you want to keep building HaenyeoMNG. Claude doesn't auto-recognize the phrase across separate chats — this doc *is* the mechanism, not a magic trigger word.

---

## Current State: Four Tabs, All Live

### 1. Rail (request/approval inbox)
- Pending Decisions, Today at a Glance, Auto-Action Log, and a live 7-day strip with holiday flagging
- Visual style: **"Native" design** — clean, modern, derived directly from the Haenyeo logo (hexagon H mark as the shape language, charcoal/sage/dusty-blue palette, Plus Jakarta Sans). Card backgrounds are light grey (`#F0F0EC`), not white.
- Two archived alternate designs exist as standalone files if you ever want to compare: `rail-option-1-ticket.jsx` (original kitchen-ticket-rail concept) and `rail-option-2-native.jsx` (the one now live).
- Sample data uses real staff names, tied to real override dates (Bernie's day off, Reiko/Mia's swap, Emilio's coverage request).

### 2. Calendar
- Month view zooms into a real weekly grid. **Week runs Monday–Sunday** (fixed from JS's default Sunday-start).
- Read-only display right now — shows what's on the Set Schedule, doesn't let you edit from here.

### 3. Set Schedule — the core of the build
Four sub-tabs (pill toggles at the top), each its own roster:

- **Front of House** — full per-person roster, one row per employee:
  - **Bar:** Bernie, Isabella, Angel, Abraham
  - **Host:** Juliette, Halle
  - **Servers:** Ivy, Mia, Reiko, **David**, **Daniel** (David/Daniel are grouped visually under Servers but functionally still fill Busser/Runner, Expo, or Host slots on the Tip Sheet — see their custom cycles below)
  - **Busser/Runner:** Akira (listed first), Emilio, Miguel, Kevin, Dennis
  - Real schedule data for the week of **Jul 6–12, 2026** was transcribed from an uploaded photo of the actual paper schedule.

- **Back of House** (4 slots) — Hector, Freddy, Temo, Oryan
- **Kitchen** (5 slots) — Jenny (Head Chef), Ajuma, Kelvin, Jason, Freddy (also BOH)
- **Management** (2 slots) — Lenis, Jon

**Shift-type system (click a cell to cycle):**
- Standard roles cycle: Off → Opener (4p–1st cut) → Swing (5p–2nd cut) → Closer (6p–close)
- Busser/Runner also cycles to **Expo**
- **Per-person custom cycles** (overrides the standard cycle entirely):
  - **Akira** — Off / Opener / Swing / Closer / Expo / **Bar 4pm** / **Bar 6pm** (cross-covers bar; correctly credited at Bar's pay rate on the Tip Sheet, not Busser/Runner's)
  - **David** — Off / Bus-Run 4pm / Bus-Run 6pm / Expo / Host
  - **Daniel** — same as David, minus Host
  - **Angel** — standard cycle plus **5p – Close**
  - Both David and Daniel also have a **12p–8p** option (added for Freddy originally, available on Back of House and Kitchen too)
- **Back of House:** Off → Standard (3p–Close) → Morning (9a–5p, Hector's exception) → 12p–8p
- **Kitchen:** Off → Working (3p–Close, shows "Yes" instead of a time for Jenny and Ajuma specifically) → 12p–8p
- **Management:** standard Off/Opener/Swing/Closer cycle (not yet customized — nobody's asked for anything specific here)

**Other Set Schedule features:**
- Week date range shown upper-right (MM/DD-MM/DD/YY) with prev/next arrows
- **Print button** — triggers browser print dialog; print-specific CSS hides nav/buttons for a clean physical copy
- **Lock Schedule button** — toggles a locked state where clicking cells does nothing (prevents accidental edits); applies across all four sub-schedules at once

### 4. Tip Sheet
This is the most complex piece — matches Haenyeo's actual paper tip-out sheet almost exactly.

**Layout:** Two columns. Left column: reserved logo space (real Haenyeo wordmark now embedded) + a full **Cash Reconciliation** panel (denomination counts $100 down to nickels for Opening/Closing bank, Closing Sum, itemized multi-line Payouts, Cash Sales, running subtraction chain down to **Cash Tips Earned**). Right column: everything else.

**The point system (fixed positional slots, not derived from shift type):**
9 fixed rows in this exact order — Server (1pt) / Server (1pt) / Server-Swing (.55) / Busser-Runner (.6) / Busser-Runner (.6) / Expo (.3) / Host (.1, only if covers > 80) / Bartender (.85) / Bartender-Swing (.3). A red reference legend of these values sits on the page, generated from the same data so it can't drift out of sync.

**Custom Schedule toggle** — lets you manually override the name AND point value per slot for short-staffed emergency nights, instead of relying on auto-fill from the Set Schedule.

**The math (confirmed exact):**
1. Floor pool (cash + CC) ÷ total points = $ per point
2. Each person's raw share = their points × $/point
3. Bar's own tips (separate cash+CC) get a flat **10% tip-out**, split evenly among however many Busser/Runners + Expo are present that day
4. Servers: pool their raw shares, divide by total hours worked among them, multiply back out by individual hours
5. Busser/Runners: same hourly-pool method, but their pool also includes their slice of the bar tip-out
6. Bar: same hourly-pool method, pool = their raw shares + bar's own tips − the 10% tip-out
7. Expo and Host are paid **flat** (no hourly pooling) — Expo gets raw share + bar tip-out slice; Host gets raw share only
8. **All dollar amounts truncate to the cent — never round up** (custom `money()` helper, floors instead of rounding)
9. Clock times are typed as free text ("4:00 PM"), round to nearest 15 min with the classic 7/8-minute cutoff, and assume PM if no AM/PM is given

**Floor cross-check:** sums everyone's (Final Tip − Bar Share) and compares to the Floor Pool — green box if it matches (small tolerance for truncation drift), amber if off by more than a dime.

**Print button** here too.

---

## Timesheet Tab
Currently just a placeholder/empty stub — intentional, waiting to be built out. Ideas discussed but not built:
- Manual hour logging tied into the Tip Sheet's existing hours data
- A future **phone-based GPS clock-in** feature was discussed at length — geofencing staff to the restaurant's location, likely paired with a PIN or photo (GPS alone is spoofable and indoor GPS is imprecise). **This needs a real deployed app** (HTTPS, installed as a home-screen PWA) — it will not function inside a Claude.ai artifact preview, since location permissions need a real hosted origin.
- Also discussed: TouchBistro already has a built-in time clock on the POS terminal itself (may already solve the "punch card" problem without building anything new) — worth checking if it's enabled before building more.

---

## Known Limitations (be upfront about these if asked)
- **Nothing is connected to a real backend.** No live Gmail integration, no database — everything resets on refresh, all data is in-memory React state.
- The Gmail-based `[SCHEDULING] – TYPE – Name – Date` subject line convention was designed and documented (see `crew-scheduling-email-and-availability.md` in `notes1`), but the actual inbox isn't wired up yet.
- Publish button on Calendar's week view logs "would notify N staff by email" — it does not actually send anything yet.
- Bar / Busser-Runner / Host recurring rotations for days not covered by the real Jul 6–12 data are still partly assumption-based — worth a review pass against reality.
- Mia's row (Servers) never got real shift-time data — the original paper schedule only showed her 3 days off ("-ro-"), not her working hours.
- The whole thing is still a **Claude Code / Cowork job** away from being the actual tool staff open every shift — that's the natural next milestone whenever ready.

## Files on Hand
- `scheduling-hub-prototype.jsx` — the live, current build (all four tabs)
- `rail-option-1-ticket.jsx`, `rail-option-2-native.jsx` — archived Rail design alternatives
- `notes1/crew-scheduling-email-and-availability.md` — staff-facing memo on the new email system, availability request, and shift commitment expectations
- `notes1/HANDOFF-HaenyeoMNG.md` — this file

## Live Deployment Progress (update as of this session)
- Supabase project created (name: Haenyeo), Project URL and API key obtained
- Database schema run successfully — `staff` table seeded with all 26 real employees across FOH/BOH/Kitchen/Management (a duplicate-insert issue was hit and fixed with a `unique` constraint on `name`)
- Next: hand everything to Claude Code to scaffold the real app, connect Supabase, and deploy to Vercel
