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

export async function saveGmailRefreshToken(refreshToken, email) {
  const patch = { provider: "gmail", email, updated_at: new Date().toISOString(), last_error: null };
  if (refreshToken) patch.refresh_token = refreshToken; // Google omits it on re-consent sometimes
  const { error } = await admin().from("integration_tokens").upsert(patch, { onConflict: "provider" });
  if (error) throw error;
}

export async function recordPoll({ ok, error }) {
  const now = new Date().toISOString();
  const patch = { provider: "gmail", last_poll_at: now, updated_at: now };
  if (ok) { patch.last_ok_at = now; patch.last_error = null; }
  else if (error) { patch.last_error = String(error).slice(0, 500); }
  const { error: e } = await admin().from("integration_tokens").upsert(patch, { onConflict: "provider" });
  if (e) throw e;
}

/* ---- staff + rail_requests ---- */

export async function fetchStaffMinimal() {
  const { data, error } = await admin().from("staff").select("id, name, active");
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
