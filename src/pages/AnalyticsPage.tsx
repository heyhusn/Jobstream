import type { ReactNode } from "react";
import {
  useApplicationFunnel,
  useCreditUsage,
  useTrackedGhostExposure,
  useMatchScoreTrend,
  useInterviewProgress,
  type ExposureBand,
} from "@/hooks/useAnalytics";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { STAGES } from "@/lib/stages";

// Below this sample size a trend day is called out as thin rather
// than plotted as if it carried the same weight as a well-sampled
// one — same rule SalaryIntelligencePage applies to a thin currency
// (see its THIN_SAMPLE_THRESHOLD), just recalibrated: a single
// user's matches-per-day is naturally a much smaller number than a
// market-wide salary sample.
const THIN_TREND_THRESHOLD = 3;

const bandStyles: Record<ExposureBand, string> = {
  low: "bg-live-wash text-live",
  medium: "bg-rule text-ink-70",
  high: "bg-ghost-wash text-ghost",
  unknown: "bg-rule text-ink-45",
};
const bandLabel: Record<ExposureBand, string> = {
  low: "Looks real",
  medium: "Worth a second look",
  high: "High ghost risk",
  unknown: "Not yet scored",
};
const bandOrder: ExposureBand[] = ["low", "medium", "high", "unknown"];

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function SkeletonBlock({ className = "h-24" }: { className?: string }) {
  return <div className={`animate-pulse rounded-app bg-raised ${className}`} aria-hidden="true" />;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Market Analytics Dashboard (M21) — scoped as a PERSONAL activity
 * page for the signed-in user, not a global/admin surface (that's
 * the separate, not-yet-built M24 Admin Console). Every section
 * reads one of the `security_invoker` views from migration
 * 0018_user_analytics.sql, each already scoped to the caller by the
 * underlying table's own RLS — no new AI calls, no new writes, no
 * credit charge, the same category of feature as Company/Salary
 * Intelligence.
 *
 * Every section fails/empties independently: a user with
 * applications but zero interview sessions should still see their
 * pipeline and credit usage render normally.
 */
export function AnalyticsPage() {
  const funnel = useApplicationFunnel();
  const creditUsage = useCreditUsage();
  const ghostExposure = useTrackedGhostExposure();
  const scoreTrend = useMatchScoreTrend();
  const interviewProgress = useInterviewProgress();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Your analytics</h1>
        <p className="mt-1 text-sm text-ink-70">
          Your own activity only — pipeline, credit spend, ghost-risk exposure on jobs you're
          tracking, match score trend, and interview prep progress. Nothing here is aggregated
          across other users.
        </p>
      </div>

      <Section title="Your pipeline">
        <PipelineSection
          isPending={funnel.isPending}
          isError={funnel.isError}
          rows={funnel.data}
          onRetry={() => funnel.refetch()}
        />
      </Section>

      <Section title="Credit usage by feature">
        <CreditUsageSection
          isPending={creditUsage.isPending}
          isError={creditUsage.isError}
          rows={creditUsage.data}
          onRetry={() => creditUsage.refetch()}
        />
      </Section>

      <Section title="Ghost-risk exposure">
        <GhostExposureSection
          isPending={ghostExposure.isPending}
          isError={ghostExposure.isError}
          rows={ghostExposure.data}
          onRetry={() => ghostExposure.refetch()}
        />
      </Section>

      <Section title="Match score trend">
        <ScoreTrendSection
          isPending={scoreTrend.isPending}
          isError={scoreTrend.isError}
          rows={scoreTrend.data}
          onRetry={() => scoreTrend.refetch()}
        />
      </Section>

      <Section title="Interview prep">
        <InterviewProgressSection
          isPending={interviewProgress.isPending}
          isError={interviewProgress.isError}
          rows={interviewProgress.data}
          onRetry={() => interviewProgress.refetch()}
        />
      </Section>
    </div>
  );
}

// ── Pipeline ──────────────────────────────────────────────────────

function PipelineSection({
  isPending,
  isError,
  rows,
  onRetry,
}: {
  isPending: boolean;
  isError: boolean;
  rows: { stage: string; count: number }[] | undefined;
  onRetry: () => void;
}) {
  if (isPending) return <SkeletonBlock className="h-48" />;
  if (isError) return <ErrorState onRetry={onRetry} />;

  const countByStage = new Map((rows ?? []).map((r) => [r.stage, r.count]));
  const total = (rows ?? []).reduce((sum, r) => sum + r.count, 0);

  if (total === 0) {
    return (
      <EmptyState
        title="Nothing tracked yet"
        body="Save a job from Matches or add one to the tracker to start building your pipeline."
      />
    );
  }

  const maxCount = Math.max(1, ...STAGES.map((s) => countByStage.get(s.id) ?? 0));

  return (
    <div className="space-y-2.5 rounded-app border border-rule bg-raised px-4 py-4">
      {STAGES.map((stage) => {
        const count = countByStage.get(stage.id) ?? 0;
        const widthPct = count === 0 ? 0 : Math.max(4, Math.round((count / maxCount) * 100));
        return (
          <div key={stage.id} className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-sm text-ink-70">{stage.label}</span>
            <div className="h-5 flex-1 overflow-hidden rounded-app bg-rule">
              <div
                className={`h-full rounded-app ${count > 0 ? "bg-ink" : ""}`}
                style={{ width: `${widthPct}%` }}
              />
            </div>
            <span className="tabular w-8 shrink-0 text-right text-sm font-semibold">{count}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Credit usage ────────────────────────────────────────────────

function CreditUsageSection({
  isPending,
  isError,
  rows,
  onRetry,
}: {
  isPending: boolean;
  isError: boolean;
  rows: { feature: string; credits_used: number; times_used: number; last_used_at: string }[] | undefined;
  onRetry: () => void;
}) {
  if (isPending) return <SkeletonBlock className="h-32" />;
  if (isError) return <ErrorState onRetry={onRetry} />;

  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        title="No credits spent yet"
        body="Once you use an AI feature — a cover letter, the resume optimiser, interview prep — it'll show up here broken down by feature."
      />
    );
  }

  return (
    <div className="divide-y divide-rule-soft rounded-app border border-rule bg-raised px-4">
      {rows.map((row) => (
        <div key={row.feature} className="flex items-center justify-between gap-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{row.feature}</p>
            <p className="mt-0.5 text-xs text-ink-45">
              Last used {dateTimeFmt.format(new Date(row.last_used_at))}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="tabular text-sm font-semibold">{row.credits_used} credits</p>
            <p className="tabular text-xs text-ink-45">
              {row.times_used} {row.times_used === 1 ? "use" : "uses"}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Ghost-risk exposure ───────────────────────────────────────────

function GhostExposureSection({
  isPending,
  isError,
  rows,
  onRetry,
}: {
  isPending: boolean;
  isError: boolean;
  rows: { band: ExposureBand; count: number }[] | undefined;
  onRetry: () => void;
}) {
  if (isPending) return <SkeletonBlock className="h-20" />;
  if (isError) return <ErrorState onRetry={onRetry} />;

  const total = (rows ?? []).reduce((sum, r) => sum + r.count, 0);

  if (total === 0) {
    return (
      <EmptyState
        title="No tracked jobs yet"
        body="Ghost-risk exposure is computed over jobs you've saved or applied to — track a job to see how it breaks down."
      />
    );
  }

  const countByBand = new Map((rows ?? []).map((r) => [r.band, r.count]));

  return (
    <div className="rounded-app border border-rule bg-raised px-4 py-4">
      <div className="flex flex-wrap gap-2">
        {bandOrder.map((band) => {
          const count = countByBand.get(band) ?? 0;
          if (count === 0) return null;
          return (
            <span
              key={band}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${bandStyles[band]}`}
            >
              <span className="tabular font-semibold">{count}</span>
              {bandLabel[band]}
            </span>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-ink-45">
        Across every job you've saved or applied to, not just what's currently open.
      </p>
    </div>
  );
}

// ── Match score trend ─────────────────────────────────────────────

function ScoreTrendSection({
  isPending,
  isError,
  rows,
  onRetry,
}: {
  isPending: boolean;
  isError: boolean;
  rows: { day: string; avg_score: number; sample_size: number }[] | undefined;
  onRetry: () => void;
}) {
  if (isPending) return <SkeletonBlock className="h-32" />;
  if (isError) return <ErrorState onRetry={onRetry} />;

  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        title="No matches computed yet"
        body="This fills in once matches have been generated for your profile — each day shows the average score and how many matches it's based on."
      />
    );
  }

  const maxScore = Math.max(1, ...rows.map((r) => r.avg_score));

  return (
    <div className="space-y-2.5 rounded-app border border-rule bg-raised px-4 py-4">
      {rows.map((row) => {
        const thin = row.sample_size < THIN_TREND_THRESHOLD;
        const widthPct = Math.max(4, Math.round((row.avg_score / maxScore) * 100));
        return (
          <div key={row.day}>
            <div className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-sm text-ink-70">{dateFmt.format(new Date(row.day))}</span>
              <div className="h-5 flex-1 overflow-hidden rounded-app bg-rule">
                <div className="h-full rounded-app bg-ink" style={{ width: `${widthPct}%` }} />
              </div>
              <span className="tabular w-14 shrink-0 text-right text-sm font-semibold">
                {row.avg_score.toFixed(2)}
              </span>
            </div>
            <p className="ml-[calc(4rem+0.75rem)] mt-0.5 text-xs text-ink-45">
              {row.sample_size} {row.sample_size === 1 ? "match" : "matches"}
              {thin ? " — too few to read as a real trend" : ""}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ── Interview prep progress ────────────────────────────────────────

function InterviewProgressSection({
  isPending,
  isError,
  rows,
  onRetry,
}: {
  isPending: boolean;
  isError: boolean;
  rows:
    | { id: string; mode: string; turn_count: number; completed_at: string; avg_score: number | null }[]
    | undefined;
  onRetry: () => void;
}) {
  if (isPending) return <SkeletonBlock className="h-28" />;
  if (isError) return <ErrorState onRetry={onRetry} />;

  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        title="No completed interview sessions yet"
        body="Run an AI interview prep session from a tracked application's drawer — completed sessions and their scores will show up here."
      />
    );
  }

  return (
    <div className="divide-y divide-rule-soft rounded-app border border-rule bg-raised px-4">
      {rows.map((row) => (
        <div key={row.id} className="flex items-center justify-between gap-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium capitalize">{row.mode} interview</p>
            <p className="mt-0.5 text-xs text-ink-45">
              Completed {dateTimeFmt.format(new Date(row.completed_at))} · {row.turn_count}{" "}
              {row.turn_count === 1 ? "turn" : "turns"}
            </p>
          </div>
          <div className="shrink-0 text-right">
            {row.avg_score != null ? (
              <p className="tabular text-sm font-semibold">{row.avg_score.toFixed(1)} / 5</p>
            ) : (
              <p className="text-xs text-ink-45">No score</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
