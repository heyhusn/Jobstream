import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAsyncTask } from "@/hooks/useAsyncTask";
import { useAuth } from "@/hooks/useAuth";
import { useCreditBalance } from "@/hooks/useCreditBalance";
import {
  agentRunKey,
  useInFlightAgentRunTask,
  useLatestAgentRun,
  type AgentRun,
  type AgentStep,
} from "@/hooks/useAgentOrchestration";
import type { ApplicationItem } from "@/hooks/useApplications";
import { coverLetterKey, useCoverLetter } from "@/hooks/useCoverLetter";
import { resumeOptimizerKey } from "@/hooks/useResumeOptimizer";
import { TaskState } from "@/components/ui/TaskState";

const stepLabels: Record<AgentStep["kind"], string> = {
  resume_optimize: "Check resume against posting",
  cover_letter: "Draft cover letter",
};

/**
 * M17 from the roadmap, scoped as a fixed two-step sequencer over
 * agents that already exist (resume check, then cover letter) — not
 * an open-ended agent loop, and not a generic multi-agent framework.
 * See supabase/functions/orchestrate-application/index.ts and
 * migration 0016_fix_agent_orchestration_race.sql for the full
 * design and the concurrency bug that migration fixed.
 */
export function AgentOrchestrationPanel({ item }: { item: ApplicationItem }) {
  const jobId = item.job.id;
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: credits } = useCreditBalance();
  const { data: existingLetter } = useCoverLetter(jobId);
  const { data: latest } = useLatestAgentRun(jobId);
  const { data: inFlightTaskId } = useInFlightAgentRunTask(jobId);

  const { state: task, run, watch, reset } = useAsyncTask<
    Record<string, unknown>,
    { run_id: string }
  >("agent_run");

  const adoptedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!inFlightTaskId || adoptedRef.current === inFlightTaskId) return;
    if (task.phase !== "idle") return;
    adoptedRef.current = inFlightTaskId;
    watch(inFlightTaskId);
  }, [inFlightTaskId, task.phase, watch]);

  useEffect(() => {
    if (task.phase !== "done" && task.phase !== "failed") return;
    adoptedRef.current = null;
    // Refresh both the panel's own state and the individual panels
    // whose results this run just produced — otherwise the resume
    // check / cover letter further down the drawer would keep
    // showing stale data until the drawer is reopened.
    queryClient.invalidateQueries({ queryKey: agentRunKey(user?.id, jobId) });
    queryClient.invalidateQueries({ queryKey: ["agent-run-task", user?.id, jobId] });
    queryClient.invalidateQueries({ queryKey: resumeOptimizerKey(user?.id, jobId) });
    queryClient.invalidateQueries({ queryKey: coverLetterKey(user?.id, jobId) });
    queryClient.invalidateQueries({ queryKey: ["credit-balance", user?.id] });
  }, [task.phase, queryClient, user?.id, jobId]);

  const active =
    latest?.status === "queued" ||
    latest?.status === "running" ||
    task.phase === "queued" ||
    task.phase === "running";

  // A cover letter that already exists for this job is never
  // overwritten — that step is skipped, not re-run — so a run that
  // will hit that case only ever spends 1 credit, not 2. Gating on
  // the wrong number would either block someone who actually has
  // enough credit for the run they're about to get, or (the other
  // direction) never happens here since this only ever under-quotes
  // the requirement, not over-promises it.
  const requiredCredits = existingLetter ? 1 : 2;
  const canStart = !active && credits != null && credits.credits_remaining >= requiredCredits;

  function start() {
    reset();
    run({ job_id: jobId, application_id: item.id });
  }

  return (
    <section className="border-t border-rule pt-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">Application prep</h3>
        <span className="text-[11px] text-ink-70">
          {requiredCredits} credit{requiredCredits === 1 ? "" : "s"} maximum
        </span>
      </div>

      {active ? (
        <RunProgress run={latest} phase={task.phase} />
      ) : latest?.status === "completed" ? (
        <CompletedRun run={latest} onStart={start} canStart={canStart} />
      ) : (
        <div className="rounded-app border border-dashed border-rule bg-raised px-4 py-4">
          <p className="text-sm leading-relaxed text-ink-70">
            Runs the resume check first, then drafts a professional cover letter from your
            resume. Each step stays reviewable here and in its own panel.
            {existingLetter && " You already have a cover letter for this job, so that step will be skipped rather than replaced."}
          </p>

          {(task.phase === "failed" || latest?.status === "failed") && (
            <div className="mt-3">
              <TaskState
                phase="failed"
                errorMessage={task.phase === "failed" ? task.error : (latest?.error ?? undefined)}
                onRetry={start}
              />
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={start}
              disabled={!canStart}
              className="rounded-app border-[1.5px] border-ink bg-ink px-3.5 py-2 text-sm font-semibold text-paper transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
            >
              Prepare this application
            </button>
            {credits != null && credits.credits_remaining < requiredCredits && (
              <Link to="/settings/billing" className="text-xs text-ghost underline">
                {requiredCredits} credit{requiredCredits === 1 ? "" : "s"}{" "}
                {requiredCredits === 1 ? "is" : "are"} needed to start
              </Link>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function RunProgress({
  run,
  phase,
}: {
  run: AgentRun | null | undefined;
  phase: string;
}) {
  if (!run) {
    return (
      <TaskState
        phase={phase as "queued" | "running"}
        queuedLabel="Starting preparation…"
        runningLabel="Starting preparation…"
      />
    );
  }
  return (
    <div className="space-y-2 rounded-app border border-rule bg-raised p-3">
      {run.steps.map((step) => (
        <Step key={step.kind} step={step} />
      ))}
    </div>
  );
}

function CompletedRun({
  run,
  onStart,
  canStart,
}: {
  run: AgentRun;
  onStart: () => void;
  canStart: boolean;
}) {
  return (
    <div className="rounded-app border border-rule bg-raised px-4 py-3">
      <div className="space-y-2">
        {run.steps.map((step) => (
          <Step key={step.kind} step={step} />
        ))}
      </div>
      <button
        type="button"
        onClick={onStart}
        disabled={!canStart}
        className="mt-3 text-sm font-medium text-ink-70 underline hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
      >
        Run again
      </button>
    </div>
  );
}

function Step({ step }: { step: AgentStep }) {
  const label =
    step.status === "done"
      ? "Done"
      : step.status === "skipped"
        ? "Kept existing draft"
        : step.status === "failed"
          ? "Didn't finish"
          : step.status === "pending"
            ? "Waiting"
            : "In progress";

  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span>{stepLabels[step.kind]}</span>
      <span className={step.status === "failed" ? "text-ghost" : "text-ink-70"}>{label}</span>
    </div>
  );
}
