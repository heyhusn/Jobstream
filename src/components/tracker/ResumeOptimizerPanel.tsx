import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAsyncTask } from "@/hooks/useAsyncTask";
import { useAuth } from "@/hooks/useAuth";
import { useCreditBalance } from "@/hooks/useCreditBalance";
import {
  useInFlightResumeCheckTask,
  useInvalidateResumeCheck,
  useLatestResumeCheck,
  type ResumeOptimizerResult,
} from "@/hooks/useResumeOptimizer";
import type { ApplicationItem } from "@/hooks/useApplications";
import { TaskState } from "@/components/ui/TaskState";

interface Props {
  item: ApplicationItem;
}

/**
 * M10 from the roadmap: a parse-fidelity-adjacent check against one
 * specific posting. Deliberately no numeric "ATS score" anywhere in
 * here — see optimize-resume/prompt.ts for why. Just what the resume
 * shows for this posting's requirements, what it doesn't, and any
 * hard knockout requirements worth noticing before applying.
 */
export function ResumeOptimizerPanel({ item }: Props) {
  const jobId = item.job.id;
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: latest, isPending } = useLatestResumeCheck(jobId);
  const { data: credits } = useCreditBalance();
  const invalidate = useInvalidateResumeCheck(jobId);

  const { state: task, run, watch, reset } = useAsyncTask<
    Record<string, unknown>,
    ResumeOptimizerResult
  >("resume_optimize");

  const { data: inFlightTaskId } = useInFlightResumeCheckTask(jobId);
  const adoptedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!inFlightTaskId || adoptedRef.current === inFlightTaskId) return;
    if (task.phase !== "idle") return;
    adoptedRef.current = inFlightTaskId;
    watch(inFlightTaskId);
  }, [inFlightTaskId, task.phase, watch]);

  useEffect(() => {
    if (task.phase !== "done") return;
    adoptedRef.current = null;
    invalidate();
    qc.invalidateQueries({ queryKey: ["credit-balance", user?.id] });
  }, [task.phase, invalidate, qc, user?.id]);

  const busy = task.phase === "queued" || task.phase === "running";
  const outOfCredits = credits == null || credits.credits_remaining < 1;
  const result = task.phase === "done" ? task.result : latest ?? null;

  function check() {
    reset();
    run({ job_id: jobId });
  }

  return (
    <section className="border-t border-rule pt-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">Resume check</h3>
        {result && <p className="text-[11px] text-ink-70">{result.model}</p>}
      </div>

      {busy && (
        <TaskState
          phase={task.phase}
          queuedLabel="Queued — this takes a few seconds."
          runningLabel="Reading the posting against your resume…"
        />
      )}

      {task.phase === "failed" && (
        <div className="mb-3">
          <TaskState phase="failed" errorMessage={task.error} onRetry={check} />
        </div>
      )}

      {!busy && (
        <>
          {isPending && <div className="h-24 animate-pulse rounded-app bg-raised" />}

          {!isPending && !result && task.phase !== "failed" && (
            <div className="rounded-app border border-dashed border-rule bg-raised px-4 py-4">
              <p className="text-sm leading-relaxed text-ink-70">
                Checks your resume text against this specific posting — what it already shows,
                what it doesn't, and any hard requirements to notice before you apply. No
                invented score; real ATS platforms don't publish one either.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={check}
                  disabled={outOfCredits}
                  className="rounded-app border-[1.5px] border-ink bg-ink px-3.5 py-2 text-sm font-semibold text-paper transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Check my resume against this posting
                </button>
                <span className="text-xs text-ink-70">1 credit</span>
                {outOfCredits && (
                  <Link to="/settings/billing" className="text-xs text-ghost underline">
                    You're out of credits
                  </Link>
                )}
              </div>
            </div>
          )}

          {!isPending && result && <ResultView result={result} onRecheck={check} outOfCredits={outOfCredits} />}
        </>
      )}
    </section>
  );
}

function ResultView({
  result,
  onRecheck,
  outOfCredits,
}: {
  result: ResumeOptimizerResult;
  onRecheck: () => void;
  outOfCredits: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="space-y-4">
      {result.knockouts.length > 0 && (
        <div className="rounded-app border border-ghost/40 bg-ghost-wash px-3 py-2.5">
          <p className="mb-1 text-xs font-medium text-ghost">Hard requirements to notice</p>
          <ul className="space-y-1 text-sm leading-relaxed text-ink-70">
            {result.knockouts.map((k, i) => (
              <li key={i}>{k}</li>
            ))}
          </ul>
        </div>
      )}

      {result.gaps.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-70">
            What this posting asks for that isn't showing up
          </p>
          <ul className="space-y-2">
            {result.gaps.map((g, i) => (
              <li key={i} className="rounded-app border border-rule bg-raised px-3 py-2.5">
                <p className="text-sm font-medium">{g.requirement}</p>
                {g.why_it_matters && (
                  <p className="mt-0.5 text-xs text-ink-70">{g.why_it_matters}</p>
                )}
                {g.suggestion && (
                  <p className="mt-1 text-xs text-ink-70">
                    <span className="font-medium">If true of you:</span> {g.suggestion}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.matched.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-70">Already showing up</p>
          <ul className="space-y-1.5">
            {result.matched.map((m, i) => (
              <li key={i} className="text-sm text-ink-70">
                <span className="font-medium text-ink">{m.requirement}</span>
                {m.evidence && ` — ${m.evidence}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.gaps.length === 0 && result.matched.length === 0 && (
        <p className="text-sm text-ink-70">
          The model didn't find a clear match or gap to report against this posting.
        </p>
      )}

      <div>
        {confirming ? (
          <div role="alertdialog" aria-label="Re-check this posting?" className="rounded-app border border-rule bg-raised px-3 py-2.5">
            <p className="text-xs leading-relaxed text-ink-70">
              Re-checking replaces this result and costs another credit.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                ref={(el) => el?.focus()}
                onClick={() => {
                  setConfirming(false);
                  onRecheck();
                }}
                className="rounded-app border-[1.5px] border-ink bg-ink px-3 py-1 text-xs font-semibold text-paper"
              >
                Re-check
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-app px-3 py-1 text-xs text-ink-70 hover:text-ink"
              >
                Keep what I have
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={outOfCredits}
            className="rounded-app border border-rule px-3 py-1.5 text-sm font-medium text-ink-70 transition-colors hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            Re-check
          </button>
        )}
      </div>
    </div>
  );
}
