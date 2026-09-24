// Supabase access for the server side, using the SERVICE ROLE key (bypasses RLS).
// This module is the only thing that touches integration_tokens and it is never
// imported by client code.

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, assertSupabaseConfigured } from "./config.js";

let _admin = null;
export function admin() {
  if (!_admin) {
    assertSupabaseConfigured();
    _admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _admin;
}

/* ---- integration_tokens (provider = 'gmail') ---- */

export async function getGmailToken() {
  const { data, error } = await admin()
    .from("integration_tokens")
    .select("provider, refresh_token, email, last_poll_at, last_ok_at, last_error, updated_at")
    .eq("provider", "gmail")
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// updated_at is written ONLY here, so it reads as "when the current refresh
// token was saved" — the timestamp that matters when diagnosing a dead grant.
// Poll bookkeeping and auth-failure records deliberately leave it alone.
export async function saveGmailRefreshToken(refreshToken, email) {
  const patch = { provider: "gmail", email, updated_at: new Date().toISOString(), last_error: null };
  if (refreshToken) patch.refresh_token = refreshToken; // Google omits it on re-consent sometimes
  const { error } = await admin().from("integration_tokens").upsert(patch, { onConflict: "provider" });
  if (error) throw error;
}

export async function recordPoll({ ok, error }) {
  const now = new Date().toISOString();
  const patch = { provider: "gmail", last_poll_at: now };
  if (ok) { patch.last_ok_at = now; patch.last_error = null; }
  else if (error) { patch.last_error = String(error).slice(0, 500); }
  const { error: e } = await admin().from("integration_tokens").upsert(patch, { onConflict: "provider" });
  if (e) throw e;
}

// A refresh that Google rejected (see gmail-auth.js). The "AUTH:" prefix on
// last_error is what /api/gmail/status reads as needsReconnect.
export async function recordGmailAuthFailure(summary) {
  const { error } = await admin()
    .from("integration_tokens")
    .upsert({ provider: "gmail", last_error: String(summary).slice(0, 500) }, { onConflict: "provider" });
  if (error) throw error;
}

// A later refresh worked (e.g. Google had a blip, or someone reconnected).
export async function clearGmailAuthFailure() {
  const now = new Date().toISOString();
  const { error } = await admin()
    .from("integration_tokens")
    .update({ last_error: null, last_ok_at: now })
    .eq("provider", "gmail");
  if (error) throw error;
}

/* ---- staff + rail_requests ---- */

export async function fetchStaffMinimal() {
  // personal_email + registered are needed to match a plain email to its sender
  // (the keyword-based scheduling path in /api/poll).
  const { data, error } = await admin().from("staff").select("id, name, active, personal_email, registered");
  if (error) throw error;
  return data || [];
}

// Registered staff (registered=true, active, has an email) for schedule/tip sends.
export async function fetchRegisteredStaff() {
  const { data, error } = await admin()
    .from("staff")
    .select("id, name, personal_email, registered, active, section")
    .eq("registered", true);
  if (error) throw error;
  return (data || []).filter((s) => s.active !== false && s.personal_email);
}

// [REGISTER]: store contact info + mark registered.
export async function registerStaffContact(staffId, { email, phone }) {
  const patch = { registered: true };
  if (email) patch.personal_email = email;
  if (phone) patch.phone = phone;
  const { error } = await admin().from("staff").update(patch).eq("id", staffId);
  if (error) throw error;
}

// [UPDATE INFO]: queue a pending change for manager review (never auto-applied).
export async function insertInfoUpdate({ staffId, newEmail, newPhone }) {
  const { error } = await admin()
    .from("staff_info_updates")
    .insert({ staff_id: staffId, new_email: newEmail || null, new_phone: newPhone || null, status: "pending" });
  if (error) throw error;
}

// Insert a pending rail entry from an email. Relies on the partial unique index
// on gmail_message_id to reject duplicates (returns { duplicate: true }).
export async function insertGmailRail({ staffId, unmatchedName, type, dates, note, messageId, threadId }) {
  const row = {
    staff_id: staffId || null,
    type,
    dates,
    note: note || null,
    status: "pending",
    urgent: false,
    source: "gmail",
    unmatched_name: unmatchedName || null,
    gmail_message_id: messageId,
    gmail_thread_id: threadId || null,
  };
  const { error } = await admin().from("rail_requests").insert(row);
  if (error) {
    if (error.code === "23505") return { duplicate: true }; // unique violation
    throw error;
  }
  return { duplicate: false };
}

// Manual Rail entry from the "+ Add Request" form. No gmail ids (the reply
// flow already skips rows without a thread). Retries without logged_by if
// migration 0008 hasn't been run yet.
export async function insertManualRail({ staffId, type, dates, note, loggedBy }) {
  const row = {
    staff_id: staffId,
    type,
    dates,
    note: note || null,
    status: "pending",
    urgent: false,
    source: "manual",
    logged_by: loggedBy || null,
  };
  let { data, error } = await admin().from("rail_requests").insert(row).select("id").single();
  if (error && error.code === "42703") {
    const { logged_by, ...pre0008 } = row;
    ({ data, error } = await admin().from("rail_requests").insert(pre0008).select("id").single());
  }
  if (error) throw error;
  return data; // { id }
}

export async function getStaffById(id) {
  const { data, error } = await admin()
    .from("staff")
    .select("id, name, personal_email, registered, active")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function gmailMessageExists(messageId) {
  const { data, error } = await admin()
    .from("rail_requests")
    .select("id")
    .eq("gmail_message_id", messageId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

// Full request row + the resolved staff name (falls back to unmatched_name),
// for composing the reply.
export async function getRailRequestById(id) {
  const { data, error } = await admin()
    .from("rail_requests")
    .select("id, staff_id, type, dates, unmatched_name, gmail_message_id, gmail_thread_id, staff:staff_id(name)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { ...data, name: data.staff?.name || data.unmatched_name || "there" };
}

// True if the bearer token is a valid Supabase user (an authenticated manager).
export async function isManager(token) {
  if (!token) return false;
  try {
    const { data, error } = await admin().auth.getUser(token);
    return !error && !!data?.user;
  } catch {
    return false;
  }
}

/* ---- schedule_weeks (finalize/publish state) ----
   Schema: week_start (date), section (text, nullable), finalized (bool), published (bool),
           finalized_at (timestamptz), published_at (timestamptz)
*/

export async function toggleWeekFinalized(weekStart, section = null) {
  // Get current finalized state
  let query = admin().from("schedule_weeks").select("finalized").eq("week_start", weekStart);
  if (section) query = query.eq("section", section);
  else query = query.is("section", null);

  const { data: existing } = await query.maybeSingle();
  const newFinalized = !(existing?.finalized ?? false);
  const now = new Date().toISOString();

  const row = {
    week_start: weekStart,
    section: section || null,
    finalized: newFinalized,
    finalized_at: newFinalized ? now : null,
  };

  const { error } = await admin()
    .from("schedule_weeks")
    .upsert(row, { onConflict: "week_start" });
  if (error) throw error;
  return newFinalized;
}

export async function fetchWeekFinalized(weekStart, section = null) {
  let query = admin().from("schedule_weeks").select("finalized").eq("week_start", weekStart);
  if (section) query = query.eq("section", section);
  else query = query.is("section", null);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data?.finalized ?? false;
}

export async function fetchFinalizedWeeks() {
  const { data, error } = await admin()
    .from("schedule_weeks")
    .select("week_start, section, published")
    .eq("finalized", true)
    .order("week_start", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function markWeeksPublished(weekStarts) {
  const now = new Date().toISOString();
  const updates = weekStarts.map(ws => ({
    week_start: ws,
    published: true,
    published_at: now,
  }));

  const { error } = await admin().from("schedule_weeks").upsert(updates, { onConflict: "week_start" });
  if (error) throw error;
}
