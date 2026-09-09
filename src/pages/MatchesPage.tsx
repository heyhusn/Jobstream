import { useRef, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMatches } from "@/hooks/useMatches";
import { MatchRow } from "@/components/matches/MatchRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { useAsyncTask } from "@/hooks/useAsyncTask";
import { TaskState } from "@/components/ui/TaskState";
import { Button } from "@/components/ui/Button";

export function MatchesPage() {
  const { data: matches, isPending, isError, refetch } = useMatches();
  const parentRef = useRef<HTMLDivElement>(null);
  
  const { state: matchTaskState, run: runMatchTask, reset: resetMatchTask } = useAsyncTask("generate_matches");

  const virtualizer = useVirtualizer({
    count: matches?.length ?? 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 66,
    overscan: 8,
  });

  // When task finishes successfully, refetch matches and reset task state
  useEffect(() => {
    if (matchTaskState.phase === "done") {
      refetch();
      // Reset after a brief delay so user sees "done"
      setTimeout(resetMatchTask, 2000);
    }
  }, [matchTaskState.phase, refetch, resetMatchTask]);

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Your matches</h1>
          <p className="mt-1 text-sm text-ink-70">
            {isPending ? "Loading…" : `${matches?.length ?? 0} jobs cleared the bar.`}
          </p>
        </div>
        
        <div>
          {matchTaskState.phase !== "idle" && matchTaskState.phase !== "done" ? (
            <TaskState 
              phase={matchTaskState.phase} 
              errorMessage={"error" in matchTaskState ? matchTaskState.error : undefined}
              onRetry={() => { resetMatchTask(); runMatchTask({}); }} 
            />
          ) : (
            <Button 
              variant="ghost" 
              onClick={() => runMatchTask({})}
              disabled={isPending || isError}
            >
              Recompute matches
            </Button>
          )}
        </div>
      </div>

      {isPending && (
        <div className="space-y-2" aria-hidden="true">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-[66px] animate-pulse rounded-app bg-raised" />
          ))}
        </div>
      )}

      {isError && <ErrorState onRetry={() => refetch()} />}

      {!isPending && !isError && matches && matches.length === 0 && (
        <EmptyState
          title="No matches yet"
          body="Either nothing in today's ingestion clears your bar, or your profile needs another look. Check your skills and salary floor in Settings."
        />
      )}

      {!isPending && !isError && matches && matches.length > 0 && (
        <div className="rounded-app border border-rule bg-raised px-4">
          <div ref={parentRef} className="max-h-[calc(100vh-260px)] overflow-y-auto">
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((row) => (
                <div
                  key={row.key}
                  ref={virtualizer.measureElement}
                  data-index={row.index}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${row.start}px)`,
                  }}
                >
                  <MatchRow item={matches[row.index]} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
