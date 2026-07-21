// Data-access layer for HaenyeoMNG.
//
// Every function here maps the live Supabase tables (see supabase/migrations/
// 0001_init.sql) into the in-memory shapes the SchedulingHub component already
// works with, so the component's business logic never has to change — only the
// source of its data. weekday is the JS getDay() index (0=Sun..6=Sat).

import { supabase } from "./supabase.js";

/* ------------------------------------------------------------------ staff -- */

// The live DB stores section in mixed casings ('foh' vs 'FOH') — normalize to
// the canonical forms the UI compares against. Unknown/blank values → FOH.
const SECTION_CANON = { foh: "FOH", boh: "BOH", kitchen: "Kitchen", management: "Management" };
function canonSection(section) {
  return SECTION_CANON[String(section || "").trim().toLowerCase()] || "FOH";
}

export async function fetchStaff() {
  // section was added in migration 0002 — fall back to the old shape if the
  // column doesn't exist yet so the app keeps working pre-migration.
  let { data, error } = await supabase
    .from("staff")
    .select("id, name, role, active, section")
    .order("created_at", { ascending: true });
  if (error) {
    ({ data, error } = await supabase
      .from("staff")
      .select("id, name, role, active")
      .order("created_at", { ascending: true }));
    if (error) throw error;
  }
  return (data || []).map((s) => ({ ...s, section: canonSection(s.section) }));
}

export async function insertStaff({ name, role, section }) {
  const { data, error } = await supabase
    .from("staff")
    .insert({ name, role, section })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateStaff(id, fields) {
  const { error } = await supabase.from("staff").update(fields).eq("id", id);
  if (error) throw error;
}

/* ------------------------------------------------------- staff_roles -------- */
// -> [{ staff_id, role, is_primary, sort_order }] — null if the table doesn't
// exist yet (pre-migration), so callers can fall back to built-in defaults.

export async function fetchStaffRoles() {
  const { data, error } = await supabase
    .from("staff_roles")
    .select("staff_id, role, is_primary, sort_order")
    .order("sort_order", { ascending: true });
  if (error) return null;
  return data || [];
}

// Replace a person's full role set (delete + insert keeps it simple).
export async function replaceStaffRoles(staffId, roles) {
  // roles: [{ role, is_primary, sort_order }]
  const { error: delErr } = await supabase.from("staff_roles").delete().eq("staff_id", staffId);
  if (delErr) throw delErr;
  if (roles.length === 0) return;
  const { error } = await supabase
    .from("staff_roles")
    .insert(roles.map((r) => ({ staff_id: staffId, ...r })));
  if (error) throw error;
}

/* -------------------------------------------------- role_shift_options ----- */
// -> { [role]: [{ code, label }] } in sort order — null pre-migration.

export async function fetchRoleShiftOptions() {
  const { data, error } = await supabase
    .from("role_shift_options")
    .select("role, code, label, sort_order")
    .order("sort_order", { ascending: true });
  if (error) return null;
  if (!data || data.length === 0) return null;
  const byRole = {};
  data.forEach((row) => {
    (byRole[row.role] = byRole[row.role] || []).push({ code: row.code, label: row.label });
  });
  return byRole;
}

/* -------------------------------------------------- schedule_patterns ------ */
// -> { [name]: [7 shift_types] }, indexed 0=Sun..6=Sat.
// idById maps staff_id -> name so we can key by name like the prototype.

export async function fetchPatterns(idToName) {
  const { data, error } = await supabase
    .from("schedule_patterns")
    .select("staff_id, weekday, shift_type");
  if (error) throw error;
  const patterns = {};
  (data || []).forEach((row) => {
    const name = idToName[row.staff_id];
    if (!name) return;
    if (!patterns[name]) patterns[name] = ["OFF", "OFF", "OFF", "OFF", "OFF", "OFF", "OFF"];
    patterns[name][row.weekday] = row.shift_type;
  });
  return patterns;
}

export async function upsertPattern(staffId, weekday, shiftType) {
  const { error } = await supabase
    .from("schedule_patterns")
    .upsert({ staff_id: staffId, weekday, shift_type: shiftType }, { onConflict: "staff_id,weekday" });
  if (error) throw error;
}

/* -------------------------------------------- placeholder_schedule --------- */
// -> { [group_key]: [ [7 shift_types] per slot_index ] }

export async function fetchPlaceholders() {
  const { data, error } = await supabase
    .from("placeholder_schedule")
    .select("group_key, slot_index, weekday, shift_type");
  if (error) throw error;
  const groups = {};
  const maxSlot = {};
  (data || []).forEach((row) => {
    maxSlot[row.group_key] = Math.max(maxSlot[row.group_key] ?? -1, row.slot_index);
  });
  Object.entries(maxSlot).forEach(([g, max]) => {
    groups[g] = Array.from({ length: max + 1 }, () => ["OFF", "OFF", "OFF", "OFF", "OFF", "OFF", "OFF"]);
  });
  (data || []).forEach((row) => {
    groups[row.group_key][row.slot_index][row.weekday] = row.shift_type;
  });
  return groups;
}

export async function upsertPlaceholder(groupKey, slotIndex, weekday, shiftType) {
  const { error } = await supabase
    .from("placeholder_schedule")
    .upsert(
      { group_key: groupKey, slot_index: slotIndex, weekday, shift_type: shiftType },
      { onConflict: "group_key,slot_index,weekday" }
    );
  if (error) throw error;
}

/* -------------------------------------------------- schedule_overrides ----- */
// -> { "name|YYYY-MM-DD": { type, swap } }, matching the prototype OVERRIDES.

export async function fetchOverrides(idToName) {
  const { data, error } = await supabase
    .from("schedule_overrides")
    .select("staff_id, date, override_type, is_swap");
  if (error) throw error;
  const overrides = {};
  (data || []).forEach((row) => {
    const name = idToName[row.staff_id];
    if (!name) return;
    overrides[`${name}|${row.date}`] = { type: row.override_type || undefined, swap: !!row.is_swap };
  });
  return overrides;
}

/* -------------------------------------------------------- rail_requests ---- */
// pending  -> [{ id, type, name, dates, notice, note, urgent }]
// resolved -> [{ id, name, type, dates, status, created_at }] (for the log)

export async function fetchRailRequests(idToName) {
  // source/unmatched_name arrived in migration 0003 — select them if present,
  // fall back to the older column set so the app still loads pre-migration.
  let { data, error } = await supabase
    .from("rail_requests")
    .select("id, staff_id, type, dates, notice, note, status, urgent, created_at, source, unmatched_name")
    .order("created_at", { ascending: false });
  if (error) {
    ({ data, error } = await supabase
      .from("rail_requests")
      .select("id, staff_id, type, dates, notice, note, status, urgent, created_at")
      .order("created_at", { ascending: false }));
    if (error) throw error;
  }
  const pending = [];
  const resolved = [];
  (data || []).forEach((row) => {
    // matched entries resolve staff_id -> name; email entries with no staff
    // match fall back to the raw name from the email, flagged as unmatched.
    const name = idToName[row.staff_id] || row.unmatched_name || "Unknown";
    const unmatchedName = !row.staff_id && row.unmatched_name ? row.unmatched_name : null;
    if (row.status === "pending") {
      pending.push({
        id: row.id,
        type: row.type,
        name,
        dates: row.dates,
        notice: row.notice,
        note: row.note,
        urgent: !!row.urgent,
        source: row.source || "manual",
        unmatchedName,
      });
    } else {
      resolved.push({ id: row.id, name, type: row.type, dates: row.dates, status: row.status, created_at: row.created_at });
    }
  });
  // pending should read oldest-first like the prototype's initial list
  pending.reverse();
  return { pending, resolved };
}

export async function updateRailStatus(id, status) {
  const { error } = await supabase.from("rail_requests").update({ status }).eq("id", id);
  if (error) throw error;
}

/* ------------------------------------------------ gmail integration -------- */
// These hit the server-side /api functions (never the Gmail creds directly).
// Under plain `vite dev` the /api routes don't exist, so failures resolve to a
// harmless "unavailable" status rather than throwing.

export async function fetchGmailStatus() {
  try {
    const res = await fetch("/api/gmail/status", { headers: { Accept: "application/json" } });
    if (!res.ok) return { configured: false, connected: false, unavailable: true };
    return await res.json();
  } catch {
    return { configured: false, connected: false, unavailable: true };
  }
}

// Manual "Check now" — authorized by the signed-in manager's Supabase JWT.
export async function triggerGmailPoll(accessToken) {
  const res = await fetch("/api/poll", {
    method: "POST",
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  if (!res.ok) throw new Error(`Poll failed (${res.status})`);
  return await res.json();
}

/* ------------------------------------------------------------ tip_sheets --- */

export async function fetchTipSheet(dateIso) {
  const { data, error } = await supabase
    .from("tip_sheets")
    .select("*")
    .eq("date", dateIso)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// payload keys mirror the tip_sheets columns.
export async function upsertTipSheet(payload) {
  const { data, error } = await supabase
    .from("tip_sheets")
    .upsert(payload, { onConflict: "date" })
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

/* ------------------------------------------------ bulk initial load -------- */

export async function fetchInitial() {
  const staff = await fetchStaff();
  const idToName = {};
  const nameToId = {};
  staff.forEach((s) => {
    idToName[s.id] = s.name;
    nameToId[s.name] = s.id;
  });
  const [patterns, placeholders, overrides, rail, staffRoles, roleOptions] = await Promise.all([
    fetchPatterns(idToName),
    fetchPlaceholders(),
    fetchOverrides(idToName),
    fetchRailRequests(idToName),
    fetchStaffRoles(),
    fetchRoleShiftOptions(),
  ]);
  return { staff, idToName, nameToId, patterns, placeholders, overrides, rail, staffRoles, roleOptions };
}
