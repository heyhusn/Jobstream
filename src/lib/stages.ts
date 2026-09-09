import type { ApplicationStage } from "@/types/database";

/**
 * The pipeline, in the order it actually happens. This array is the
 * single source of truth for column order, the drawer's stage
 * select, and the funnel counts — add a stage to the DB check
 * constraint and to this array and everything downstream follows.
 */
export const STAGES: {
  id: ApplicationStage;
  label: string;
  /** Terminal stages are rendered muted; they're an archive, not a queue. */
  terminal: boolean;
  /** Copy for the column's empty drop zone. */
  emptyHint: string;
}[] = [
  {
    id: "saved",
    label: "Saved",
    terminal: false,
    emptyHint: "Jobs you've saved from Matches land here.",
  },
  {
    id: "applied",
    label: "Applied",
    terminal: false,
    emptyHint: "Move a card here when you've sent the application.",
  },
  {
    id: "interviewing",
    label: "Interviewing",
    terminal: false,
    emptyHint: "Phone screens, take-homes, onsites.",
  },
  { id: "offer", label: "Offer", terminal: false, emptyHint: "The reason you're doing this." },
  { id: "rejected", label: "Rejected", terminal: true, emptyHint: "No's, kept for the record." },
  { id: "withdrawn", label: "Withdrawn", terminal: true, emptyHint: "Ones you pulled out of." },
];

export const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.id, s.label])) as Record<
  ApplicationStage,
  string
>;

export const STAGE_IDS = STAGES.map((s) => s.id);

export function isStageId(value: string): value is ApplicationStage {
  return (STAGE_IDS as string[]).includes(value);
}
