import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAsyncTask } from "@/hooks/useAsyncTask";
import { useAuth } from "@/hooks/useAuth";
import { useCreditBalance } from "@/hooks/useCreditBalance";
import {
  useInFlightResumeTailorTask,
  useInvalidateResumeTailor,
  useLatestResumeTailor,
  type ResumeRewrite,
  type ResumeTailorResult,
} from "@/hooks/useResumeTailor";
import type { ApplicationItem } from "@/hooks/useApplications";
import { TaskState } from "@/components/ui/TaskState";

interface Props {
  item: ApplicationItem;
}

/**
 * Rewrites the resume's *existing* bullets to mirror this posting's
 * language — never adds a skill, tool, or achievement the resume
 * doesn't already state. Complementary to ResumeOptimizerPanel (M10),
 * which only diagnoses matched/gap/knockout requirements and never
 * rewrites anything; this is the rewrite half. Anything the posting
 * asks for that nothing in the resume supports comes back in
 * `not_addressed` instead of a fabricated bullet.
 */
export function ResumeTailorPanel({ item }: Props) {
  const jobId = item.job.id;
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: latest, isPending } = useLatestResumeTailor(jobId);
  const { data: credits } = useCreditBalance();
  const invalidate = useInvalidateResumeTailor(jobId);

  const { state: task, run, watch, reset } = useAsyncTask<
    Record<string, unknown>,
    ResumeTailorResult
  >("tailor_resume");

  const { data: inFlightTaskId } = useInFlightResumeTailorTask(jobId);
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

  function tailor() {
    reset();
    run({ job_id: jobId });
  }

  return (
    <section className="border-t border-rule pt-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">Tailor my resume</h3>
        {result && <p className="text-[11px] text-ink-70">{result.model}</p>}
      </div>

      {busy && (
        <TaskState
          phase={task.phase}
          queuedLabel="Queued — this takes a few seconds."
          runningLabel="Rewriting bullets to mirror this posting…"
        />
      )}

      {task.phase === "failed" && (
        <div className="mb-3">
          <TaskState phase="failed" errorMessage={task.error} onRetry={tailor} />
        </div>
      )}

      {!busy && (
        <>
          {isPending && <div className="h-24 animate-pulse rounded-app bg-raised" />}

          {!isPending && !result && task.phase !== "failed" && (
            <div className="rounded-app border border-dashed border-rule bg-raised px-4 py-4">
              <p className="text-sm leading-relaxed text-ink-70">
                Rewrites your existing resume bullets to mirror this posting's own language —
                only rephrasing what you've already done, never inventing a skill or achievement
                you haven't listed. Anything the posting asks for that your resume doesn't
                support is flagged, not papered over.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={tailor}
                  disabled={outOfCredits}
                  className="rounded-app border-[1.5px] border-ink bg-ink px-3.5 py-2 text-sm font-semibold text-paper transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Tailor my resume for this posting
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

          {!isPending && result && (
            <ResultView result={result} onRetailor={tailor} outOfCredits={outOfCredits} />
          )}
        </>
      )}
    </section>
  );
}

function ResultView({
  result,
  onRetailor,
  outOfCredits,
}: {
  result: ResumeTailorResult;
  onRetailor: () => void;
  outOfCredits: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="space-y-4">
      {result.rewrites.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-70">Suggested rewrites</p>
          <ul className="space-y-2">
            {result.rewrites.map((r, i) => (
              <RewriteCard key={i} rewrite={r} />
            ))}
          </ul>
        </div>
      )}

      {result.not_addressed.length > 0 && (
        <div className="rounded-app border border-ghost/40 bg-ghost-wash px-3 py-2.5">
          <p className="mb-1 text-xs font-medium text-ghost">
            Not addressed — nothing in your resume supports these
          </p>
          <ul className="space-y-1 text-sm leading-relaxed text-ink-70">
            {result.not_addressed.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      {result.rewrites.length === 0 && result.not_addressed.length === 0 && (
        <p className="text-sm text-ink-70">
          The model didn't find a bullet worth rewriting for this posting.
        </p>
      )}

      <div>
        {confirming ? (
          <div role="alertdialog" aria-label="Re-tailor this posting?" className="rounded-app border border-rule bg-raised px-3 py-2.5">
            <p className="text-xs leading-relaxed text-ink-70">
              Re-tailoring replaces this result and costs another credit.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                ref={(el) => el?.focus()}
                onClick={() => {
                  setConfirming(false);
                  onRetailor();
                }}
                className="rounded-app border-[1.5px] border-ink bg-ink px-3 py-1 text-xs font-semibold text-paper"
              >
                Re-tailor
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
            Re-tailor
          </button>
        )}
      </div>
    </div>
  );
}

function RewriteCard({ rewrite }: { rewrite: ResumeRewrite }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(rewrite.tailored);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can fail silently (permissions, insecure
      // context) — nothing useful to do beyond not crashing.
    }
  }

  return (
    <li className="rounded-app border border-rule bg-raised px-3 py-2.5">
      <p className="text-xs text-ink-70 line-through decoration-ink-70/40">{rewrite.original}</p>
      <div className="mt-1 flex items-start justify-between gap-3">
        <p className="text-sm font-medium">{rewrite.tailored}</p>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-app border border-rule px-2 py-1 text-[11px] font-medium text-ink-70 transition-colors hover:border-ink hover:text-ink"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {rewrite.rationale && (
        <p className="mt-1 text-[11px] text-ink-70">{rewrite.rationale}</p>
      )}
    </li>
  );
}
