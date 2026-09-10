import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useAsyncTask } from "@/hooks/useAsyncTask";
import { useCreditBalance } from "@/hooks/useCreditBalance";
import { useLatestSkillGap, useInvalidateSkillGap, type SkillGapTaskResult } from "@/hooks/useSkillGap";
import { Button } from "@/components/ui/Button";
import { TaskState } from "@/components/ui/TaskState";
import { EmptyState } from "@/components/ui/EmptyState";

/**
 * M12 from the roadmap: aggregate the skills your target postings
 * ask for, diff against your profile, rank the gaps. Grounded in
 * your own highest-scored matches — recompute matches first for a
 * result that reflects what you're actually aiming at, not just
 * whatever's newest in the database.
 */
export function SkillsPage() {
  const { data: latest, isPending } = useLatestSkillGap();
  const { data: credits } = useCreditBalance();
  const invalidate = useInvalidateSkillGap();

  const { state: task, run, reset } = useAsyncTask<Record<string, unknown>, SkillGapTaskResult>(
    "skill_gap"
  );

  useEffect(() => {
    if (task.phase !== "done") return;
    invalidate();
  }, [task.phase, invalidate]);

  const busy = task.phase === "queued" || task.phase === "running";
  const outOfCredits = credits == null || credits.credits_remaining < 1;
  const result = task.phase === "done" ? task.result : latest?.result ?? null;

  function analyze() {
    reset();
    run({});
  }

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Skill gaps</h1>
          <p className="mt-1 text-sm text-ink-70">
            What your target postings ask for that isn't on your profile yet.
          </p>
        </div>
        {!busy && (
          <div className="flex flex-col items-end gap-1">
            <Button variant={result ? "ghost" : "solid"} onClick={analyze} disabled={outOfCredits}>
              {result ? "Refresh analysis" : "Analyze my skill gaps"}
            </Button>
            <span className="text-xs text-ink-70">1 credit</span>
          </div>
        )}
      </div>

      {busy && (
        <TaskState
          phase={task.phase}
          queuedLabel="Queued — this takes a few seconds."
          runningLabel="Reading your target postings…"
        />
      )}

      {!busy && task.phase === "failed" && (
        <div className="mb-4">
          <TaskState phase="failed" errorMessage={task.error} onRetry={analyze} />
        </div>
      )}

      {outOfCredits && !busy && (
        <p className="mb-4 text-xs text-ghost">
          You're out of credits for this month.{" "}
          <Link to="/settings/billing" className="underline">
            See billing
          </Link>
          .
        </p>
      )}

      {!busy && isPending && !result && (
        <div className="space-y-2" aria-hidden="true">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-app bg-raised" />
          ))}
        </div>
      )}

      {!busy && !isPending && !result && task.phase !== "failed" && (
        <EmptyState
          title="No analysis yet"
          body="Run it once your matches are up to date — it's grounded in your highest-scored postings, so recomputing matches first gives you a better read."
        />
      )}

      {!busy && result && <SkillGapResultView result={result} />}
    </div>
  );
}

function SkillGapResultView({ result }: { result: SkillGapTaskResult }) {
  return (
    <div className="space-y-6">
      {result.narrative && (
        <p className="rounded-app border border-rule bg-raised px-4 py-3 text-sm leading-relaxed text-ink-70">
          {result.narrative}
        </p>
      )}

      <p className="text-xs text-ink-70">
        Based on {result.jobs_considered} of your target postings.
      </p>

      {result.gaps.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Gaps, most in-demand first</h2>
          <ul className="space-y-2">
            {result.gaps.map((gap) => (
              <li key={gap.skill} className="rounded-app border border-rule bg-raised px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold">{gap.skill}</span>
                  <span className="text-xs text-ink-70">
                    in {gap.mentioned_in} of {result.jobs_considered} postings
                  </span>
                </div>
                {gap.why_it_matters && (
                  <p className="mt-1 text-sm leading-relaxed text-ink-70">{gap.why_it_matters}</p>
                )}
                {gap.resource && (
                  <p className="mt-1.5 text-xs text-ink-70">
                    <span className="font-medium">Next step:</span> {gap.resource}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.strengths.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Already covered, and still in demand</h2>
          <div className="flex flex-wrap gap-1.5">
            {result.strengths.map((s) => (
              <span
                key={s}
                className="rounded-app border border-rule bg-raised px-2.5 py-1 text-xs font-medium text-ink-70"
              >
                {s}
              </span>
            ))}
          </div>
        </section>
      )}

      {result.gaps.length === 0 && result.strengths.length === 0 && !result.narrative && (
        <p className="text-sm text-ink-70">
          The model didn't find a clear gap or strength to report from these postings.
        </p>
      )}
    </div>
  );
}
