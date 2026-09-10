import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAsyncTask } from "@/hooks/useAsyncTask";
import {
  interviewSessionKey,
  useInterviewSession,
  type InterviewSession,
  type InterviewTaskResult,
} from "@/hooks/useInterviewPrep";
import { TaskState } from "@/components/ui/TaskState";
import { ErrorState } from "@/components/ui/ErrorState";

const MODE_LABEL: Record<string, string> = { behavioral: "Behavioural", technical: "Technical" };

export function InterviewPrepPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const qc = useQueryClient();
  const { data: session, isPending, isError, refetch } = useInterviewSession(sessionId);
  const [answer, setAnswer] = useState("");

  const { state: task, run, reset } = useAsyncTask<Record<string, unknown>, InterviewTaskResult>(
    "interview_turn"
  );

  const busy = task.phase === "queued" || task.phase === "running";

  // Merge the turn result straight into the cache — an extra
  // round trip to re-read what the same response already contains
  // would just be a slower version of the same update.
  useEffect(() => {
    if (task.phase !== "done" || !sessionId) return;
    qc.setQueryData<InterviewSession | null>(interviewSessionKey(sessionId), (old) =>
      old
        ? {
            ...old,
            status: task.result.status,
            turns: task.result.turns,
            turn_count: task.result.turn_count,
            summary: task.result.summary,
          }
        : old
    );
    setAnswer("");
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.phase]);

  if (isPending) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className="h-40 animate-pulse rounded-app bg-raised" />
      </div>
    );
  }

  if (isError || !session) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <ErrorState title="Couldn't load this session" onRetry={() => refetch()} />
      </div>
    );
  }

  const currentTurnIndex = session.turns.findIndex((t) => t.answer === null);
  const currentQuestion = currentTurnIndex >= 0 ? session.turns[currentTurnIndex] : null;

  function submit() {
    const trimmed = answer.trim();
    if (!trimmed || !sessionId) return;
    run({ action: "answer", session_id: sessionId, answer: trimmed });
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link to="/tracker" className="text-xs text-ink-70 underline hover:text-ink">
        Back to tracker
      </Link>

      <header className="mb-6 mt-2">
        <h1 className="text-2xl font-semibold">
          {MODE_LABEL[session.mode]} interview — {session.job?.title ?? "this role"}
        </h1>
        <p className="mt-1 text-sm text-ink-70">
          {session.job?.company?.canonical_name ?? "Unknown company"} · Question{" "}
          {Math.min(session.turn_count, session.max_turns)} of {session.max_turns}
        </p>
      </header>

      <div className="space-y-4">
        {session.turns.map((turn, i) => (
          <div key={i} className="rounded-app border border-rule bg-raised px-4 py-3">
            <p className="text-xs font-medium text-ink-70">Question {i + 1}</p>
            <p className="mt-1 text-sm font-medium leading-relaxed">{turn.question}</p>

            {turn.answer && (
              <div className="mt-3 border-t border-rule-soft pt-3">
                <p className="text-xs font-medium text-ink-70">Your answer</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink-70">
                  {turn.answer}
                </p>
              </div>
            )}

            {turn.feedback && (
              <div className="mt-3 border-t border-rule-soft pt-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-xs font-medium text-ink-70">Feedback</p>
                  {turn.score != null && (
                    <span className="tabular text-xs font-semibold text-ink-70">
                      {turn.score}/5
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm leading-relaxed text-ink-70">{turn.feedback}</p>
              </div>
            )}
          </div>
        ))}

        {session.status === "active" && currentQuestion && !currentQuestion.answer && (
          <div className="rounded-app border border-dashed border-rule bg-raised px-4 py-4">
            {busy ? (
              <TaskState
                phase={task.phase}
                queuedLabel="Queued…"
                runningLabel="Reading your answer…"
              />
            ) : (
              <>
                {task.phase === "failed" && (
                  <div className="mb-3">
                    <TaskState phase="failed" errorMessage={task.error} onRetry={submit} />
                  </div>
                )}
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-ink-70">
                    Your answer
                  </span>
                  <textarea
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    rows={6}
                    placeholder="Answer as you would out loud — specific, not polished."
                    className="w-full resize-y rounded-app border border-rule bg-paper px-3 py-2 text-sm leading-relaxed transition-colors focus:border-ink"
                  />
                </label>
                <button
                  type="button"
                  onClick={submit}
                  disabled={!answer.trim()}
                  className="mt-3 rounded-app border-[1.5px] border-ink bg-ink px-3.5 py-2 text-sm font-semibold text-paper transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Submit answer
                </button>
              </>
            )}
          </div>
        )}

        {session.status === "completed" && session.summary && (
          <div className="rounded-app border border-rule bg-raised px-4 py-4">
            <h2 className="text-sm font-semibold">Session summary</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-70">
              {session.summary.overall_feedback}
            </p>

            {session.summary.strengths.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium text-ink-70">Strengths</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-ink-70">
                  {session.summary.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}

            {session.summary.areas_to_improve.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium text-ink-70">Worth working on</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-ink-70">
                  {session.summary.areas_to_improve.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}

            <Link
              to="/tracker"
              className="mt-4 inline-block rounded-app border-[1.5px] border-ink px-3.5 py-2 text-sm font-semibold transition-colors hover:bg-ink hover:text-paper"
            >
              Back to tracker
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
