import { useMemo, type ReactNode } from "react";
import {
  useApplicationFunnel,
  useCreditUsage,
  useTrackedGhostExposure,
  useMatchScoreTrend,
  useInterviewProgress,
  useResponseRateByCompany,
  useResponseRateBySource,
  useResponseRateByResumeVersion,
  usePlatformResponseRateBenchmark,
  useSkillDemandTrend,
  type ExposureBand,
  type ResponseRateRow,
} from "@/hooks/useAnalytics";
import { useApplications } from "@/hooks/useApplications";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { STAGES } from "@/lib/stages";

const MIN_RESPONSE_SAMPLE = 3;

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
  const { data: applications } = useApplications();
  const responseByCompany = useResponseRateByCompany();
  const responseBySource = useResponseRateBySource();
  const responseByResume = useResponseRateByResumeVersion();
  const benchmark = usePlatformResponseRateBenchmark();
  const skillDemand = useSkillDemandTrend();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Your analytics</h1>
        <p className="mt-1 text-sm text-ink-70">
          Your own activity only — pipeline, credit spend, ghost-risk exposure on jobs you're
          tracking, match score trend, and interview prep progress. Nothing here is aggregated
          across other users, except the one platform-wide median explicitly called out below.
        </p>
      </div>

      <Section title="This week">
        <WeeklyDigestSection applications={applications} />
      </Section>

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

      <Section title="Response rate">
        <ResponseRateSection
          byCompany={responseByCompany.data}
          bySource={responseBySource.data}
          byResume={responseByResume.data}
          isPending={responseByCompany.isPending}
          benchmark={benchmark.data}
        />
      </Section>

      <Section title="Skill demand">
        <SkillDemandSection isPending={skillDemand.isPending} rows={skillDemand.data} />
      </Section>
    </div>
  );
}

// ── Weekly digest (minor m27) ─────────────────────────────────────
// Computed on-demand from applications already loaded, not a
// scheduled email — no pg_cron and no email provider key exist in
// this codebase (see migration 0029's header), so "weekly" can only
// honestly mean "the last 7 days, whenever you look."

function WeeklyDigestSection({ applications }: { applications: ReturnType<typeof useApplications>["data"] }) {
  const stats = useMemo(() => {
    const now = Date.now();
    const DAY = 86_400_000;
    const all = applications ?? [];
    const inWindow = (iso: string | null, from: number, to: number) => {
      if (!iso) return false;
      const t = new Date(iso).getTime();
      return t >= from && t < to;
    };
    const thisWeekStart = now - 7 * DAY;
    const lastWeekStart = now - 14 * DAY;

    const appliedThisWeek = all.filter((a) => inWindow(a.applied_at, thisWeekStart, now)).length;
    const appliedLastWeek = all.filter((a) => inWindow(a.applied_at, lastWeekStart, thisWeekStart)).length;
    const respondedThisWeek = all.filter(
      (a) =>
        (a.stage === "interviewing" || a.stage === "offer" || a.stage === "rejected") &&
        inWindow(a.updated_at, thisWeekStart, now)
    ).length;

    return { appliedThisWeek, appliedLastWeek, respondedThisWeek };
  }, [applications]);

  if (!applications) return <SkeletonBlock className="h-20" />;

  return (
    <div className="flex flex-wrap gap-6 rounded-app border border-rule bg-raised px-4 py-4">
      <DigestStat label="Applied" value={stats.appliedThisWeek} compareTo={stats.appliedLastWeek} />
      <DigestStat label="Responses received" value={stats.respondedThisWeek} />
    </div>
  );
}

function DigestStat({ label, value, compareTo }: { label: string; value: number; compareTo?: number }) {
  return (
    <div>
      <p className="text-xs text-ink-45">{label}, last 7 days</p>
      <p className="tabular text-xl font-semibold">{value}</p>
      {compareTo != null && (
        <p className="text-xs text-ink-45">{compareTo} the week before</p>
      )}
    </div>
  );
}

// ── Response rate (minor m26 + m28) ───────────────────────────────

function rate(row: ResponseRateRow): number | null {
  return row.applied_count > 0 ? row.responded_count / row.applied_count : null;
}

function ResponseRateSection({
  byCompany,
  bySource,
  byResume,
  isPending,
  benchmark,
}: {
  byCompany: import("@/hooks/useAnalytics").ResponseRateByCompanyRow[] | undefined;
  bySource: import("@/hooks/useAnalytics").ResponseRateBySourceRow[] | undefined;
  byResume: import("@/hooks/useAnalytics").ResponseRateByResumeVersionRow[] | undefined;
  isPending: boolean;
  benchmark: { median_response_rate: number | null; contributing_users: number } | null | undefined;
}) {
  if (isPending) return <SkeletonBlock className="h-32" />;

  const totalApplied = (byCompany ?? []).reduce((s, r) => s + r.applied_count, 0);
  if (totalApplied === 0) {
    return (
      <EmptyState
        title="No applications yet"
        body="Response rate is computed once you've moved at least one job past 'Saved' to 'Applied'."
      />
    );
  }

  const overallResponded = (byCompany ?? []).reduce((s, r) => s + r.responded_count, 0);
  const overallRate = overallResponded / totalApplied;

  return (
    <div className="space-y-4">
      <div className="rounded-app border border-rule bg-raised px-4 py-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-ink-70">Your overall response rate</span>
          <span className="tabular text-lg font-semibold">{Math.round(overallRate * 100)}%</span>
        </div>
        {benchmark?.median_response_rate != null && (
          <p className="mt-1 text-xs text-ink-45">
            Platform median: {Math.round(benchmark.median_response_rate * 100)}% across{" "}
            {benchmark.contributing_users} {benchmark.contributing_users === 1 ? "user" : "users"}
            {benchmark.contributing_users < 5 ? " — too few to read as a reliable median" : ""}.
          </p>
        )}
      </div>

      <ResponseRateBreakdown
        title="By company"
        rows={(byCompany ?? []).map((r) => ({ label: r.canonical_name ?? "Unknown company", ...r }))}
      />
      <ResponseRateBreakdown
        title="By source"
        rows={(bySource ?? []).map((r) => ({ label: r.source, ...r }))}
      />
      <ResponseRateBreakdown
        title="By resume version"
        rows={(byResume ?? []).map((r) => ({
          label: `v${r.version}${r.track_name ? ` — ${r.track_name}` : ""}`,
          ...r,
        }))}
      />
    </div>
  );
}

function ResponseRateBreakdown({
  title,
  rows,
}: {
  title: string;
  rows: (ResponseRateRow & { label: string })[];
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium text-ink-70">{title}</h3>
      <div className="divide-y divide-rule-soft rounded-app border border-rule bg-raised px-4">
        {rows.map((r) => {
          const thin = r.applied_count < MIN_RESPONSE_SAMPLE;
          const pct = rate(r);
          return (
            <div key={r.label} className="flex items-center justify-between gap-4 py-2.5 text-sm">
              <span className="truncate">{r.label}</span>
              <span className="tabular shrink-0 text-ink-70">
                {pct != null ? `${Math.round(pct * 100)}%` : "—"} ({r.applied_count}{" "}
                {r.applied_count === 1 ? "app" : "apps"}
                {thin ? ", thin" : ""})
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Skill demand trendline (minor m30) ────────────────────────────

function SkillDemandSection({
  isPending,
  rows,
}: {
  isPending: boolean;
  rows: import("@/hooks/useAnalytics").SkillDemandRow[] | undefined;
}) {
  if (isPending) return <SkeletonBlock className="h-24" />;

  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        title="No demand data yet"
        body="This tracks how often your own profile skills show up in active postings' extracted tech tags — it fills in once your skills overlap with what's actually been recognized in the job board (see the skills list in Settings)."
      />
    );
  }

  const bySkill = new Map<string, { week: string; job_count: number }[]>();
  for (const r of rows) {
    if (!bySkill.has(r.skill)) bySkill.set(r.skill, []);
    bySkill.get(r.skill)!.push({ week: r.week, job_count: r.job_count });
  }

  return (
    <div className="space-y-3">
      {[...bySkill.entries()].map(([skill, points]) => {
        const total = points.reduce((s, p) => s + p.job_count, 0);
        return (
          <div key={skill} className="rounded-app border border-rule bg-raised px-4 py-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium capitalize">{skill}</span>
              <span className="text-xs text-ink-45">
                {total} active {total === 1 ? "posting" : "postings"} mention this, across{" "}
                {points.length} {points.length === 1 ? "week" : "weeks"}
              </span>
            </div>
          </div>
        );
      })}
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
