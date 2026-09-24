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
  // Columns arrived across migrations (section=0002; personal_email/phone/
  // registered=0005) — degrade the select gracefully if any are missing.
  let { data, error } = await supabase
    .from("staff")
    .select("id, name, role, active, section, personal_email, phone, registered")
    .order("created_at", { ascending: true });
  if (error) {
    ({ data, error } = await supabase
      .from("staff")
      .select("id, name, role, active, section")
      .order("created_at", { ascending: true }));
  }
  if (error) {
    ({ data, error } = await supabase
      .from("staff")
      .select("id, name, role, active")
      .order("created_at", { ascending: true }));
    if (error) throw error;
  }
  return (data || []).map((s) => ({
    ...s,
    section: canonSection(s.section),
    registered: !!s.registered,
    personal_email: s.personal_email ?? null,
    phone: s.phone ?? null,
  }));
}

/* -------------------------------------------------- staff_info_updates ----- */

export async function fetchInfoUpdates() {
  const { data, error } = await supabase
    .from("staff_info_updates")
    .select("id, staff_id, new_email, new_phone, status, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) return []; // table may not exist pre-0005
  return data || [];
}

// Approve: write the new contact info onto staff, mark the update approved.
export async function approveInfoUpdate(update) {
  const patch = {};
  if (update.new_email) patch.personal_email = update.new_email;
  if (update.new_phone) patch.phone = update.new_phone;
  if (Object.keys(patch).length) {
    const { error } = await supabase.from("staff").update(patch).eq("id", update.staff_id);
    if (error) throw error;
  }
  const { error } = await supabase.from("staff_info_updates").update({ status: "approved" }).eq("id", update.id);
  if (error) throw error;
}

export async function denyInfoUpdate(id) {
  const { error } = await supabase.from("staff_info_updates").update({ status: "denied" }).eq("id", id);
  if (error) throw error;
}

/* ------------------------------------------------ schedule / tip sends ----- */

// payload: { weeks: [weekPayload,…], sections, attachments: [{filename,b64}] }.
// Multiple weeks stack in one email with one PDF attached per week.
export async function triggerSchedulePublish(payload, accessToken) {
  try {
    const res = await fetch("/api/send-schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { sent: 0, error: `HTTP ${res.status}` };
    return await res.json();
  } catch (e) {
    return { sent: 0, error: e.message };
  }
}

export async function triggerTipSheetSend(payload, accessToken) {
  try {
    const res = await fetch("/api/send-tipsheet", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      // Keep the server's reason (e.g. "tip sheet PDF missing…"); 413 means
      // the attached PDF was over Vercel's request-body limit.
      const data = await res.json().catch(() => ({}));
      return { sent: 0, error: data.error || (res.status === 413 ? "the PDF is too large to send" : `HTTP ${res.status}`) };
    }
    return await res.json();
  } catch (e) {
    return { sent: 0, error: e.message };
  }
}

// Manual Rail entry ("+ Add Request"): the server inserts the pending row and
// sends the paper-trail + staff confirmation emails.
export async function submitManualRail({ staffId, type, dates, note, loggedBy }, accessToken) {
  try {
    const res = await fetch("/api/manual-rail", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify({ staffId, type, dates, note, loggedBy }),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return await res.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
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

// Permanent delete. Every table referencing staff(id) is ON DELETE CASCADE, so
// this also removes the person's roles, patterns, overrides, and rail requests.
export async function deleteStaff(id) {
  const { error } = await supabase.from("staff").delete().eq("id", id);
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

// Add one option to a role's dropdown. sort_order defaults to the end of the
// role's current list so new shifts append rather than jumping the order.
export async function insertRoleShiftOption({ role, code, label, sortOrder }) {
  const { data, error } = await supabase
    .from("role_shift_options")
    .insert({ role, code, label, sort_order: sortOrder })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Remove an option from the dropdown. Deliberately does NOT touch
// schedule_patterns / weekly_schedules — shifts already assigned with this code
// keep rendering from SHIFT_META, they just can't be picked again.
export async function deleteRoleShiftOption(role, code) {
  const { error } = await supabase
    .from("role_shift_options")
    .delete()
    .eq("role", role)
    .eq("code", code);
  if (error) throw error;
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

/* ------------------------------------------- weekly_schedules (per week) --- */
// schedule_patterns / placeholder_schedule are RECURRING templates shared by
// every week. These tables store one row per (week_start, ...) so each week is
// independent. A week with no rows has never been edited and renders from the
// template; the first edit snapshots the whole week in (see seedWeek* below).
//
// All of it is migration-0010-gated. Until the owner runs that migration the
// tables don't exist, so every read here returns null/empty and every write is
// a no-op — the app then behaves exactly as it did before, off the template.
// PostgREST reports a missing table as 42P01 (and PGRST205 from its schema
// cache); anything else is a real error and still throws.
const MISSING_TABLE = new Set(["42P01", "PGRST205"]);
function isMissingTable(error) {
  return !!error && MISSING_TABLE.has(error.code);
}

// True once we've confirmed the 0010 tables exist, false once we've confirmed
// they don't, null while unknown. Cached so a pre-migration app doesn't retry
// on every week change.
let weeklyTablesPresent = null;
export function weeklyTablesAvailable() {
  return weeklyTablesPresent !== false;
}

// -> { [name]: [7 shift_types] } for one week, or null if the week has no rows
// (never edited) or the tables don't exist yet.
export async function fetchWeeklySchedule(weekStartIso, idToName) {
  const { data, error } = await supabase
    .from("weekly_schedules")
    .select("staff_id, weekday, shift_type")
    .eq("week_start", weekStartIso);
  if (error) {
    if (isMissingTable(error)) { weeklyTablesPresent = false; return null; }
    throw error;
  }
  weeklyTablesPresent = true;
  if (!data || !data.length) return null;
  const patterns = {};
  data.forEach((row) => {
    const name = idToName[row.staff_id];
    if (!name) return;
    if (!patterns[name]) patterns[name] = ["OFF", "OFF", "OFF", "OFF", "OFF", "OFF", "OFF"];
    patterns[name][row.weekday] = row.shift_type;
  });
  return patterns;
}

// -> { [group_key]: [ [7 shift_types] per slot ] } for one week, or null.
export async function fetchWeeklyPlaceholders(weekStartIso) {
  const { data, error } = await supabase
    .from("weekly_placeholder_schedules")
    .select("group_key, slot_index, weekday, shift_type")
    .eq("week_start", weekStartIso);
  if (error) {
    if (isMissingTable(error)) { weeklyTablesPresent = false; return null; }
    throw error;
  }
  if (!data || !data.length) return null;
  const groups = {};
  const maxSlot = {};
  data.forEach((row) => {
    maxSlot[row.group_key] = Math.max(maxSlot[row.group_key] ?? -1, row.slot_index);
  });
  Object.entries(maxSlot).forEach(([g, max]) => {
    groups[g] = Array.from({ length: max + 1 }, () => ["OFF", "OFF", "OFF", "OFF", "OFF", "OFF", "OFF"]);
  });
  data.forEach((row) => {
    groups[row.group_key][row.slot_index][row.weekday] = row.shift_type;
  });
  return groups;
}

// The four writers below all return TRUE only when rows actually reached the
// database, and FALSE when the write was skipped — pre-migration tables, an
// unknown staff member, nothing to write. Set Schedule's save indicator reads
// that return value, so a skipped write shows "Not saved" instead of silently
// reporting success.
export async function upsertWeeklyShift(weekStartIso, staffId, weekday, shiftType) {
  if (!staffId || weeklyTablesPresent === false) return false;
  const { error } = await supabase
    .from("weekly_schedules")
    .upsert(
      { week_start: weekStartIso, staff_id: staffId, weekday, shift_type: shiftType, updated_at: new Date().toISOString() },
      { onConflict: "week_start,staff_id,weekday" }
    );
  if (error) {
    if (isMissingTable(error)) { weeklyTablesPresent = false; return false; }
    throw error;
  }
  return true;
}

export async function upsertWeeklyPlaceholder(weekStartIso, groupKey, slotIndex, slotName, weekday, shiftType) {
  if (weeklyTablesPresent === false) return false;
  const { error } = await supabase
    .from("weekly_placeholder_schedules")
    .upsert(
      {
        week_start: weekStartIso, group_key: groupKey, slot_index: slotIndex,
        slot_name: slotName || "", weekday, shift_type: shiftType,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "week_start,group_key,slot_index,weekday" }
    );
  if (error) {
    if (isMissingTable(error)) { weeklyTablesPresent = false; return false; }
    throw error;
  }
  return true;
}

// Snapshot a whole week into weekly_schedules the first time it's touched, so
// the week is a complete independent record and later template edits can't leak
// into it. `patterns` is the grid currently on screen (template-derived).
export async function seedWeeklySchedule(weekStartIso, patterns, nameToId) {
  if (weeklyTablesPresent === false) return false;
  const rows = [];
  Object.entries(patterns || {}).forEach(([name, week]) => {
    const staffId = nameToId[name];
    if (!staffId) return;
    (week || []).forEach((shiftType, weekday) => {
      rows.push({ week_start: weekStartIso, staff_id: staffId, weekday, shift_type: shiftType || "OFF" });
    });
  });
  if (!rows.length) return false;
  const { error } = await supabase
    .from("weekly_schedules")
    .upsert(rows, { onConflict: "week_start,staff_id,weekday" });
  if (error) {
    if (isMissingTable(error)) { weeklyTablesPresent = false; return false; }
    throw error;
  }
  return true;
}

export async function seedWeeklyPlaceholders(weekStartIso, placeholders, slotNamesByGroup = {}) {
  if (weeklyTablesPresent === false) return false;
  const rows = [];
  Object.entries(placeholders || {}).forEach(([groupKey, slots]) => {
    (slots || []).forEach((week, slotIndex) => {
      (week || []).forEach((shiftType, weekday) => {
        rows.push({
          week_start: weekStartIso, group_key: groupKey, slot_index: slotIndex,
          slot_name: (slotNamesByGroup[groupKey] || [])[slotIndex] || "",
          weekday, shift_type: shiftType || "OFF",
        });
      });
    });
  });
  if (!rows.length) return false;
  const { error } = await supabase
    .from("weekly_placeholder_schedules")
    .upsert(rows, { onConflict: "week_start,group_key,slot_index,weekday" });
  if (error) {
    if (isMissingTable(error)) { weeklyTablesPresent = false; return false; }
    throw error;
  }
  return true;
}

/* ------------------------------------------------------- schedule_notes ---- */
// Per-week notes. Also 0010-gated: pre-migration every read returns [] and the
// Notes button stays hidden rather than erroring.

let notesTablePresent = null;
export function notesTableAvailable() {
  return notesTablePresent !== false;
}

export async function fetchScheduleNotes(weekStartIso) {
  const { data, error } = await supabase
    .from("schedule_notes")
    .select("id, week_start, staff_id, note, source, rail_request_id, created_at, updated_at")
    .eq("week_start", weekStartIso)
    .order("created_at", { ascending: false });
  if (error) {
    if (isMissingTable(error)) { notesTablePresent = false; return []; }
    throw error;
  }
  notesTablePresent = true;
  return data || [];
}

export async function insertScheduleNote({ weekStartIso, note, staffId = null, source = "manual", railRequestId = null }) {
  if (notesTablePresent === false) return null;
  const { data, error } = await supabase
    .from("schedule_notes")
    .insert({ week_start: weekStartIso, note, staff_id: staffId, source, rail_request_id: railRequestId })
    .select()
    .single();
  if (error) {
    if (isMissingTable(error)) { notesTablePresent = false; return null; }
    throw error;
  }
  return data;
}

export async function updateScheduleNote(id, note) {
  if (notesTablePresent === false) return;
  const { error } = await supabase
    .from("schedule_notes")
    .update({ note, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error && !isMissingTable(error)) throw error;
}

export async function deleteScheduleNote(id) {
  if (notesTablePresent === false) return;
  const { error } = await supabase.from("schedule_notes").delete().eq("id", id);
  if (error && !isMissingTable(error)) throw error;
}

/* ------------------------------------------------------- calendar_notes --- */
// Notes pinned to one date (migration 0011), shown in the Calendar day popup.
// Migration-gated the same way as schedule_notes: pre-migration every read
// returns [] and the notes section stays hidden rather than erroring.

let calendarNotesPresent = null;
export function calendarNotesAvailable() {
  return calendarNotesPresent !== false;
}

// -> { "YYYY-MM-DD": [rows] } for every note on file. Small table (one row per
// note, not per day), so a single fetch beats a request per popup.
export async function fetchCalendarNotes() {
  const { data, error } = await supabase
    .from("calendar_notes")
    .select("id, date, note, created_at")
    .order("created_at", { ascending: true });
  if (error) {
    if (isMissingTable(error)) { calendarNotesPresent = false; return {}; }
    throw error;
  }
  calendarNotesPresent = true;
  const byDate = {};
  (data || []).forEach((row) => {
    if (!byDate[row.date]) byDate[row.date] = [];
    byDate[row.date].push(row);
  });
  return byDate;
}

export async function insertCalendarNote(dateIso, note) {
  if (calendarNotesPresent === false) return null;
  const { data, error } = await supabase
    .from("calendar_notes")
    .insert({ date: dateIso, note })
    .select()
    .single();
  if (error) {
    if (isMissingTable(error)) { calendarNotesPresent = false; return null; }
    throw error;
  }
  return data;
}

// calendar_notes has no updated_at column (migration 0011), so an edit is just
// the note text — nothing else about the row changes.
export async function updateCalendarNote(id, note) {
  if (calendarNotesPresent === false) return;
  const { error } = await supabase.from("calendar_notes").update({ note }).eq("id", id);
  if (error && !isMissingTable(error)) throw error;
}

export async function deleteCalendarNote(id) {
  if (calendarNotesPresent === false) return;
  const { error } = await supabase.from("calendar_notes").delete().eq("id", id);
  if (error && !isMissingTable(error)) throw error;
}

/* --------------------------------------------------------- general_notes -- */
// Standing, undated notes for the Rail's Notes box (migration 0014). Gated the
// same way as schedule_notes: pre-migration every read returns [] and the box
// renders empty rather than erroring.

let generalNotesPresent = null;
export function generalNotesAvailable() {
  return generalNotesPresent !== false;
}

export async function fetchGeneralNotes() {
  const { data, error } = await supabase
    .from("general_notes")
    .select("id, note, sort_order, created_at, updated_at")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    if (isMissingTable(error)) { generalNotesPresent = false; return []; }
    throw error;
  }
  generalNotesPresent = true;
  return data || [];
}

export async function insertGeneralNote(note) {
  if (generalNotesPresent === false) return null;
  const { data, error } = await supabase
    .from("general_notes")
    .insert({ note })
    .select()
    .single();
  if (error) {
    if (isMissingTable(error)) { generalNotesPresent = false; return null; }
    throw error;
  }
  return data;
}

export async function updateGeneralNote(id, note) {
  if (generalNotesPresent === false) return;
  const { error } = await supabase
    .from("general_notes")
    .update({ note, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error && !isMissingTable(error)) throw error;
}

export async function deleteGeneralNote(id) {
  if (generalNotesPresent === false) return;
  const { error } = await supabase.from("general_notes").delete().eq("id", id);
  if (error && !isMissingTable(error)) throw error;
}

/* -------------------------------------------------------- rail_view_state -- */
// Shared hide-only watermarks for the Rail's Auto-Action Log and Resolved list
// (migration 0014). One row per list and GLOBAL, not per user — when any manager
// presses Clear it is cleared for everyone. Nothing is deleted; the UI filters
// out entries created at or before cleared_at.

export const RAIL_LISTS = { log: "auto_log", resolved: "resolved" };

let railViewStatePresent = null;
export function railViewStateAvailable() {
  return railViewStatePresent !== false;
}

// -> { auto_log: iso|null, resolved: iso|null }
export async function fetchRailViewState() {
  const empty = { auto_log: null, resolved: null };
  const { data, error } = await supabase
    .from("rail_view_state")
    .select("list, cleared_at");
  if (error) {
    if (isMissingTable(error)) { railViewStatePresent = false; return empty; }
    throw error;
  }
  railViewStatePresent = true;
  const out = { ...empty };
  (data || []).forEach((r) => { if (r.list in out) out[r.list] = r.cleared_at; });
  return out;
}

// clearedAt null unhides the list again. Returns true if the write landed, so
// the caller can tell a persisted clear from a session-only one.
export async function setRailCleared(list, clearedAt, clearedBy = null) {
  if (railViewStatePresent === false) return false;
  const { error } = await supabase
    .from("rail_view_state")
    .upsert(
      { list, cleared_at: clearedAt, cleared_by: clearedBy, updated_at: new Date().toISOString() },
      { onConflict: "list" }
    );
  if (error) {
    if (isMissingTable(error)) { railViewStatePresent = false; return false; }
    throw error;
  }
  return true;
}

/* -------------------------------------------------------- schedule_weeks -- */
// Finalize / publish state plus per-section lock state (migrations 0009, 0013).
//
// The key is (week_start, section). Finalize/publish stay week-level and live on
// the sentinel section 'ALL' — the row 0009 already wrote, backfilled by 0013.
// Locks are per section, one row each for FOH / BOHKITCHEN / MANAGEMENT, so
// locking FOH for one week touches nothing else.

export const WEEK_SECTION_ALL = "ALL";
// UI sub-tab key -> the section value stored in schedule_weeks.
const SECTION_DB = { foh: "FOH", bohkitchen: "BOHKITCHEN", management: "MANAGEMENT" };
export function weekSectionDbValue(sectionKey) {
  return SECTION_DB[sectionKey] || String(sectionKey || "").toUpperCase();
}

export async function fetchScheduleWeeks() {
  // section/locked/locked_at arrived in 0013 — fall back to the 0009 column set
  // so the app still loads against a database that hasn't run it yet.
  let { data, error } = await supabase
    .from("schedule_weeks")
    .select("week_start, section, finalized, published, published_at, locked");
  if (error) {
    if (isMissingTable(error)) return [];
    ({ data, error } = await supabase
      .from("schedule_weeks")
      .select("week_start, finalized, published, published_at"));
    if (error) {
      if (isMissingTable(error)) return [];
      throw error;
    }
  }
  // Pre-0013 rows have no section; treat them as the week-level row.
  return (data || []).map((r) => ({ ...r, section: r.section || WEEK_SECTION_ALL, locked: !!r.locked }));
}

// Upsert one schedule_weeks row on the (week_start, section) key from 0013.
// `legacy` retries on week_start alone, dropping section — correct only for the
// week-level ALL row, which is the single row the pre-0013 key ever held. Lock
// rows must never fall back: collapsing them onto week_start would overwrite
// the finalize/publish row, so they surface the error instead.
async function upsertWeekRow(weekStartIso, section, fields, { legacy = false } = {}) {
  const row = { week_start: weekStartIso, section, updated_at: new Date().toISOString(), ...fields };
  let { error } = await supabase.from("schedule_weeks").upsert(row, { onConflict: "week_start,section" });
  if (error && legacy && !isMissingTable(error)) {
    const { section: _dropped, ...older } = row;
    ({ error } = await supabase.from("schedule_weeks").upsert(older, { onConflict: "week_start" }));
  }
  if (error && !isMissingTable(error)) throw error;
}

// Finalize marks a week as done and puts it on the Calendar; un-finalizing
// takes it back off. Un-finalizing ALSO clears published/published_at: a week
// that gets reopened, edited and re-finalized has to be publishable again, and
// leaving it marked published would silently exclude it from the next send.
export async function setWeekFinalized(weekStartIso, finalized) {
  const fields = { finalized, finalized_at: finalized ? new Date().toISOString() : null };
  if (!finalized) { fields.published = false; fields.published_at = null; }
  await upsertWeekRow(weekStartIso, WEEK_SECTION_ALL, fields, { legacy: true });
}

export async function setWeekPublished(weekStartIso) {
  await upsertWeekRow(
    weekStartIso,
    WEEK_SECTION_ALL,
    { published: true, published_at: new Date().toISOString() },
    { legacy: true }
  );
}

// One section of one week. sectionKey is the UI sub-tab key ('foh' etc).
export async function setWeekSectionLocked(weekStartIso, sectionKey, locked) {
  await upsertWeekRow(weekStartIso, weekSectionDbValue(sectionKey), {
    locked,
    locked_at: locked ? new Date().toISOString() : null,
  });
}

/* -------------------------------------------------- schedule_overrides ----- */
// -> { "name|YYYY-MM-DD": { type, swap } }, matching the prototype OVERRIDES.

export async function fetchOverrides(idToName) {
  // rail_request_id (railId) marks an override as approved-Rail-sourced — used by
  // the approved-time-off block. Fall back if the column is absent (pre-0004).
  let { data, error } = await supabase
    .from("schedule_overrides")
    .select("staff_id, date, override_type, is_swap, rail_request_id");
  if (error) {
    ({ data, error } = await supabase
      .from("schedule_overrides")
      .select("staff_id, date, override_type, is_swap"));
    if (error) throw error;
  }
  const overrides = {};
  (data || []).forEach((row) => {
    const name = idToName[row.staff_id];
    if (!name) return;
    overrides[`${name}|${row.date}`] = { type: row.override_type || undefined, swap: !!row.is_swap, railId: row.rail_request_id || null };
  });
  return overrides;
}

/* -------------------------------------------------------- rail_requests ---- */
// pending  -> [{ id, type, name, dates, notice, note, urgent }]
// resolved -> [{ id, name, type, dates, status, created_at }] (for the log)
// archived -> same shape as pending, for the collapsed Archived section — kept
//             out of both other buckets so it neither waits on a decision nor
//             reads as resolved.

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
  const archived = [];
  (data || []).forEach((row) => {
    // matched entries resolve staff_id -> name; email entries with no staff
    // match fall back to the raw name from the email, flagged as unmatched.
    const name = idToName[row.staff_id] || row.unmatched_name || "Unknown";
    const unmatchedName = !row.staff_id && row.unmatched_name ? row.unmatched_name : null;
    if (row.status === "pending" || row.status === "archived") {
      const entry = {
        id: row.id,
        type: row.type,
        name,
        staffId: row.staff_id || null,
        dates: row.dates,
        notice: row.notice,
        note: row.note,
        urgent: !!row.urgent,
        source: row.source || "manual",
        unmatchedName,
      };
      (row.status === "archived" ? archived : pending).push(entry);
    } else {
      resolved.push({ id: row.id, name, type: row.type, dates: row.dates, status: row.status, created_at: row.created_at });
    }
  });
  // pending should read oldest-first like the prototype's initial list
  pending.reverse();
  archived.reverse();
  return { pending, resolved, archived };
}

// Archive hides a request from the pending queue without losing it; restoring
// puts it straight back. Both are just a status write, so the request keeps its
// note, source and Gmail thread.
export async function setRailArchived(id, archived) {
  await updateRailStatus(id, archived ? "archived" : "pending");
}

// Permanent — the row is gone, not flagged. schedule_overrides.rail_request_id
// is ON DELETE SET NULL (0004), so an override written from an approval survives
// with its link cleared rather than cascading away.
export async function deleteRailRequest(id) {
  const { error } = await supabase.from("rail_requests").delete().eq("id", id);
  if (error) throw error;
}

export async function updateRailStatus(id, status, managerNote) {
  const patch = { status };
  if (managerNote !== undefined) patch.manager_note = managerNote || null;
  let { error } = await supabase.from("rail_requests").update(patch).eq("id", id);
  // manager_note column arrived in migration 0004 — retry status-only if absent
  if (error && managerNote !== undefined) {
    ({ error } = await supabase.from("rail_requests").update({ status }).eq("id", id));
  }
  if (error) throw error;
}

/* --------------------------------------------- schedule_overrides (write) -- */
// Upsert a one-off override for a specific date (keyed by staff_id + date).
// overrideType: 'OFF' | 'GAP' | a shift code (swap) | null. rail_request_id
// links it to the approving request (column added in migration 0004).
export async function upsertScheduleOverride({ staffId, dateIso, overrideType, isSwap, railRequestId }) {
  const row = { staff_id: staffId, date: dateIso, override_type: overrideType ?? null, is_swap: !!isSwap };
  if (railRequestId) row.rail_request_id = railRequestId;
  let { error } = await supabase.from("schedule_overrides").upsert(row, { onConflict: "staff_id,date" });
  if (error && row.rail_request_id) {
    delete row.rail_request_id; // pre-0004 fallback
    ({ error } = await supabase.from("schedule_overrides").upsert(row, { onConflict: "staff_id,date" }));
  }
  if (error) throw error;
}

// Fire the server-side auto-reply (best-effort; never throws to the caller).
// opts: { partial, approvedDatesText } for a partially-approved TIME OFF.
export async function sendRailReply(railRequestId, approved, managerNote, accessToken, opts = {}) {
  try {
    const res = await fetch("/api/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify({
        railRequestId,
        approved,
        managerNote: managerNote || "",
        partial: !!opts.partial,
        approvedDatesText: opts.approvedDatesText || "",
      }),
    });
    if (!res.ok) return { sent: false, error: `HTTP ${res.status}` };
    return await res.json();
  } catch (e) {
    return { sent: false, error: e.message };
  }
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
