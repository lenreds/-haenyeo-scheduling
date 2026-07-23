// Pure helpers for composing the staff auto-reply: per-type templates + an
// RFC 822 builder. No I/O — unit-testable.

// Default sentences when the manager leaves the note blank, keyed by
// "TYPE|approved". The manager's note, if provided, replaces these.
// Warm, human approve/deny copy (UI-IMPROVEMENTS-BRIEF item 1). Approved: an
// optional manager note goes on its own line, no default. Denied: the note (or
// a per-type default) trails the sentence on the same line.
const APPROVED_LEAD = {
  "REQUEST OFF": (d) => `we got your request and you're all set — ${d} is yours. Enjoy the time off!`,
  "SHIFT SWAP": (d) => `the swap is confirmed for ${d} — the schedule's been updated. Thanks for coordinating!`,
  "COVERAGE REQUEST": (d) => `got it — we'll get coverage sorted for ${d}. Thanks for the heads up!`,
  "TIME OFF": (d) => `your time off for ${d} is approved — you're all set. Enjoy!`,
};
const DENIED_LEAD = {
  "REQUEST OFF": (d) => `unfortunately we can't approve the time off for ${d} this time around.`,
  "SHIFT SWAP": (d) => `we weren't able to approve the swap for ${d}.`,
  "COVERAGE REQUEST": (d) => `we can't approve the coverage request for ${d} right now.`,
  "TIME OFF": (d) => `unfortunately we can't approve the time off for ${d} this time.`,
};
const DENIED_DEFAULT = {
  "REQUEST OFF": "Reach out if you'd like to talk through it.",
  "SHIFT SWAP": "Feel free to reach out if you have questions.",
  "COVERAGE REQUEST": "Please reach out directly if this is urgent.",
  "TIME OFF": "Feel free to reach out if you'd like to discuss.",
};

// Build the reply body text for a given request + decision. `partial` +
// `approvedDates` apply only to a partially-approved TIME OFF.
export function buildReplyBody({ type, approved, partial, name, date, approvedDates, note }) {
  const sig = "\n— Haenyeo Management";
  const cleanNote = note && note.trim();
  const key = APPROVED_LEAD[type] ? type : "REQUEST OFF";

  if (type === "TIME OFF" && approved && partial) {
    const lead = `we were able to approve part of your time off request. Approved dates: ${approvedDates}.`;
    return `Hi ${name}, ${lead}${cleanNote ? " " + cleanNote : ""}${sig}`;
  }
  if (approved) {
    // note on its own line, only when provided
    return `Hi ${name}, ${APPROVED_LEAD[key](date)}${cleanNote ? "\n" + cleanNote : ""}${sig}`;
  }
  const tail = cleanNote || DENIED_DEFAULT[key];
  return `Hi ${name}, ${DENIED_LEAD[key](date)}${tail ? " " + tail : ""}${sig}`;
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

const wrap76 = (b64) => b64.replace(/(.{76})/g, "$1\r\n");

// Strip anything that could break out of a MIME header (CR/LF/quotes).
const sanitizeFilename = (name) => String(name || "file").replace(/[\r\n"\\]/g, "").slice(0, 200);

// HTML email with a plain-text alternative and inline CID images (Gmail blocks
// data: URIs in HTML bodies, so the logo travels as a multipart/related part
// referenced via <img src="cid:...">). images: [{ cid, b64, mime? }].
// attachments: [{ filename, b64, mime? }] — downloadable files (e.g. PDFs).
// Structure without attachments: multipart/related( alternative(text,html), images… ).
// With attachments: multipart/mixed( <that related part>, attachment parts… ).
export function buildHtmlRawEmail({ to, subject, text, html, images = [], attachments = [] }) {
  const rel = "haenyeo-rel-8f3a1c";
  const alt = "haenyeo-alt-8f3a1c";
  const mixed = "haenyeo-mix-8f3a1c";
  const altPart = [
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(Buffer.from(text, "utf8").toString("base64")),
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(Buffer.from(html, "utf8").toString("base64")),
    `--${alt}--`,
  ].join("\r\n");
  const imageParts = images
    .map((img) =>
      [
        `--${rel}`,
        `Content-Type: ${img.mime || "image/png"}`,
        "Content-Transfer-Encoding: base64",
        `Content-ID: <${img.cid}>`,
        `Content-Disposition: inline; filename="${img.cid}.png"`,
        "",
        wrap76(img.b64),
      ].join("\r\n")
    )
    .join("\r\n");
  // The multipart/related block (its own Content-Type header + body), reused
  // whether or not there are attachments.
  const relatedLines = [
    `Content-Type: multipart/related; boundary="${rel}"`,
    "",
    `--${rel}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    altPart,
    imageParts,
    `--${rel}--`,
  ];
  const headers = [`To: ${to}`, `Subject: ${encodeSubject(subject)}`, "MIME-Version: 1.0"];

  const atts = (attachments || []).filter((a) => a && a.b64);
  let raw;
  if (!atts.length) {
    raw = [...headers, ...relatedLines, ""].join("\r\n");
  } else {
    const attachParts = atts.map((a) => {
      const name = sanitizeFilename(a.filename);
      return [
        `--${mixed}`,
        `Content-Type: ${a.mime || "application/pdf"}; name="${name}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${name}"`,
        "",
        wrap76(a.b64),
      ].join("\r\n");
    });
    raw = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${mixed}"`,
      "",
      `--${mixed}`,
      ...relatedLines,
      ...attachParts,
      `--${mixed}--`,
      "",
    ].join("\r\n");
  }
  return toBase64Url(Buffer.from(raw, "utf8"));
}
