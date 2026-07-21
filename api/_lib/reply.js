// Pure helpers for composing the staff auto-reply: per-type templates + an
// RFC 822 builder. No I/O — unit-testable.

// Default sentences when the manager leaves the note blank, keyed by
// "TYPE|approved". The manager's note, if provided, replaces these.
const DEFAULT_LINE = {
  "REQUEST OFF|true": "Enjoy your day off!",
  "REQUEST OFF|false": "Please reach out if you have any questions.",
  "SHIFT SWAP|true": "The schedule has been updated accordingly.",
  "SHIFT SWAP|false": "Please reach out if you have any questions.",
  "COVERAGE REQUEST|true": "We'll find coverage for your shift.",
  "COVERAGE REQUEST|false": "Please reach out if you have any questions.",
};

const PHRASE = {
  "REQUEST OFF": "time off request",
  "SHIFT SWAP": "shift swap request",
  "COVERAGE REQUEST": "coverage request",
};

// Build the reply body text for a given request + decision.
export function buildReplyBody({ type, approved, name, date, note }) {
  const phrase = PHRASE[type] || "request";
  const outcome = approved ? "has been approved" : "has been denied";
  const lead = approved ? "" : "unfortunately ";
  const tail = (note && note.trim()) || DEFAULT_LINE[`${type}|${approved}`] || "";
  return `Hi ${name}, ${lead}your ${phrase} for ${date} ${outcome}. ${tail}\n— Haenyeo Management`;
}

// RFC 2047 encoded-word for a Subject that contains non-ASCII (e.g. en-dash).
function encodeSubject(s) {
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

function toBase64Url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Assemble a base64url-encoded RFC 822 message for Gmail's send API. Body is
// base64 with an explicit charset so em-dashes render correctly. `From` is
// implicit (the authenticated account).
export function buildRawEmail({ to, subject, inReplyTo, body }) {
  const headers = [
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  if (inReplyTo) {
    headers.push(`In-Reply-To: ${inReplyTo}`);
    headers.push(`References: ${inReplyTo}`);
  }
  const encodedBody = Buffer.from(body, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  const raw = `${headers.join("\r\n")}\r\n\r\n${encodedBody}`;
  return toBase64Url(Buffer.from(raw, "utf8"));
}
