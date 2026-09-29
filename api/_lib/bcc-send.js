// One email per send, every recipient in Bcc (schedule + tip sheet emails).
//
// Staff never see each other's personal addresses: the message goes To the
// scheduling inbox itself (a valid To header) with everyone in Bcc. Gmail
// delivers to the Bcc list and drops the Bcc header from each delivered copy;
// only the Sent copy keeps it.
//
// Gmail rejects the whole message if any address is malformed, so addresses
// are checked first (splitRecipients) and bad ones are left out and reported
// back instead of sinking the send.
//
// The copy that lands in the scheduling inbox (it's the To) is moved out of
// the inbox and marked read — it stays in Sent under its label — so it never
// sits unread where the Rail poller reads staff requests.

import { sendMessage, modifyMessage, getProfileEmail } from "./google.js";
import { GMAIL_INBOX } from "./config.js";
import { splitRecipients } from "./reply.js";

export async function schedulingInboxAddress(accessToken) {
  return GMAIL_INBOX || (await getProfileEmail(accessToken));
}

// recipients: [{ name, email }]. buildRaw({ to, bcc }) returns the base64url
// message. Throws on a Gmail send error (nothing went out). Returns
// { sent: number of addresses delivered to, messages: 0|1, invalid: [{name,email}] }.
export async function sendOneBcc({ accessToken, recipients, buildRaw, labelId = null }) {
  const { valid, invalid } = splitRecipients(recipients);
  if (!valid.length) return { sent: 0, messages: 0, invalid };
  const to = await schedulingInboxAddress(accessToken);
  if (!to) throw new Error("couldn't determine the scheduling inbox address for the To line");
  const raw = buildRaw({ to, bcc: valid.map((r) => r.email) });
  const msg = await sendMessage(accessToken, { raw });
  if (msg?.id) {
    await modifyMessage(accessToken, msg.id, {
      addLabelIds: labelId ? [labelId] : [],
      removeLabelIds: ["INBOX", "UNREAD"],
    }).catch(() => { /* labels are cosmetic; the send already happened */ });
  }
  return { sent: valid.length, messages: 1, invalid, rawBytes: raw.length };
}
