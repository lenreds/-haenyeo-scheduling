// Who one /api/send-schedule call emails. Pure — the handler does the I/O.
//
// test: the signed-in manager only (+ the company inbox when ticked). Nothing
//   else; the subject gets "[TEST]" in the handler.
// real: registered staff for the requested sections, narrowed to the ids
//   ticked in the dialog (addresses always from the DB), + the company inbox
//   when ticked, + ALWAYS a copy to the manager who pressed Send — whoever
//   sends a section sees exactly what went out, whether or not they're on that
//   section's roster. If their address is already on the list they get one
//   email, not two (sendToEach / splitRecipients dedupes by address).
//
// A real send with no staff and no company inbox is refused rather than sent
// to the sender alone: it would mark the section published when nobody on it
// was emailed.
//
// staff: [{ id, name, personal_email, section }]. me: the sender's address
// (from their JWT) or null. copy: the company inbox address or null.
// Returns { recipients: [{name,email}], senderCopy: email|null } or { error }.
export function scheduleRecipients({ test, me, staff = [], sections, recipientIds, copy = null }) {
  if (test) {
    if (!me) return { error: "couldn't find your sign-in email for the test" };
    const recipients = [{ name: "Test (you)", email: me }];
    if (copy) recipients.push({ name: "Company inbox", email: copy });
    return { recipients, senderCopy: null };
  }
  let list = staff;
  if (Array.isArray(sections) && sections.length) {
    const want = sections.map((s) => String(s).toLowerCase());
    list = list.filter((r) => want.includes(String(r.section || "").toLowerCase()));
  }
  if (Array.isArray(recipientIds)) {
    const ids = new Set(recipientIds.map(String));
    list = list.filter((r) => ids.has(String(r.id)));
  }
  const recipients = list.map((r) => ({ name: r.name, email: r.personal_email }));
  if (copy) recipients.push({ name: "Company inbox", email: copy });
  if (!recipients.length) {
    return { error: "nobody is ticked for this schedule, so nothing was sent — a publish has to reach at least one person on it. To see the email yourself, use Send test to me only" };
  }
  if (me) recipients.push({ name: "You (sender copy)", email: me });
  return { recipients, senderCopy: me || null };
}
