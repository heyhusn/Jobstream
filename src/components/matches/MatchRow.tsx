import { useState } from "react";
import { Link } from "react-router-dom";
import type { MatchListItem } from "@/hooks/useMatches";
import { useSaveToTracker, useTrackedJobIds } from "@/hooks/useApplications";
import { money } from "@/lib/format";

const bandStyles: Record<string, string> = {
  low: "bg-live-wash text-live",
  medium: "bg-rule text-ink-70",
  high: "bg-ghost-wash text-ghost",
};
const bandLabel: Record<string, string> = {
  low: "Looks real",
  medium: "Worth a second look",
  high: "High ghost risk",
};

export function MatchRow({ item }: { item: MatchListItem }) {
  const [open, setOpen] = useState(false);
  const { data: tracked } = useTrackedJobIds();
  const save = useSaveToTracker();

  const isTracked = tracked?.has(item.job.id) ?? false;

  return (
    <div className="border-b border-rule-soft last:border-b-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-4 px-1 py-4 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{item.job.title}</span>
            {item.ghost && (
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${bandStyles[item.ghost.risk_band]}`}
              >
                {bandLabel[item.ghost.risk_band]}
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-sm text-ink-45">
            {item.job.company?.canonical_name ?? "Unknown company"}
            {item.job.location ? ` — ${item.job.location}` : ""} —{" "}
            {money(item.job.salary_min, item.job.salary_max, item.job.salary_currency)}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <span className="tabular text-sm font-semibold">{Math.round(item.score)}</span>
          <span className="h-1.5 w-14 overflow-hidden rounded-full bg-rule">
            <span
              className="block h-full rounded-full bg-live"
              style={{ width: `${Math.min(item.score, 100)}%` }}
            />
          </span>
        </div>
      </button>

      {open && (
        <div className="mb-4 rounded-app border border-rule-soft bg-raised px-4 py-3">
          <ul className="space-y-2">
            {item.score_breakdown.map((s, i) => (
              <li key={i} className="flex items-baseline justify-between gap-4 text-sm">
                <span className="flex items-baseline gap-2">
                  <span className={s.direction === "pass" ? "font-bold text-live" : "font-bold text-ghost"}>
                    {s.direction === "pass" ? "+" : "\u2212"}
                  </span>
                  {s.label}
                </span>
                <span className={`tabular shrink-0 ${s.direction === "fail" ? "text-ghost" : "text-ink-45"}`}>
                  {s.delta > 0 ? "+" : ""}
                  {s.delta}
                </span>
              </li>
            ))}
          </ul>

          {item.ghost && item.ghost.reasons.length > 0 && (
            <div className="mt-3 border-t border-rule-soft pt-3">
              <p className="mb-1.5 text-xs font-medium text-ink-45">Ghost-risk signals</p>
              <ul className="space-y-1 text-sm text-ink-70">
                {item.ghost.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <a
              href={item.job.apply_url}
              target="_blank"
              rel="noreferrer"
              className="inline-block rounded-app border-[1.5px] border-ink px-3 py-1.5 text-sm font-semibold hover:bg-ink hover:text-paper"
            >
              View posting
            </a>

            {item.job.company && (
              <Link
                to={`/companies/${item.job.company.id}`}
                className="inline-block rounded-app border-[1.5px] border-rule px-3 py-1.5 text-sm font-medium text-ink-70 transition-colors hover:border-ink hover:text-ink"
              >
                View company
              </Link>
            )}

            {/* Saving is the funnel into the tracker, so it reads as
                a state ("Saved to tracker") rather than resetting to
                an inviting button the moment it succeeds. */}
            <button
              type="button"
              onClick={() => save.mutate(item.job.id)}
              disabled={isTracked || save.isPending}
              className={
                "inline-flex items-center gap-1.5 rounded-app border-[1.5px] px-3 py-1.5 text-sm font-semibold transition-colors disabled:cursor-default " +
                (isTracked
                  ? "border-live/40 bg-live-wash text-live"
                  : "border-rule text-ink-70 hover:border-ink hover:text-ink disabled:opacity-60")
              }
            >
              {isTracked ? "Saved to tracker" : save.isPending ? "Saving\u2026" : "Save to tracker"}
            </button>

            {isTracked && (
              <Link to="/tracker" className="text-sm text-ink-45 underline hover:text-ink">
                Open tracker
              </Link>
            )}
          </div>

          {save.isError && (
            <p role="alert" className="mt-2 text-sm text-ghost">
              Couldn't save that one. Try again in a moment.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
