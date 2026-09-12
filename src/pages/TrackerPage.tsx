import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApplications, useMatchScores, type ApplicationItem } from "@/hooks/useApplications";
import { useNow } from "@/hooks/useNow";
import { isOverdue, relativeDays } from "@/lib/format";
import { STAGES } from "@/lib/stages";
import { useEffectiveStages, useSetStagePref } from "@/hooks/useKanbanStagePrefs";
import { TrackerBoard } from "@/components/tracker/TrackerBoard";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";

export function TrackerPage() {
  const { data: applications, isPending, isError, refetch } = useApplications();
  const { data: scores } = useMatchScores();
  const now = useNow();
  const [customizing, setCustomizing] = useState(false);

  const stats = useMemo(() => {
    const all = applications ?? [];
    return {
      total: all.length,
      live: all.filter((a) => a.stage === "applied" || a.stage === "interviewing").length,
      interviewing: all.filter((a) => a.stage === "interviewing").length,
      offers: all.filter((a) => a.stage === "offer").length,
      overdue: all.filter(
        (a) => isOverdue(a.next_action_at, now) && a.stage !== "rejected" && a.stage !== "withdrawn"
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

        <div className="flex items-end gap-4">
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
          <button
            type="button"
            onClick={() => setCustomizing((c) => !c)}
            className="text-xs text-ink-70 underline hover:text-ink"
          >
            {customizing ? "Done" : "Customize columns"}
          </button>
        </div>
      </div>

      {customizing && <StageCustomizer applications={applications ?? []} />}

      {!isPending && !isError && applications && applications.length > 0 && (
        <RemindersPanel applications={applications} now={now} />
      )}

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

/**
 * Minor m19: rename, reorder, or hide a column — the underlying
 * `applications.stage` values stay the fixed six (see migration
 * 0028's header comment). Hiding a stage that still has cards in it
 * is blocked rather than silently stranding them off-board.
 */
function StageCustomizer({ applications }: { applications: ApplicationItem[] }) {
  const effectiveStages = useEffectiveStages();
  const setPref = useSetStagePref();

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of applications) m.set(a.stage, (m.get(a.stage) ?? 0) + 1);
    return m;
  }, [applications]);

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= effectiveStages.length) return;
    const a = effectiveStages[index];
    const b = effectiveStages[target];
    setPref.mutate({ stage_id: a.id, custom_label: a.label, position: target, hidden: a.hidden });
    setPref.mutate({ stage_id: b.id, custom_label: b.label, position: index, hidden: b.hidden });
  }

  return (
    <div className="mb-5 rounded-app border border-rule bg-raised px-4 py-3">
      <p className="mb-2 text-xs text-ink-70">
        Rename, reorder, or hide a column. The underlying stage a card is in doesn't change — only
        how it's shown.
      </p>
      <div className="space-y-1.5">
        {effectiveStages.map((s, i) => {
          const count = counts.get(s.id) ?? 0;
          const defaultLabel = STAGES.find((d) => d.id === s.id)?.label ?? s.label;
          return (
            <div key={s.id} className="flex items-center gap-2">
              <div className="flex gap-0.5">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="rounded-app border border-rule px-1.5 text-xs text-ink-70 hover:border-ink disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === effectiveStages.length - 1}
                  className="rounded-app border border-rule px-1.5 text-xs text-ink-70 hover:border-ink disabled:opacity-30"
                >
                  ↓
                </button>
              </div>
              <input
                type="text"
                value={s.label}
                onChange={(e) =>
                  setPref.mutate({
                    stage_id: s.id,
                    custom_label: e.target.value,
                    position: i,
                    hidden: s.hidden,
                  })
                }
                placeholder={defaultLabel}
                className="w-40 rounded-app border border-rule bg-paper px-2 py-1 text-sm outline-none focus:border-ink"
              />
              <label className="flex items-center gap-1.5 text-xs text-ink-70">
                <input
                  type="checkbox"
                  checked={s.hidden}
                  disabled={count > 0}
                  onChange={(e) =>
                    setPref.mutate({
                      stage_id: s.id,
                      custom_label: s.label,
                      position: i,
                      hidden: e.target.checked,
                    })
                  }
                />
                Hidden
              </label>
              <span className="text-xs text-ink-45">
                {count} card{count === 1 ? "" : "s"}
                {s.hidden && count > 0 ? " — can't hide while occupied" : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Minor m20: the "Overdue" stat already existed as a count; this is
 * the actual list behind it, plus what's due today and any upcoming
 * scheduled interview — so acting on a deadline doesn't require
 * opening every card to find which ones need it.
 */
function RemindersPanel({ applications, now }: { applications: ApplicationItem[]; now: number }) {
  const [open, setOpen] = useState(false);

  const due = useMemo(() => {
    return applications
      .filter((a) => a.stage !== "rejected" && a.stage !== "withdrawn")
      .filter((a) => a.next_action_at != null && (isOverdue(a.next_action_at, now) || relativeDays(a.next_action_at, now) === "today"))
      .sort((a, b) => (a.next_action_at ?? "").localeCompare(b.next_action_at ?? ""));
  }, [applications, now]);

  if (due.length === 0) return null;

  return (
    <div className="mb-5 rounded-app border border-ghost/30 bg-ghost-wash px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-sm font-medium text-ghost"
      >
        {due.length} {due.length === 1 ? "reminder" : "reminders"} due or overdue {open ? "▾" : "▸"}
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5">
          {due.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
              <span>
                {a.job.title} — {a.job.company?.canonical_name ?? "Unknown company"}
              </span>
              <span className="tabular text-xs text-ink-70">
                {relativeDays(a.next_action_at, now)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
