# Haenyeo Scheduling Hub

Manager-facing scheduling, tip-out, and time-off hub for Haenyeo. Built with
Vite + React on Supabase (Postgres + Auth), deployed on Vercel.

## Features

- **Rail** — request/approval inbox: pending decisions, auto-action log, 7-day strip
- **Calendar** — month view with weekly grid (weeks run Monday–Sunday)
- **Set Schedule** — FOH per-person weekly grids plus BOH / Kitchen / Management
  slot grids, with click-to-cycle shift types, per-person custom cycles,
  print styles, and a schedule lock
- **Tip Sheet** — full cash reconciliation and the point-based tip-out system
  (all dollar amounts truncate to the cent — never round)

## Development

```bash
npm install
npm run dev     # http://localhost:5173
```

Requires a `.env.local` with:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Sign-in is email/password only; manager accounts are created by hand in the
Supabase dashboard (Authentication → Users). No self-signup.

## Database

Schema, seed data, and the RLS policy setup live in [`supabase/`](supabase/) —
see `migrations/0001_init.sql`, `seed.sql`, and `fix_rls_policies.sql`.

## Docs

- [BUILD-BRIEF-for-claude-code.md](BUILD-BRIEF-for-claude-code.md) — build plan and non-negotiables
- [HANDOFF-HaenyeoMNG.md](HANDOFF-HaenyeoMNG.md) — full feature and business-rule reference
- [DEPLOY.md](DEPLOY.md) — Vercel deployment guide
