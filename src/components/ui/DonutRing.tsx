interface Props {
  value: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
}

/**
 * Tone thresholds intentionally match this app's existing score-quality
 * language elsewhere (score bars in MatchRow) rather than inventing a new
 * scale: strong (live green), middling (neutral ink), weak (ghost red).
 */
export function DonutRing({ value, size = 44, strokeWidth = 4, label }: Props) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  const tone =
    clamped >= 70 ? "var(--color-live)" : clamped >= 40 ? "var(--color-ink-70)" : "var(--color-ghost)";

  return (
    <div
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-rule-soft)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span className="tabular absolute text-xs font-semibold">{label ?? Math.round(clamped)}</span>
    </div>
  );
}
