import { useMemo, useRef, useState, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMatches, type MatchListItem } from "@/hooks/useMatches";
import { MatchRow } from "@/components/matches/MatchRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { useAsyncTask } from "@/hooks/useAsyncTask";
import { TaskState } from "@/components/ui/TaskState";
import { Button } from "@/components/ui/Button";
import {
  useNaturalLanguageSearch,
  matchesFilter,
  LOW_CONFIDENCE,
  type SearchFilter,
} from "@/hooks/useNaturalLanguageSearch";

export function MatchesPage() {
  const { data: matches, isPending, isError, refetch } = useMatches();
  const parentRef = useRef<HTMLDivElement>(null);

  const { state: matchTaskState, run: runMatchTask, reset: resetMatchTask } = useAsyncTask("generate_matches");

  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState<{ filter: SearchFilter; rawQuery: string } | null>(null);
  const search = useNaturalLanguageSearch();

  const filtered = useMemo(() => {
    if (!matches || !applied) return matches;
    const { filter, rawQuery } = applied;

    // A parse the model itself flagged as unreliable falls back to a
    // plain substring match on the sentence as typed — structured
    // fields it wasn't confident about would just hide real results.
    if (filter.confidence < LOW_CONFIDENCE) {
      const needle = rawQuery.toLowerCase();
      return matches.filter((m) =>
        [m.job.title, m.job.location, m.job.company?.canonical_name]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle)
      );
    }

    return matches.filter((m) => matchesFilter(m as MatchListItem, filter));
  }, [matches, applied]);

  const virtualizer = useVirtualizer({
    count: filtered?.length ?? 0,
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

  function runSearch() {
    const trimmed = query.trim();
    if (!trimmed) {
      setApplied(null);
      return;
    }
    search.mutate(trimmed, {
      onSuccess: (filter) => setApplied({ filter, rawQuery: trimmed }),
    });
  }

  function clearSearch() {
    setQuery("");
    setApplied(null);
    search.reset();
  }

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Your matches</h1>
          <p className="mt-1 text-sm text-ink-70">
            {isPending
              ? "Loading…"
              : applied
                ? `${filtered?.length ?? 0} of ${matches?.length ?? 0} match "${applied.rawQuery}".`
                : `${matches?.length ?? 0} jobs cleared the bar.`}
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

      <form
        onSubmit={(e) => {
          e.preventDefault();
          runSearch();
        }}
        className="mb-5 flex flex-wrap items-center gap-2"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Try "remote roles paying over $120k that aren’t a ghost job"'
          className="w-full min-w-[240px] flex-1 rounded-app border border-rule bg-raised px-3 py-2 text-sm transition-colors focus:border-ink"
        />
        <Button type="submit" variant="ghost" disabled={search.isPending || !query.trim()}>
          {search.isPending ? "Reading…" : "Search"}
        </Button>
        {applied && (
          <button
            type="button"
            onClick={clearSearch}
            className="text-xs text-ink-70 underline hover:text-ink"
          >
            Clear
          </button>
        )}
      </form>

      {search.isError && (
        <p role="alert" className="mb-4 text-xs text-ghost">
          Couldn't read that query. Try again, or just browse the list below.
        </p>
      )}

      {applied?.filter.unsupported && (
        <p className="mb-4 text-xs text-ink-70">
          Couldn't filter on: {applied.filter.unsupported}
        </p>
      )}

      {applied && applied.filter.confidence < LOW_CONFIDENCE && (
        <p className="mb-4 text-xs text-ink-70">
          Wasn't confident about that one — showing a plain text match instead.
        </p>
      )}

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

      {!isPending && !isError && matches && matches.length > 0 && filtered && filtered.length === 0 && (
        <EmptyState
          title="Nothing matches that search"
          body="Try loosening it, or clear the search to see everything again."
        />
      )}

      {!isPending && !isError && filtered && filtered.length > 0 && (
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
                  <MatchRow item={filtered[row.index]} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
