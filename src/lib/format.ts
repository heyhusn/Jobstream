/** Compact salary range. "Not disclosed" is a fact worth showing, not a blank. */
export function money(min: number | null, max: number | null, currency: string) {
  if (min == null && max == null) return "Not disclosed";
  const fmt = (n: number) => new Intl.NumberFormat("en-US", { notation: "compact" }).format(n);
  if (min != null && max != null) return `${currency} ${fmt(min)}–${fmt(max)}`;
  return `${currency} ${fmt((min ?? max) as number)}+`;
}

const DAY = 86_400_000;

/**
 * Relative day counts, phrased the way a person tracking
 * applications thinks: "3 days ago", "in 2 days", "today".
 * Deliberately day-granular — an application deadline doesn't
 * need "4 hours ago".
 */
export function relativeDays(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;

  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(then) - startOf(new Date(now))) / DAY);

  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 0) return `in ${days} days`;
  return `${Math.abs(days)} days ago`;
}

/**
 * Whether a next-action date has actually passed.
 *
 * Deliberately not `new Date(iso) < now`: dates picked in the UI are
 * anchored at local noon, so a plain timestamp comparison starts
 * calling a card "Overdue today" from 12:00 on the day it's due.
 * A day-granular field deserves a day-granular test.
 */
export function isOverdue(iso: string | null, now: number): boolean {
  if (!iso) return false;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return false;
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return startOf(then) < startOf(new Date(now));
}

/** `YYYY-MM-DD` for <input type="date">, from a timestamptz. */
export function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The inverse. Anchored at local noon so a date the person picked
 * doesn't shift a day when it round-trips through UTC.
 */
export function fromDateInput(value: string): string | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12).toISOString();
}
