// Gmail label organization. Labels are created on demand (no manual Gmail
// setup) and cached per request. Nested names ("Requests/Time Off") nest in
// Gmail automatically.

import { listLabels, createLabel } from "./google.js";

// Canonical label names, keyed for reuse by the poller and the send endpoints.
export const LABELS = {
  registrations: "Registrations",
  infoUpdates: "Info Updates",
  reqOff: "Requests/Request Off",
  swap: "Requests/Shift Swap",
  coverage: "Requests/Coverage",
  timeOff: "Requests/Time Off",
  sentSchedules: "Sent/Schedules",
  sentTipSheets: "Sent/Tip Sheets",
  sentWelcome: "Sent/Welcome",
  sentReplies: "Sent/Replies",
};

// Incoming rail request type -> label name.
export function incomingLabelForType(type) {
  return {
    "REQUEST OFF": LABELS.reqOff,
    "SHIFT SWAP": LABELS.swap,
    "COVERAGE REQUEST": LABELS.coverage,
    "TIME OFF": LABELS.timeOff,
  }[type] || null;
}

// A per-request label resolver: fetches the label list once, creates any that
// are missing, and hands back ids. All failures are non-fatal to callers that
// wrap ensure() in try/catch (labeling should never break mail processing).
export function makeLabeler(accessToken) {
  let cache = null;
  async function load() {
    if (cache) return;
    cache = new Map();
    const labels = await listLabels(accessToken);
    labels.forEach((l) => cache.set(l.name, l.id));
  }
  async function ensure(name) {
    await load();
    if (cache.has(name)) return cache.get(name);
    try {
      const created = await createLabel(accessToken, name);
      cache.set(name, created.id);
      return created.id;
    } catch (e) {
      // Likely a 409 race — refetch and try the cache once more.
      cache = null;
      await load();
      if (cache.has(name)) return cache.get(name);
      throw e;
    }
  }
  return { ensure };
}
