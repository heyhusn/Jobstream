import type { MatchListItem } from "@/hooks/useMatches";
import { JobResultRow } from "@/components/jobs/JobResultRow";
import { DonutRing } from "@/components/ui/DonutRing";

export function MatchRow({ item }: { item: MatchListItem }) {
  return (
    <JobResultRow
      job={item.job}
      riskBand={item.ghost?.risk_band ?? null}
      ghostReasons={item.ghost?.reasons}
      headerRight={<DonutRing value={item.score} />}
      expandedTop={
        <ul className="space-y-2">
          {item.score_breakdown.map((s, i) => (
            <li key={i} className="flex items-baseline justify-between gap-4 text-sm">
              <span className="flex items-baseline gap-2">
                <span className={s.direction === "pass" ? "font-bold text-live" : "font-bold text-ghost"}>
                  {s.direction === "pass" ? "+" : "−"}
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
      }
    />
  );
}
