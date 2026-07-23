// Plain-text email builders for the standalone (non-reply) send flows: welcome,
// name-not-matched, weekly schedule publish, and finalized tip sheet. Each
// returns { subject, body }. Pure — no I/O.

const SIG = "— Haenyeo Management";

export function buildWelcomeEmail(name) {
  const subject = "You're registered — here's how scheduling works at Haenyeo";
  const body =
`Hi ${name}, you're all set on the Haenyeo scheduling system! From now on, your weekly schedule will come straight to this email.

To send any scheduling requests, email haenyeo.schedule@gmail.com using these subject line formats:

Single day off: [SCHEDULING] – REQUEST OFF – [Your Name] – [Date]
Consecutive time off: [SCHEDULING] – TIME OFF – [Your Name] – Jul 28 to Aug 4
Non-consecutive days: [SCHEDULING] – TIME OFF – [Your Name] – Jul 28, Jul 30, Aug 2
Shift swap: [SCHEDULING] – SHIFT SWAP – [Your Name] – [Date] (mention who you're swapping with in the body)
Coverage needed: [SCHEDULING] – COVERAGE REQUEST – [Your Name] – [Date]

You'll hear back once your request is reviewed. If your contact info ever changes, scan the "Update My Info" QR code posted at the restaurant.

${SIG}`;
  return { subject, body };
}

export function buildNameNotMatchedReply(rawName) {
  const subject = "We couldn't find your name — please try again";
  const body =
`Hi,

We received your registration but couldn't match "${rawName}" to anyone on the staff list. Please double-check the spelling of your name (use the name management has on file) and send the registration email again.

${SIG}`;
  return { subject, body };
}

// weekLabel: "Jun 29 – Jul 5"; dayHeaders: 7 short labels ("Mon 6/29");
// Flat FOH schedule: rows = [{ name, shifts: [7 labels] }]. For BOH+Kitchen pass
// `groups` = [{ label, rows }] (rendered with a divider) and `sectionLabel`
// ("BOH & Kitchen") which also tags the subject.
export function buildScheduleEmail({ weekLabel, dayHeaders, rows, groups, sectionLabel }) {
  const subject = sectionLabel
    ? `Haenyeo Schedule — ${sectionLabel} — Week of ${weekLabel}`
    : `Haenyeo Schedule — Week of ${weekLabel}`;
  const renderPeople = (people) =>
    (people || [])
      .map((r) => `${r.name}\n${(r.shifts || []).map((s, i) => `  ${dayHeaders[i]}: ${s || "Off"}`).join("\n")}`)
      .join("\n\n");
  const bodyMain = groups
    ? groups.map((g) => `${g.label}\n${"—".repeat(24)}\n${renderPeople(g.rows)}`).join("\n\n\n")
    : renderPeople(rows);
  const heading = sectionLabel ? `Haenyeo — ${sectionLabel} schedule` : "Haenyeo — Front of House schedule";
  const body = `${heading}\nWeek of ${weekLabel}\n\n${bodyMain}\n\n${SIG}`;
  return { subject, body };
}

// Manual Rail entry ("+ Add Request"): paper-trail copy to the scheduling
// inbox. type is the canonical uppercase rail type ("REQUEST OFF" etc.).
export function buildManualEntryInboxEmail({ managerName, staffName, type, dates, note }) {
  const subject = `[MANUAL ENTRY] – ${type} – ${staffName} – ${dates}`;
  const body =
`A scheduling request was manually logged by ${managerName}.

Staff: ${staffName}
Type: ${type}
Dates: ${dates}${note ? `\nNote: ${note}` : ""}

This entry is now pending in the Rail.
${SIG}`;
  return { subject, body };
}

// Manual Rail entry: confirmation to the staff member (registered only).
export function buildManualEntryStaffEmail({ staffName, type, dates, note }) {
  const subject = "Your scheduling request has been logged";
  const body =
`Hi ${staffName}, just confirming that your ${String(type || "").toLowerCase()} request for ${dates} has been logged in the system. You'll hear back once it's been reviewed.

${note ? `${note}\n\n` : ""}${SIG}`;
  return { subject, body };
}

// dayDateLabel: "Thursday, Jul 24"; rows: [{ name, position, points, hours, final }];
// recipientName/recipientPayout personalize the highlighted line per email.
export function buildTipSheetEmail({ dayDateLabel, floorPool, rows, barTipOut, barRecipients, floorCheckText, recipientName, recipientPayout }) {
  const subject = `Haenyeo Tip Sheet — ${dayDateLabel}`;
  const workerLines = (rows || [])
    .map((r) => `  ${r.name} — ${r.position}: ${r.points} pts, ${r.hours} hrs → $${r.final}`)
    .join("\n");
  const body =
`Haenyeo Tip Sheet — ${dayDateLabel}

YOUR PAYOUT: $${recipientPayout}
(${recipientName})

Floor pool (cash + CC): $${floorPool}

Breakdown:
${workerLines}

Bar tip-out: $${barTipOut}${barRecipients ? ` (split among ${barRecipients})` : ""}
${floorCheckText}

${SIG}`;
  return { subject, body };
}
