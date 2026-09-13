import clsx from "clsx";

interface Segment {
  label: string;
  value: number;
  tone?: "live" | "ghost" | "neutral";
}

interface Props {
  segments: Segment[];
  maxValue?: number;
}

const TONE_BG: Record<NonNullable<Segment["tone"]>, string> = {
  live: "bg-live",
  ghost: "bg-ghost",
  neutral: "bg-ink-70",
};

// Hand-rolled on purpose, not a charting library — this project's house
// rule (see AnalyticsPage's original SkeletonBlock-era comment): no
// charting dependency exists here and none was added for this redesign
// either, just a reusable version of the div-bar pattern every page
// already hand-rolled separately.
export function MiniBar({ segments, maxValue }: Props) {
  const max = maxValue ?? Math.max(1, ...segments.map((s) => s.value));
  return (
    <div className="space-y-2">
      {segments.map((s) => (
        <div key={s.label} className="flex items-center gap-3 text-xs">
          <span className="w-28 shrink-0 truncate text-ink-70">{s.label}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-rule-soft">
            <div
              className={clsx("h-full rounded-full", TONE_BG[s.tone ?? "neutral"])}
              style={{ width: `${Math.min(100, (s.value / max) * 100)}%` }}
            />
          </div>
          <span className="tabular w-8 shrink-0 text-right font-medium">{s.value}</span>
        </div>
      ))}
    </div>
  );
}
