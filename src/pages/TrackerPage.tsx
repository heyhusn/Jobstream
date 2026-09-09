import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useApplications, useMatchScores } from "@/hooks/useApplications";
import { useNow } from "@/hooks/useNow";
import { TrackerBoard } from "@/components/tracker/TrackerBoard";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";

export function TrackerPage() {
  const { data: applications, isPending, isError, refetch } = useApplications();
  const { data: scores } = useMatchScores();
  const now = useNow();

  const stats = useMemo(() => {
    const all = applications ?? [];
    return {
      total: all.length,
      live: all.filter((a) => a.stage === "applied" || a.stage === "interviewing").length,
      interviewing: all.filter((a) => a.stage === "interviewing").length,
      offers: all.filter((a) => a.stage === "offer").length,
      overdue: all.filter(
        (a) =>
          a.next_action_at != null &&
          new Date(a.next_action_at).getTime() < now &&
          a.stage !== "rejected" &&
          a.stage !== "withdrawn"
      ).length,
    };
  }, [applications, now]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Tracker</h1>
          <p className="mt-1 text-sm text-ink-70">
            {isPending
              ? "Loading…"
              : stats.total === 0
                ? "Nothing tracked yet."
                : `${stats.total} tracked · ${stats.live} in play`}
          </p>
        </div>

        {!isPending && !isError && stats.total > 0 && (
          <dl className="flex items-end gap-6">
            <Stat label="Interviewing" value={stats.interviewing} />
            <Stat label="Offers" value={stats.offers} />
            <Stat
              label="Overdue"
              value={stats.overdue}
              tone={stats.overdue > 0 ? "alert" : "normal"}
            />
          </dl>
        )}
      </div>

      {isPending && (
        <div className="-mx-6 flex gap-3 overflow-hidden px-6" aria-hidden="true">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="w-[272px] shrink-0">
              <div className="mb-2 h-4 w-20 animate-pulse rounded bg-rule-soft" />
              <div className="h-[420px] animate-pulse rounded-app bg-raised" />
            </div>
          ))}
        </div>
      )}

      {isError && <ErrorState onRetry={() => refetch()} />}

      {!isPending && !isError && applications && applications.length === 0 && (
        <EmptyState
          title="Nothing in the pipeline yet"
          body="Save a job from Matches and it lands in the first column. From there you drag it along as things happen — applied, interviewing, offer."
          action={
            <Link
              to="/matches"
              className="inline-block rounded-app border-[1.5px] border-ink bg-ink px-4 py-2 text-sm font-semibold text-paper transition-colors hover:bg-black"
            >
              Go to matches
            </Link>
          }
        />
      )}

      {!isPending && !isError && applications && applications.length > 0 && (
        <TrackerBoard applications={applications} scores={scores ?? {}} />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: number;
  tone?: "normal" | "alert";
}) {
  return (
    <div>
      <dt className="text-xs text-ink-45">{label}</dt>
      <dd
        className={
          "tabular text-xl font-semibold " + (tone === "alert" ? "text-ghost" : "text-ink")
        }
      >
        {value}
      </dd>
    </div>
  );
}
