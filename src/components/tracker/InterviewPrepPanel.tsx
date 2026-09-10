import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { useAsyncTask } from "@/hooks/useAsyncTask";
import { useCreditBalance } from "@/hooks/useCreditBalance";
import type { InterviewTaskResult } from "@/hooks/useInterviewPrep";
import type { ApplicationItem } from "@/hooks/useApplications";
import type { InterviewMode } from "@/types/database";
import { TaskState } from "@/components/ui/TaskState";

interface Props {
  item: ApplicationItem;
}

const MODES: { id: InterviewMode; label: string; hint: string }[] = [
  { id: "behavioral", label: "Behavioural", hint: "Past decisions, STAR-shaped answers." },
  { id: "technical", label: "Technical", hint: "The stack and problem types this role names." },
];

/**
 * M13 from the roadmap. Starting a session costs one credit and
 * covers the whole mock interview (five turns, hard-capped — see
 * interview-prep/index.ts); answering turns doesn't cost anything
 * further. This panel only starts a session and hands off to a
 * dedicated page — a five-turn transcript doesn't fit in a 560px
 * drawer next to two other panels.
 */
export function InterviewPrepPanel({ item }: Props) {
  const navigate = useNavigate();
  const { data: credits } = useCreditBalance();
  const [mode, setMode] = useState<InterviewMode>("behavioral");

  const { state: task, run, reset } = useAsyncTask<Record<string, unknown>, InterviewTaskResult>(
    "interview_turn"
  );

  const busy = task.phase === "queued" || task.phase === "running";
  const outOfCredits = credits == null || credits.credits_remaining < 1;

  useEffect(() => {
    if (task.phase === "done") {
      navigate(`/interview/${task.result.session_id}`);
    }
  }, [task, navigate]);

  function start() {
    reset();
    run({ action: "start", job_id: item.job.id, mode });
  }

  return (
    <section className="border-t border-rule pt-5">
      <h3 className="mb-3 text-sm font-semibold">Interview prep</h3>

      {busy && (
        <TaskState
          phase={task.phase}
          queuedLabel="Queued — this takes a few seconds."
          runningLabel="Reading the posting and writing your first question…"
        />
      )}

      {task.phase === "failed" && (
        <div className="mb-3">
          <TaskState phase="failed" errorMessage={task.error} onRetry={start} />
        </div>
      )}

      {!busy && task.phase !== "failed" && (
        <div className="rounded-app border border-dashed border-rule bg-raised px-4 py-4">
          <p className="text-sm leading-relaxed text-ink-70">
            A five-question mock interview grounded in this posting and your resume. Adaptive
            follow-ups, per-answer feedback, a summary at the end.
          </p>

          <fieldset className="mt-3">
            <legend className="mb-1.5 text-xs font-medium text-ink-70">Mode</legend>
            <div className="flex flex-wrap gap-1.5">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  aria-pressed={mode === m.id}
                  title={m.hint}
                  className={clsx(
                    "rounded-app border px-2.5 py-1 text-xs font-medium transition-colors",
                    mode === m.id
                      ? "border-ink bg-ink text-paper"
                      : "border-rule text-ink-70 hover:border-ink hover:text-ink"
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={start}
              disabled={outOfCredits}
              className="rounded-app border-[1.5px] border-ink bg-ink px-3.5 py-2 text-sm font-semibold text-paper transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
            >
              Start mock interview
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
    </section>
  );
}
