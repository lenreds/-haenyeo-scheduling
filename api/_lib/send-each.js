// One email PER RECIPIENT (schedule + tip sheet emails).
//
// Each recipient gets their own message addressed only to them, so nobody sees
// anyone else's address and each send stands alone: a bounce or rejection for
// one person can't take the others down with it. (A single message Bcc'd to the
// whole staff looks like bulk mail coming from a consumer Gmail account.)
//
// Addresses are still checked first (splitRecipients): a malformed one is left
// out and reported back rather than attempted.
//
// Every sent copy is tagged with its label and kept out of the scheduling
// inbox (INBOX/UNREAD removed) — a copy addressed to the scheduling inbox
// itself would otherwise sit unread where the Rail poller reads requests.

import { sendMessage, modifyMessage } from "./google.js";
import { splitRecipients } from "./reply.js";

// recipients: [{ name, email }]. buildRaw(to) returns the base64url message for
// one recipient. Returns { sent, attempted, invalid: [{name,email}],
// failures: ["Name: reason"] } — and error when nothing at all went out.
export async function sendToEach({ accessToken, recipients, buildRaw, labelId = null }) {
  const { valid, invalid } = splitRecipients(recipients);
  let sent = 0;
  const failures = [];
  for (const r of valid) {
    try {
      const msg = await sendMessage(accessToken, { raw: buildRaw(r.email) });
      sent++;
      if (msg?.id) {
        await modifyMessage(accessToken, msg.id, {
          addLabelIds: labelId ? [labelId] : [],
          removeLabelIds: ["INBOX", "UNREAD"],
        }).catch(() => { /* labels are cosmetic; the send already happened */ });
      }
    } catch (e) {
      failures.push(`${r.name || r.email}: ${e.message}`);
    }
  }
  const out = { sent, attempted: valid.length, invalid, failures };
  if (!valid.length) out.error = "no valid email addresses to send to";
  else if (!sent) out.error = `none of the emails went out — ${failures[0] || "unknown error"}`;
  return out;
}
