import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Building2, Clock, DollarSign, ExternalLink } from "lucide-react";
import { useSaveToTracker, useTrackedJobIds } from "@/hooks/useApplications";
import { money, relativeDays } from "@/lib/format";
import { STAGE_LABEL } from "@/lib/stages";
import { JobSignalBadges } from "@/components/jobs/JobSignalBadges";
import { BlockCompanyButton } from "@/components/jobs/BlockCompanyButton";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Stat } from "@/components/ui/Stat";
import type { RiskBand, Seniority, VisaSponsorship } from "@/types/database";

export interface JobResultJob {
  id: string;
  title: string;
  location: string | null;
  remote_type: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  apply_url: string;
  first_seen_at: string;
  repost_count: number;
  visa_sponsorship: VisaSponsorship | null;
  seniority: Seniority | null;
  tech_stack: string[];
  company: { id: string; canonical_name: string; domain: string | null } | null;
}

const RISK_TONE: Record<RiskBand, "live" | "neutral" | "ghost"> = {
  low: "live",
  medium: "neutral",
  high: "ghost",
};
const RISK_LABEL: Record<RiskBand, string> = {
  low: "Looks real",
  medium: "Worth a second look",
  high: "High ghost risk",
};

/**
 * The one job-result row shared by MatchesPage (score-driven) and
 * SearchPage (whole-board search) — each supplies its own header-right
 * content (a match-score ring vs. a "matched via" label) and its own
 * expanded-panel top content (score breakdown vs. the raw posting
 * description), since those two things genuinely differ between the
 * two features. Everything else — signals, tracked-stage notice,
 * actions, the stat sidebar — is identical and was duplicated before
 * this component existed.
 */
export function JobResultRow({
  job,
  riskBand,
  ghostReasons,
  headerRight,
  expandedTop,
}: {
  job: JobResultJob;
  riskBand: RiskBand | null;
  ghostReasons?: string[];
  headerRight: ReactNode;
  expandedTop?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { data: tracked } = useTrackedJobIds();
  const save = useSaveToTracker();

  const isTracked = tracked?.has(job.id) ?? false;
  const trackedStage = tracked?.get(job.id);

  return (
    <div className="border-b border-rule-soft last:border-b-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-1 py-4 text-left"
      >
        <Avatar name={job.company?.canonical_name ?? job.title} domain={job.company?.domain} className="mt-0.5" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{job.title}</span>
            {riskBand && <Badge tone={RISK_TONE[riskBand]}>{RISK_LABEL[riskBand]}</Badge>}
            {job.repost_count > 0 && <Badge tone="neutral">Reposted {job.repost_count}×</Badge>}
          </div>
          <div className="mt-0.5 truncate text-sm text-ink-45">
            {job.company?.canonical_name ?? "Unknown company"}
            {job.location ? ` — ${job.location}` : ""} —{" "}
            {money(job.salary_min, job.salary_max, job.salary_currency)} — First seen{" "}
            {relativeDays(job.first_seen_at, Date.now())}
          </div>
        </div>

        <div className="shrink-0 pt-0.5">{headerRight}</div>
      </button>

      {open && (
        <div className="mb-4 grid gap-4 md:grid-cols-[1fr_200px]">
          <div className="min-w-0 rounded-app border border-rule-soft bg-raised px-4 py-3">
            {expandedTop}

            {ghostReasons && ghostReasons.length > 0 && (
              <div className={expandedTop ? "mt-3 border-t border-rule-soft pt-3" : ""}>
                <p className="mb-1.5 text-xs font-medium text-ink-45">Ghost-risk signals</p>
                <ul className="space-y-1 text-sm text-ink-70">
                  {ghostReasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}

            {trackedStage && (
              <p className="mt-3 rounded-app border border-live/30 bg-live-wash px-3 py-2 text-xs text-live">
                You already have this tracked as <strong>{STAGE_LABEL[trackedStage]}</strong> — check
                the tracker before applying again.
              </p>
            )}

            <div className="mt-3">
              <JobSignalBadges
                jobId={job.id}
                seniority={job.seniority}
                visaSponsorship={job.visa_sponsorship}
                techStack={job.tech_stack}
                remoteType={job.remote_type}
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a
                href={job.apply_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-app border-[1.5px] border-ink px-3 py-1.5 text-sm font-semibold hover:bg-ink hover:text-paper"
              >
                <ExternalLink size={14} /> View posting
              </a>

              {job.company && (
                <Link
                  to={`/companies/${job.company.id}`}
                  className="inline-flex items-center gap-1.5 rounded-app border-[1.5px] border-rule px-3 py-1.5 text-sm font-medium text-ink-70 transition-colors hover:border-ink hover:text-ink"
                >
                  <Building2 size={14} /> View company
                </Link>
              )}

              {/* Saving is the funnel into the tracker, so it reads as
                  a state ("Saved to tracker") rather than resetting to
                  an inviting button the moment it succeeds. */}
              <button
                type="button"
                onClick={() => save.mutate(job.id)}
                disabled={isTracked || save.isPending}
                className={
                  "inline-flex items-center gap-1.5 rounded-app border-[1.5px] px-3 py-1.5 text-sm font-semibold transition-colors disabled:cursor-default " +
                  (isTracked
                    ? "border-live/40 bg-live-wash text-live"
                    : "border-rule text-ink-70 hover:border-ink hover:text-ink disabled:opacity-60")
                }
              >
                {isTracked ? "Saved to tracker" : save.isPending ? "Saving…" : "Save to tracker"}
              </button>

              {isTracked && (
                <Link to="/tracker" className="text-sm text-ink-45 underline hover:text-ink">
                  Open tracker
                </Link>
              )}

              {job.company && (
                <span className="ml-auto">
                  <BlockCompanyButton companyId={job.company.id} />
                </span>
              )}
            </div>

            {save.isError && (
              <p role="alert" className="mt-2 text-sm text-ghost">
                Couldn't save that one. Try again in a moment.
              </p>
            )}
          </div>

          <Card className="space-y-4">
            <Stat
              icon={<DollarSign size={16} />}
              label="Salary"
              value={money(job.salary_min, job.salary_max, job.salary_currency)}
            />
            {job.remote_type && (
              <Stat
                icon={<Building2 size={16} />}
                label="Arrangement"
                value={job.remote_type === "remote" ? "Remote" : job.remote_type === "hybrid" ? "Hybrid" : "On-site"}
              />
            )}
            <Stat
              icon={<Clock size={16} />}
              label="First seen"
              value={relativeDays(job.first_seen_at, Date.now()) ?? "—"}
            />
          </Card>
        </div>
      )}
    </div>
  );
}
