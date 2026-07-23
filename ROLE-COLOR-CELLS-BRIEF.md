# HaenyeoMNG — Update Brief: Role-Color Shift Cells

**Context:** The app is live (Vercel + Supabase). This brief adds one visual rule consistently across the live schedule grid, PDF export, and schedule email. Read HANDOFF-HaenyeoMNG.md for full project context first.

---

## The rule

Every shift cell takes the color of the role the person is actually working that day — not the color of the section they appear in.

### Role color mapping
- Bar → warm orange (#c8956c)
- Servers → green (#5a8a6a)
- Busser/Runner → blue (#4a7a9b)
- Host → purple (#8a5a9b)
- Expo → orange (#c8956c)
- Kitchen → warm orange (#c8956c)
- BOH → blue (#4a7a9b)
- FM (Management) → neutral grey (#888)
- Off / em-dash → always dimmed grey (#ccc), italic — no role color

### Examples
- Akira in Busser/Runner section, working Server → cell is green
- Akira in Busser/Runner section, working Bar → cell is orange
- Akira in Busser/Runner section, normal Busser/Runner shift → cell is blue
- David working Expo → cell is orange
- Freddy in Kitchen section, working BOH → cell is blue
- Freddy in BOH section, working Kitchen → cell is orange

### How to determine role color
The role is stored in the shift code prefix (BAR_5CL, SV_4FC, BUSRUN_6CL, EXPO_5, HOST_4, etc.). Map the prefix to the role color above.

---

## Where this applies

### 1. Live schedule grid (Set Schedule tab)
- FOH: shift cells take the role color of the shift being worked
- BOH+Kitchen combined tab: same rule — Freddy's Kitchen cells orange, BOH cells blue
- Management tab: FM cells grey, Off dimmed — unchanged

### 2. PDF export
- Same role-color logic in the rendered PDF
- Off days stay italic grey em-dash — no color
- Section header rows (● BAR, ● SERVERS, etc.) keep their section color — only the cells change

### 3. Schedule email
- Same role-color logic in the HTML email table cells
- Inline styles only — no external CSS
- Off cells remain dimmed grey

---

## What does NOT change
- Section header colors — group label rows keep their section color
- Today column highlight — still warm orange tint, role colors apply within it
- Manager pill badges — still dark charcoal
- Tip Sheet, Rail, Calendar — completely untouched
- All schedule logic, shift values, publish flow — visual only

---

## Order of work
1. Define a role-color helper function (maps shift code prefix → hex color) — use in all three places
2. Apply to live schedule grid (FOH + BOH+Kitchen)
3. Apply to PDF export renderer
4. Apply to schedule email HTML builder
