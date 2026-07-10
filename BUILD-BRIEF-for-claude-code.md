# HaenyeoMNG — Build Brief for Claude Code / Cowork

**Goal:** Take the working prototype (`scheduling-hub-prototype.jsx`) and turn it into a real, deployed web app by end of week.

**Stack:**
- Hosting: Vercel
- Database + Auth: Supabase (Postgres)
- No public sign-up — 2–3 manager accounts created manually, email/password login

## What to build, in order

1. **Scaffold a real app** (Next.js or Vite + React) and port the existing `SchedulingHub` component in as-is first — get it running and deployed before changing anything, to have a known-good baseline.

2. **Add Supabase.** Create tables for:
   - `staff` (name, role, active)
   - `schedule_patterns` (person, weekday, shift_type) — replaces the hardcoded `PERSON_PATTERNS` object
   - `placeholder_schedules` (group, slot_index, weekday, shift_type) — Back of House / Kitchen / Management
   - `rail_requests` (name, type, dates, notice, note, status, urgent, created_at) — replaces `initialPending`/`initialLog`
   - `tip_sheets` (date, floor_cash, floor_credit, bar_cash, bar_credit, covers, denominations JSON, payouts JSON, cash_sales, closing_sum, slot_overrides JSON, time_entries JSON)
   - `overrides` (person, date, override_type, swap boolean) — one-off Rail-approved exceptions

3. **Wire up auth.** Supabase Auth, email/password, no self-signup — manually create logins for the owner + managers in the Supabase dashboard.

4. **Replace all `useState` data sources with real reads/writes** to the tables above. The business logic (tip math, shift cycling, point calculations, `money()` truncation, the whole Set Schedule cycle system) should not need to change — only where the data comes from.

5. **Deploy to Vercel**, connect a domain if one exists yet.

6. **Do NOT build this week:** Gmail integration (still manual), GPS clock-in, Timesheet functionality beyond the current placeholder. These are explicitly phase 2.

## Non-negotiables to preserve exactly
- The tip-out math (see the `HANDOFF-HaenyeoMNG.md` doc for the full formula) — this affects real paychecks, don't "simplify" or "optimize" any of the rounding/truncation logic.
- The Monday–Sunday week order (not JS's default Sunday-first).
- The per-person custom shift cycles (Akira, David, Daniel, Angel) — these are real staffing exceptions, not arbitrary code.

## Reference
Full context on every feature, business rule, and design decision: see `HANDOFF-HaenyeoMNG.md` in the `notes1` folder.
