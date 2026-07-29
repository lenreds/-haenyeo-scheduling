# HaenyeoMNG — Update Brief: Independent Weekly Schedules, Notes Panel & Finalize/Publish Fixes

**Context:** The app is live (Vercel + Supabase). This brief fixes the core scheduling architecture so each week is independent, adds a notes panel per week, and fixes the Finalize/Publish workflow. Read HANDOFF-HaenyeoMNG.md for full project context first.

---

## 1. Independent weekly schedules

### The problem
The schedule is built from schedule_patterns — a recurring weekly template. Every week shows the same shifts, and changing one week changes all weeks.

### The fix
Each week needs its own stored schedule, completely independent from other weeks.

### How it should work
- When you navigate to a week in Set Schedule, check if a weekly_schedule record exists for that week
- If one exists: load it — show exactly what was saved for that specific week
- If none exists: pre-populate from schedule_patterns as a starting point, but save it as that week's own independent record the moment any edit is made
- Changes to week 2 never affect week 1 or week 3
- schedule_patterns still exists as the default template — just a starting point

### Database changes
New table weekly_schedules:

```sql
create table weekly_schedules (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  staff_id uuid references staff(id) on delete cascade,
  weekday int not null check (weekday between 0 and 6),
  shift_type text not null default 'OFF',
  role text,
  unique (week_start, staff_id, weekday)
);
```

New table weekly_placeholder_schedules:

```sql
create table weekly_placeholder_schedules (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  group_key text not null,
  slot_index int not null,
  slot_name text not null,
  weekday int not null,
  shift_type text not null default 'OFF',
  unique (week_start, group_key, slot_index, weekday)
);
```

Migration: create both tables with RLS policies (authenticated read/write). On first load of any week: if no weekly_schedules rows exist for that week_start, seed from schedule_patterns.

---

## 2. Notes panel per week

### Button
- Sits next to Finalize button on Set Schedule tab
- Label: Notes (N) where N is the count of notes for that week — e.g. "Notes (3)"
- Opens a small modal for that specific week

### Panel
- All notes for that week, newest first
- Each note shows: text, staff name if applicable, date added, delete button, edit button
- Text input at top to add a new note manually
- Edit inline on existing notes

### Auto-populated from Rail
When a Rail request is approved and affects a specific week, automatically add a note:
Format: "[Staff name] — [Request type] — [Date(s)] — Approved"
Example: "Bernie — Request Off — Aug 3 — Approved"
Auto-notes can be edited or deleted like manual notes.

### Database
New table schedule_notes:

```sql
create table schedule_notes (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  staff_id uuid references staff(id) on delete set null,
  note text not null,
  source text default 'manual',
  rail_request_id uuid references rail_requests(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

---

## 3. Finalize and Publish fixes

### Correct behavior
Finalize (per week):
- Marks that specific week as finalized in schedule_weeks table
- Button turns green "✓ Finalized" when active
- Pressing again un-finalizes
- Does NOT send emails — just marks week as ready
- Subtle visual indicator on the week date display when finalized

Publish (Set Schedule only):
- Only appears on Set Schedule tab — NOT on Calendar tab
- Only active when at least the current week is finalized
- Sends schedule emails for ALL currently finalized weeks
- After publishing: marks those weeks as published in schedule_weeks

### Fix
1. Remove Publish button from Calendar tab entirely
2. Verify Finalize correctly reads/writes to schedule_weeks per week_start
3. Verify Publish only appears and activates correctly on Set Schedule

---

## 4. Phase 2 security items (document only — don't build now)

Create PHASE2-ROADMAP.md in the project with these items for future reference:
- Two-factor authentication on manager logins (Supabase supports this)
- Rate limiting on /api/poll endpoint
- Privacy policy page (required since staff personal data is stored)

---

## Order of work
1. Database migrations (weekly_schedules, weekly_placeholder_schedules, schedule_notes)
2. Independent weekly schedule logic
3. Finalize/Publish fixes — remove Calendar Publish button, verify Finalize works correctly
4. Notes panel — button, modal, manual add/edit/delete, auto-populate from Rail approvals

## Explicitly unchanged
- schedule_patterns table — still exists as default template
- All tip math, Rail, Gmail, email parsing — untouched
- Role colors, cross-role labels, print/PDF outputs — untouched
- Multi-week publish email logic — untouched
