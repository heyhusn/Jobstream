import type { ReactNode } from "react";
import clsx from "clsx";

interface Props {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

// A label wrapping its control (rather than a separate htmlFor+id pair)
// so clicking the label text always focuses/toggles the input even when
// a caller doesn't bother wiring up matching ids — htmlFor is still
// accepted for the rare case the child isn't the control itself.
export function Field({ label, htmlFor, error, hint, required, children, className }: Props) {
  return (
    <label htmlFor={htmlFor} className={clsx("block space-y-1.5", className)}>
      <span className="block text-sm font-medium text-ink-70">
        {label}
        {required && <span className="text-ghost"> *</span>}
      </span>
      {children}
      {hint && !error && <p className="text-xs text-ink-45">{hint}</p>}
      {error && <p className="text-xs text-ghost">{error}</p>}
    </label>
  );
}

// Shared with every hand-rolled <input>/<select>/<textarea> so form
// controls stop reimplementing this same string per page.
export const fieldInputClass =
  "w-full rounded-app border border-rule bg-paper px-3 py-2 text-sm text-ink transition-colors placeholder:text-ink-45 focus:border-ink focus:outline-none";
