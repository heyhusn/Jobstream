/**
 * Minor m21: a follow-up email generator keyed to days since
 * application. Deliberately template-based, not AI-generated — this
 * app already has a real credit-charging generation pattern
 * (generate-cover-letter and its siblings) for cases that genuinely
 * need a model; a short, generic follow-up note doesn't, and adding
 * a new Edge Function + task type + credit charge for one template
 * would be disproportionate for a minor feature. The tone shifts
 * with elapsed time — a first nudge reads differently from a third
 * one — which is the actual "keyed to days since application" part
 * of the roadmap's spec.
 */
export function followUpEmail(params: {
  jobTitle: string;
  company: string;
  daysSinceApplied: number;
}): { subject: string; body: string } {
  const { jobTitle, company, daysSinceApplied } = params;
  const subject = `Following up: ${jobTitle} application`;

  if (daysSinceApplied <= 10) {
    return {
      subject,
      body: `Hi,\n\nI applied for the ${jobTitle} role at ${company} ${daysSinceApplied} days ago and wanted to check in on where things stand. I'm still very interested and happy to share anything else that would help.\n\nThanks for your time,\n`,
    };
  }
  if (daysSinceApplied <= 21) {
    return {
      subject,
      body: `Hi,\n\nI wanted to follow up again on my application for the ${jobTitle} role, submitted ${daysSinceApplied} days ago. I understand hiring can take time — I remain genuinely interested and wanted to reconfirm that before assuming otherwise.\n\nIf it's helpful, I'm glad to answer any questions or provide additional materials.\n\nThanks,\n`,
    };
  }
  return {
    subject,
    body: `Hi,\n\nIt's been ${daysSinceApplied} days since I applied for the ${jobTitle} role at ${company}. I know priorities shift, so no worries if the role has moved on — I'd just appreciate knowing either way so I can plan accordingly.\n\nThanks for your time,\n`,
  };
}
