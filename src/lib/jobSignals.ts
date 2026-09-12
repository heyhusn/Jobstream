import type { Seniority, VisaSponsorship } from "@/types/database";

/** Minor m13's seniority classifier labels — see migration 0025's `extract_job_signals()`. */
export const SENIORITY_LABEL: Record<Seniority, string> = {
  intern: "Intern",
  entry: "Entry-level",
  mid: "Mid-level",
  senior: "Senior",
  staff: "Staff/Principal",
  lead: "Lead",
  manager: "Manager",
  director: "Director",
  executive: "Executive",
};

export const SENIORITY_OPTIONS: Seniority[] = [
  "intern",
  "entry",
  "mid",
  "senior",
  "staff",
  "lead",
  "manager",
  "director",
  "executive",
];

/** Minor m12's visa signal — deliberately two states only; "not mentioned" renders nothing rather than a guess. */
export const VISA_LABEL: Record<VisaSponsorship, string> = {
  offered: "Mentions visa sponsorship",
  not_offered: "States no visa sponsorship",
};
