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
