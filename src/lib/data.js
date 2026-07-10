// Data-access layer for HaenyeoMNG.
//
// Every function here maps the live Supabase tables (see supabase/migrations/
// 0001_init.sql) into the in-memory shapes the SchedulingHub component already
// works with, so the component's business logic never has to change — only the
// source of its data. weekday is the JS getDay() index (0=Sun..6=Sat).

import { supabase } from "./supabase.js";

/* ------------------------------------------------------------------ staff -- */

export async function fetchStaff() {
  const { data, error } = await supabase
    .from("staff")
    .select("id, name, role, active")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
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
  const { data, error } = await supabase
    .from("rail_requests")
    .select("id, staff_id, type, dates, notice, note, status, urgent, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const pending = [];
  const resolved = [];
  (data || []).forEach((row) => {
    const name = idToName[row.staff_id] || "Unknown";
    if (row.status === "pending") {
      pending.push({
        id: row.id,
        type: row.type,
        name,
        dates: row.dates,
        notice: row.notice,
        note: row.note,
        urgent: !!row.urgent,
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
  const [patterns, placeholders, overrides, rail] = await Promise.all([
    fetchPatterns(idToName),
    fetchPlaceholders(),
    fetchOverrides(idToName),
    fetchRailRequests(idToName),
  ]);
  return { staff, idToName, nameToId, patterns, placeholders, overrides, rail };
}
