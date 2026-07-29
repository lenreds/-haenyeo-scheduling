// Pure parsing helpers for scheduling emails. No I/O — unit-testable in isolation.

// The three allowed request types, normalized to the exact strings the
// rail_requests.type column / Rail UI expect.
const TYPE_CANON = {
  "REQUEST OFF": "REQUEST OFF",
  "SHIFT SWAP": "SHIFT SWAP",
  "COVERAGE REQUEST": "COVERAGE REQUEST",
  "TIME OFF": "TIME OFF",
};

const SEP = "[–—-]"; // en-dash, em-dash, or hyphen

// Parse a two-field tagged subject: "[TAG] – Name – Code". Name is everything up
// to the last separator; Code is the final segment. Used by [REGISTER] and
// [UPDATE INFO]. Returns { name, code } or null.
function parseTagged(subject, tagRegex) {
  if (!subject) return null;
  const cleaned = subject.replace(/\s+/g, " ").trim();
  const m = cleaned.match(new RegExp(`^${tagRegex}\\s*${SEP}\\s*(.+)$`, "i"));
  if (!m) return null;
  const rest = m[1];
  const idx = rest.search(new RegExp(`\\s*${SEP}\\s*[^–—-]*$`));
  if (idx < 0) return null;
  const name = rest.slice(0, idx).trim();
  const code = rest.replace(new RegExp(`^.*${SEP}\\s*`), "").trim();
  if (!name || !code) return null;
  return { name, code };
}

export const parseRegisterSubject = (s) => parseTagged(s, "\\[REGISTER\\]");
export const parseUpdateInfoSubject = (s) => parseTagged(s, "\\[UPDATE INFO\\]");

// True if the manager's code word matches (case-insensitive, trimmed).
export function codeMatches(supplied, expected) {
  return !!expected && String(supplied || "").trim().toLowerCase() === String(expected).trim().toLowerCase();
}

// Pull a phone number out of free text ("My best phone number is: 555-123-4567").
export function parsePhoneFromBody(text) {
  const m = String(text || "").match(/(\+?\d[\d\s().-]{6,}\d)/);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

// For [UPDATE INFO] bodies: pull whichever of email / phone the staffer filled in.
export function parseUpdateFields(text) {
  const t = String(text || "");
  const email = (t.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0] || null;
  // phone: prefer a line mentioning "phone", else any phone-like run
  let phone = null;
  const phoneLine = t.split(/\r?\n/).find((l) => /phone/i.test(l));
  phone = parsePhoneFromBody(phoneLine || "") || parsePhoneFromBody(t);
  return { email, phone };
}

// Parse "[SCHEDULING] – TYPE – Name – Date". Separators may be en-dash (–),
// em-dash (—), or hyphen (-) with any surrounding spaces (staff clients vary).
// Returns { type, name, date } or null if it doesn't match the convention.
export function parseSchedulingSubject(subject) {
  if (!subject) return null;
  const cleaned = subject.replace(/\s+/g, " ").trim();
  // must start with the [SCHEDULING] tag followed by a separator
  const head = cleaned.match(/^\[SCHEDULING\]\s*[–—-]\s*(.+)$/i);
  if (!head) return null;
  const parts = head[1].split(/\s*[–—-]\s*/);
  if (parts.length < 3) return null;
  const typeRaw = parts[0].trim().toUpperCase();
  const name = parts[1].trim();
  const date = parts.slice(2).join(" - ").trim(); // rejoin in case a date had a dash
  const type = TYPE_CANON[typeRaw];
  if (!type || !name || !date) return null;
  return { type, name, date };
}

// Case-insensitive exact match of the email's Name against staff. Returns the
// staff row, or null if no unique match (unmatched → flagged entry).
export function matchStaff(name, staff) {
  if (!name) return null;
  const target = name.trim().toLowerCase();
  const hits = (staff || []).filter((s) => (s.name || "").trim().toLowerCase() === target);
  return hits.length === 1 ? hits[0] : null;
}

// Fuzzier match for registration ("Bernie Smith" -> staff "Bernie"): exact first,
// then match on first-name token, then any shared token. Returns the row only
// when exactly one candidate matches (ambiguity => null).
export function matchStaffFuzzy(name, staff) {
  const exact = matchStaff(name, staff);
  if (exact) return exact;
  if (!name) return null;
  const tokens = name.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const first = tokens[0];
  const byFirst = (staff || []).filter((s) => (s.name || "").trim().toLowerCase().split(/\s+/)[0] === first);
  if (byFirst.length === 1) return byFirst[0];
  const shared = (staff || []).filter((s) => {
    const st = (s.name || "").trim().toLowerCase().split(/\s+/);
    return st.some((t) => tokens.includes(t));
  });
  return shared.length === 1 ? shared[0] : null;
}

// Walk a Gmail message payload for the best plain-text body. Falls back to
// stripping tags off text/html, then to the message snippet.
export function extractPlainText(message) {
  const payload = message?.payload;
  if (payload) {
    const plain = findPart(payload, "text/plain");
    if (plain) return decodeB64Url(plain).trim();
    const html = findPart(payload, "text/html");
    if (html) return stripHtml(decodeB64Url(html)).trim();
  }
  return (message?.snippet || "").trim();
}

function findPart(part, mime) {
  if (part.mimeType === mime && part.body?.data) return part.body.data;
  for (const child of part.parts || []) {
    const found = findPart(child, mime);
    if (found) return found;
  }
  return null;
}

function decodeB64Url(data) {
  try {
    return Buffer.from(String(data).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return "";
  }
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ");
}

export function headerValue(message, name) {
  const headers = message?.payload?.headers || [];
  const h = headers.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h ? h.value : "";
}

// Parse scheduling email subject for keyword-based type matching.
// Returns { type } or null if no keyword found.
export function parseSchedulingKeywords(subject) {
  if (!subject) return null;
  const lower = subject.toLowerCase();

  // Most specific intent first: "off" is a common word that also turns up in
  // swap and coverage wording ("swap my day off"), so it has to be checked last
  // or it swallows those requests.
  if (/\b(swap|switch|trade)\b/.test(lower)) {
    return { type: "SHIFT SWAP" };
  }
  if (/\b(cover|covering|coverage|need someone)\b/.test(lower)) {
    return { type: "COVERAGE REQUEST" };
  }
  // "ro" is the short form the registration email teaches ("RO july 28").
  if (/\b(off|ro)\b/.test(lower)) {
    // "time off" across more than one date is the multi-day TIME OFF type;
    // a single date (or none) is an ordinary REQUEST OFF.
    if (/\btime off\b/.test(lower) && extractDatesFromSubject(subject).length > 1) {
      return { type: "TIME OFF" };
    }
    return { type: "REQUEST OFF" };
  }

  return null;
}

const MONTH_INDEX = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// Extract any dates from a subject. Handles both numeric "8/14" / "8/14/26" and
// month-name "july 28" forms — the registration email tells staff to write the
// latter ("RO july 28"), so numeric-only parsing would leave those cards blank.
// Years are inferred: the reference year, rolled forward if the date would land
// more than ~2 months in the past (a request typed near year-end). Mirrors
// parseRailDates() in src/App.jsx. Returns sorted ISO dates, or [].
export function extractDatesFromSubject(subject, ref = new Date()) {
  if (!subject) return [];
  const s = String(subject);
  const refY = ref.getFullYear();
  const out = new Set();
  const push = (m, d, y) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return;
    const yr = y != null
      ? (y < 100 ? 2000 + y : y)
      : ((new Date(refY, m - 1, d) - ref) / 86400000 < -60 ? refY + 1 : refY);
    out.add(`${yr}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  };
  let mm;
  const numeric = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/g;
  while ((mm = numeric.exec(s))) push(Number(mm[1]), Number(mm[2]), mm[3] ? Number(mm[3]) : null);
  const named = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?/g;
  while ((mm = named.exec(s))) {
    const mi = MONTH_INDEX[mm[1].slice(0, 3).toLowerCase()];
    if (mi) push(mi, Number(mm[2]), mm[3] ? Number(mm[3]) : null);
  }
  return [...out].sort();
}

// Match sender email against registered staff's personal_email field.
// Returns staff row or null if no unique match.
export function matchStaffByEmail(senderEmail, staff) {
  if (!senderEmail) return null;
  const normalized = senderEmail.trim().toLowerCase();
  const matches = (staff || []).filter(
    (s) => s.personal_email && s.personal_email.trim().toLowerCase() === normalized
  );
  return matches.length === 1 ? matches[0] : null;
}
