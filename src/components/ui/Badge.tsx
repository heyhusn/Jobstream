import type { HTMLAttributes } from "react";
import clsx from "clsx";

interface Props extends HTMLAttributes<HTMLSpanElement> {
  tone?: "neutral" | "live" | "ghost" | "ink";
}

const TONE_CLASSES: Record<NonNullable<Props["tone"]>, string> = {
  neutral: "border-rule bg-raised text-ink-70",
  live: "border-live/30 bg-live-wash text-live",
  ghost: "border-ghost/30 bg-ghost-wash text-ghost",
  ink: "border-ink bg-ink text-paper",
};

export function Badge({ tone = "neutral", className, ...props }: Props) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-app border px-2 py-0.5 text-xs font-medium",
        TONE_CLASSES[tone],
        className
      )}
      {...props}
    />
  );
}
