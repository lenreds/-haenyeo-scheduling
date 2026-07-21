// Plain-text email builders for the standalone (non-reply) send flows: welcome,
// name-not-matched, weekly schedule publish, and finalized tip sheet. Each
// returns { subject, body }. Pure — no I/O.

const SIG = "— Haenyeo Management";

export function buildWelcomeEmail(name) {
  const subject = "You're registered — here's how scheduling works at Haenyeo";
  const body =
`Hi ${name},

You're all set on the Haenyeo scheduling system. From now on, the weekly schedule will be sent directly to this email every week.

For any scheduling requests, email haenyeo.schedule@gmail.com with the subject line in exactly this format:

SINGLE DAY OFF:
[SCHEDULING] – REQUEST OFF – [Your Name] – [Date]

CONSECUTIVE TIME OFF (date range):
[SCHEDULING] – TIME OFF – [Your Name] – Jul 28 to Aug 4

NON-CONSECUTIVE DAYS OFF (specific dates):
[SCHEDULING] – TIME OFF – [Your Name] – Jul 28, Jul 30, Aug 2

SHIFT SWAP:
[SCHEDULING] – SHIFT SWAP – [Your Name] – [Date]
(In the body, mention who you're swapping with: "swapping with Reiko")

COVERAGE NEEDED:
[SCHEDULING] – COVERAGE REQUEST – [Your Name] – [Date]

You'll receive a reply once your request has been reviewed by management.

If your email or phone number ever changes, scan the "Update My Info" QR code posted in the restaurant and follow the same steps.

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
// rows: [{ name, shifts: [7 shift labels] }].
export function buildScheduleEmail({ weekLabel, dayHeaders, rows }) {
  const subject = `Haenyeo Schedule — Week of ${weekLabel}`;
  const lines = (rows || []).map((r) => {
    const days = (r.shifts || []).map((s, i) => `  ${dayHeaders[i]}: ${s || "Off"}`).join("\n");
    return `${r.name}\n${days}`;
  });
  const body =
`Haenyeo — Front of House schedule
Week of ${weekLabel}

${lines.join("\n\n")}

${SIG}`;
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
