// Shift codes: which role a stored code belongs to, and the pre-redesign codes
// still in the database mapped to the new vocabulary. Moved here unchanged
// from App.jsx (glance-staff, 2026-11-25) so lib/glanceStaff.js and its tests
// use the exact same rules as the Tip Sheet, Today at a Glance and the grid.

// which role a stored shift code belongs to (null for OFF/GAP)
export function roleFromCode(code) {
  if (!code) return null;
  if (code.startsWith("SV_")) return "Servers";
  if (code.startsWith("BR_")) return "Busser/Runner";
  if (code.startsWith("HOST")) return "Host";
  if (code.startsWith("EXPO")) return "Expo";
  if (code.startsWith("BAR_")) return "Bar";
  if (code.startsWith("TRAIN")) return "Training";
  return null;
}

// pre-redesign codes still in the DB (or the seed constants) — mapped to the
// new vocabulary using the person's primary role where the old code was generic
export const LEGACY_BY_ROLE = {
  Bar: { OPENER: "BAR_4FC", SWING: "BAR_5CL", CLOSER: "BAR_6CL", FIVE_CLOSE: "BAR_5CL" },
  Host: { OPENER: "HOST_4", SWING: "HOST_4", CLOSER: "HOST_4" },
  Servers: { OPENER: "SV_4FC", SWING: "SV_5SC", CLOSER: "SV_6CL", FIVE_CLOSE: "SV_5CL" },
  "Busser/Runner": { OPENER: "BR_4FC", SWING: "BR_5CL", CLOSER: "BR_6CL" },
};
export const LEGACY_ANY_ROLE = { BUSRUN4: "BR_4FC", BUSRUN6: "BR_6CL", EXPO: "EXPO_5", BAR4: "BAR_4FC", BAR6: "BAR_6CL", HOST: "HOST_4" };
export function normalizeShiftCode(code, primaryRole) {
  if (!code) return "OFF";
  if (LEGACY_ANY_ROLE[code]) return LEGACY_ANY_ROLE[code];
  const roleMap = LEGACY_BY_ROLE[primaryRole];
  if (roleMap && roleMap[code]) return roleMap[code];
  return code;
}
