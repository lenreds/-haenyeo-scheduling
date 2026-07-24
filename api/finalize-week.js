// /api/finalize-week — toggle finalized state for a week in the Set Schedule
// Requires: Bearer token (authenticated manager) or Supabase JWT
// Body: { weekStart: "2026-07-13", section: "FOH" or null }
// Returns: { weekStart, finalized: bool }

import { isManager, toggleWeekFinalized } from "./_lib/store.js";

async function authorize(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return await isManager(token);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!(await authorize(req))) return res.status(401).json({ error: "unauthorized" });

  try {
    const { weekStart, section } = req.body;
    if (!weekStart) return res.status(400).json({ error: "weekStart required" });

    const finalized = await toggleWeekFinalized(weekStart, section || null);
    return res.status(200).json({ weekStart, section: section || null, finalized });
  } catch (e) {
    console.error(`[finalize-week] failed: ${e.message}`);
    return res.status(500).json({ error: e.message });
  }
}
