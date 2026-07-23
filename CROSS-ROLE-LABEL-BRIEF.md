# HaenyeoMNG — Update Brief: Cross-Role Shift Labels

**Context:** The app is live (Vercel + Supabase). This brief adds a small role label below the shift text whenever someone is working outside their primary role. Read HANDOFF-HaenyeoMNG.md for full project context first.

---

## The rule

When a staff member is working a shift in a role different from their primary role, the cell shows two lines:
- Line 1: the shift label (e.g. "6pm-CL") in the role's color — same as current behavior
- Line 2: the role name in a smaller, slightly muted version of the same color (e.g. "Server", "Bar", "Expo")

When a staff member is working their primary role, no label is shown — just the shift on one line as before.

### Primary roles per person
- Bernie, Isabella, Abraham, Angel → Bar (primary)
- Juliette, Halle → Host (primary)
- Ivy, Mia, Reiko → Servers (primary)
- David, Daniel → Servers (primary)
- Akira, Emilio, Miguel, Kevin, Dennis → Busser/Runner (primary)
- Freddy → BOH (primary)
- Jon → Kitchen (primary) — since he appears in the Kitchen section

### When the label appears
- Akira working Server → shows "Server" label
- Akira working Bar → shows "Bar" label
- Akira working Expo → shows "Expo" label
- Akira working Busser/Runner → no label (primary role)
- David working Busser/Runner → shows "Busser/Runner" label
- David working Expo → shows "Expo" label
- David working Servers → no label (primary role)
- Freddy in Kitchen section → shows "Kitchen" label (his primary is BOH)
- Freddy in BOH section → no label (primary role)
- Jon in Kitchen section → no label (primary role is Kitchen)
- Single-role staff (Emilio, Ivy, Juliette, etc.) → never show a label

### Label style
- Font size: ~9px (significantly smaller than the shift text)
- Color: same hue as the role color but slightly muted (85% opacity or a slightly lighter shade)
- No background pill or border — just plain small text, clean and minimal
- Line height tight between shift and label

---

## Where this applies

### 1. Live schedule grid (FOH dropdowns + BOH+Kitchen tab)
- Cross-role cells show the two-line layout
- The role picker dropdown itself is unchanged — this is display only

### 2. PDF export
- Same two-line layout in the rendered PDF cells
- On black and white print: the role label still appears (it's text, not color-dependent) so it works even without color

### 3. Schedule email
- Same two-line layout using table-based inline HTML
- Role label in a smaller font, same color as the shift text

---

## What does NOT change
- Single-role staff rows — no label ever
- Off/em-dash cells — no label
- Section header rows — unchanged
- Manager pills, today highlight, legend — unchanged
- All schedule logic, tip math, Rail, Gmail — untouched
- The role color system from the previous round — unchanged, this just adds the text label on top

---

## Order of work
1. Define a helper: isPrimaryRole(personName, roleWorked) → boolean
2. Apply two-line layout to live schedule grid cells
3. Apply to PDF renderer
4. Apply to email HTML builder
