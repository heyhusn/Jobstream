import type { ReactNode } from "react";
import clsx from "clsx";

interface Props {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  hint?: string;
  className?: string;
}

export function Stat({ label, value, icon, hint, className }: Props) {
  return (
    <div className={clsx("flex items-start gap-3", className)}>
      {icon && (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-app bg-rule-soft text-ink-70">
          {icon}
        </span>
      )}
      <div>
        <p className="tabular text-xl font-semibold leading-tight">{value}</p>
        <p className="text-xs text-ink-70">{label}</p>
        {hint && <p className="mt-0.5 text-[11px] text-ink-45">{hint}</p>}
      </div>
    </div>
  );
}
