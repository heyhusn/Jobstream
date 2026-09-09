import type { ReactNode } from "react";

interface Props {
  phase: "idle" | "queued" | "running" | "done" | "failed";
  queuedLabel?: string;
  runningLabel?: string;
  errorMessage?: string;
  onRetry?: () => void;
  children?: ReactNode; // rendered when phase === "done"
}

/**
 * The rule this enforces: a task in flight is a state, not an
 * interruption. It never covers the page — it sits inline, where
 * the result will appear, so the person can keep reading or
 * queue something else while it finishes.
 */
export function TaskState({
  phase,
  queuedLabel = "Queued…",
  runningLabel = "Working on it…",
  errorMessage,
  onRetry,
  children,
}: Props) {
  if (phase === "idle") return null;

  if (phase === "queued" || phase === "running") {
    return (
      <div className="flex items-center gap-3 rounded-app border border-rule bg-raised px-4 py-3 text-sm text-ink-70">
        <span
          className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-rule border-t-ink-70"
          aria-hidden="true"
        />
        <span>{phase === "queued" ? queuedLabel : runningLabel}</span>
      </div>
    );
  }

  if (phase === "failed") {
    return (
      <div className="flex items-start justify-between gap-4 rounded-app border border-ghost/40 bg-ghost-wash px-4 py-3 text-sm">
        <div>
          <p className="font-medium text-ghost">Didn't finish</p>
          <p className="mt-0.5 text-ink-70">
            {errorMessage ?? "Something went wrong on our end. Nothing was charged."}
          </p>
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="shrink-0 rounded-app border border-ink px-3 py-1.5 text-sm font-medium hover:bg-ink hover:text-paper"
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  return <>{children}</>;
}
