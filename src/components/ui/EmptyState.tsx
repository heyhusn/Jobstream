import type { ReactNode } from "react";

interface Props {
  title: string;
  body: string;
  action?: ReactNode;
}

/**
 * An empty screen is an invitation to act, not a dead end — every
 * one of these names the specific reason nothing's here (no
 * ingestion has run yet, no matches meet the bar, credits are
 * spent) rather than a generic "Nothing found".
 */
export function EmptyState({ title, body, action }: Props) {
  return (
    <div className="rounded-app border border-dashed border-rule bg-raised px-8 py-14 text-center">
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-70">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
