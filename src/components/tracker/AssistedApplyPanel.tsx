import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAsyncTask } from "@/hooks/useAsyncTask";
import { useAuth } from "@/hooks/useAuth";
import { useCreditBalance } from "@/hooks/useCreditBalance";
import {
  useInFlightAssistedApplyTask,
  useInvalidateAssistedApply,
  useLatestAssistedApply,
  type AssistedApplyAnswer,
  type AssistedApplyResult,
} from "@/hooks/useAssistedApply";
import type { ApplicationItem } from "@/hooks/useApplications";
import { TaskState } from "@/components/ui/TaskState";

interface Props {
  item: ApplicationItem;
}

const PLACEHOLDER_QUESTIONS = [
  "Why do you want to work here?",
  "Are you authorized to work in the US?",
  "What are your salary expectations?",
].join("\n");

/**
 * M15 from the roadmap, scoped to what this app can honestly do:
 * there is no browser automation, no ATS autofill extension, no
 * headless browser anywhere in this repo. "Assisted apply" here
 * means the person pastes the screening questions a real
 * application form is actually asking them, and this drafts
 * grounded answers from their resume/profile/this job for them to
 * copy in by hand. Any question the resume/profile can't honestly
 * answer — salary expectations, visa status, availability — comes
 * back flagged instead of a fabricated guess. See
 * assisted-apply/prompt.ts for the full rules.
 */
export function AssistedApplyPanel({ item }: Props) {
  const jobId = item.job.id;
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: latest, isPending } = useLatestAssistedApply(jobId);
  const { data: credits } = useCreditBalance();
  const invalidate = useInvalidateAssistedApply(jobId);

  const { state: task, run, watch, reset } = useAsyncTask<
    Record<string, unknown>,
    AssistedApplyResult
  >("assisted_apply");

  const { data: inFlightTaskId } = useInFlightAssistedApplyTask(jobId);
  const adoptedRef = useRef<string | null>(null);

  const [draftInput, setDraftInput] = useState("");

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

  function draft() {
    const questions = draftInput
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (questions.length === 0) return;
    reset();
    run({ job_id: jobId, questions });
  }

  return (
    <section className="border-t border-rule pt-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">Assisted apply</h3>
        {result && <p className="text-[11px] text-ink-70">{result.model}</p>}
      </div>

      {busy && (
        <TaskState
          phase={task.phase}
          queuedLabel="Queued — this takes a few seconds."
          runningLabel="Drafting answers from your resume…"
        />
      )}

      {task.phase === "failed" && (
        <div className="mb-3">
          <TaskState phase="failed" errorMessage={task.error} onRetry={draft} />
        </div>
      )}

      {!busy && (
        <>
          {isPending && <div className="h-24 animate-pulse rounded-app bg-raised" />}

          {!isPending && !result && task.phase !== "failed" && (
            <div className="rounded-app border border-dashed border-rule bg-raised px-4 py-4">
              <p className="mb-3 text-sm leading-relaxed text-ink-70">
                Paste the screening questions this posting's application form is actually
                asking — one per line. Drafts a grounded answer to each from your resume and
                this job, so you can copy them into the real form. No autofill, no browser
                automation — this app can't touch the ATS form itself. Anything it can't
                honestly answer (salary expectations, visa status, availability) it says so
                instead of guessing.
              </p>
              <textarea
                value={draftInput}
                onChange={(e) => setDraftInput(e.target.value)}
                rows={4}
                placeholder={PLACEHOLDER_QUESTIONS}
                className="w-full resize-y rounded-app border border-rule bg-paper px-3 py-2 text-sm leading-relaxed text-ink transition-colors focus:border-ink"
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={draft}
                  disabled={outOfCredits || draftInput.trim().length === 0}
                  className="rounded-app border-[1.5px] border-ink bg-ink px-3.5 py-2 text-sm font-semibold text-paper transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Draft answers
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
            <ResultView
              result={result}
              draftInput={draftInput}
              setDraftInput={setDraftInput}
              onRedraft={draft}
              outOfCredits={outOfCredits}
            />
          )}
        </>
      )}
    </section>
  );
}

function ResultView({
  result,
  draftInput,
  setDraftInput,
  onRedraft,
  outOfCredits,
}: {
  result: AssistedApplyResult;
  draftInput: string;
  setDraftInput: (v: string) => void;
  onRedraft: () => void;
  outOfCredits: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);

  return (
    <div className="space-y-4">
      <ul className="space-y-2.5">
        {result.answers.map((a, i) => (
          <AnswerCard key={i} answer={a} />
        ))}
      </ul>

      <div>
        {editing ? (
          <div className="rounded-app border border-rule bg-raised px-3 py-2.5">
            <textarea
              value={draftInput}
              onChange={(e) => setDraftInput(e.target.value)}
              rows={4}
              placeholder={PLACEHOLDER_QUESTIONS}
              className="w-full resize-y rounded-app border border-rule bg-paper px-3 py-2 text-sm leading-relaxed text-ink transition-colors focus:border-ink"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setConfirming(true);
                }}
                disabled={draftInput.trim().length === 0}
                className="rounded-app border-[1.5px] border-ink bg-ink px-3 py-1 text-xs font-semibold text-paper disabled:cursor-not-allowed disabled:opacity-50"
              >
                Continue
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-app px-3 py-1 text-xs text-ink-70 hover:text-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : confirming ? (
          <div
            role="alertdialog"
            aria-label="Draft again?"
            className="rounded-app border border-rule bg-raised px-3 py-2.5"
          >
            <p className="text-xs leading-relaxed text-ink-70">
              Drafting again replaces these answers and costs another credit.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                ref={(el) => el?.focus()}
                onClick={() => {
                  setConfirming(false);
                  onRedraft();
                }}
                className="rounded-app border-[1.5px] border-ink bg-ink px-3 py-1 text-xs font-semibold text-paper"
              >
                Draft again
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
            onClick={() => setEditing(true)}
            disabled={outOfCredits}
            className="rounded-app border border-rule px-3 py-1.5 text-sm font-medium text-ink-70 transition-colors hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            Draft again
          </button>
        )}
      </div>
    </div>
  );
}

function AnswerCard({ answer }: { answer: AssistedApplyAnswer }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(answer.answer);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can fail silently (permissions, insecure
      // context) — nothing useful to do beyond not crashing.
    }
  }

  if (answer.insufficient_info) {
    return (
      <li className="rounded-app border border-ghost/40 bg-ghost-wash px-3 py-2.5">
        <p className="text-sm font-medium">{answer.question}</p>
        <p className="mt-1 text-xs leading-relaxed text-ghost">
          {answer.note ?? "Not enough on file to answer this honestly."}
        </p>
      </li>
    );
  }

  return (
    <li className="rounded-app border border-rule bg-raised px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium">{answer.question}</p>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-app border border-rule px-2 py-1 text-[11px] font-medium text-ink-70 transition-colors hover:border-ink hover:text-ink"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink-70">
        {answer.answer}
      </p>
    </li>
  );
}
