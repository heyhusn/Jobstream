import { useSalaryMarketSummary, type SalaryMarketSummaryRow } from "@/hooks/useSalaryIntelligence";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { money } from "@/lib/format";

// Below this sample size, a card's numbers get called out explicitly
// as thin rather than left to look as confident as a well-sampled
// currency. Doesn't hide anything — every currency with at least one
// disclosed posting still gets a card — it just says out loud what a
// number from 1-4 postings actually is.
const THIN_SAMPLE_THRESHOLD = 5;

const compactNumber = new Intl.NumberFormat("en-US", { notation: "compact" });

/** A single point figure (median, average) — `money()` is shaped for min/max ranges, not one number, so this stays separate rather than being forced through it. */
function formatAmount(n: number | null, currency: string): string {
  if (n == null) return "—";
  return `${currency} ${compactNumber.format(n)}`;
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator <= 0) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

/**
 * M09 from the roadmap, scoped down on purpose (see
 * supabase/migrations/0012_salary_intelligence.sql's header
 * comment): this is a market-wide view over disclosed salaries,
 * grouped per currency. It does not convert between currencies and
 * does not estimate a band for postings that don't disclose a
 * salary — there's no exchange-rate feed and no role-similarity
 * classifier in this codebase to do either honestly, so it doesn't
 * pretend to.
 */
export function SalaryIntelligencePage() {
  const { data: rows, isPending, isError, refetch } = useSalaryMarketSummary();

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Salary intelligence</h1>
        <p className="mt-1 text-sm text-ink-70">
          Built from disclosed salaries on currently active postings. Grouped by currency —
          amounts are never converted between currencies, and postings that don't disclose a
          salary aren't estimated or guessed at, only counted toward the disclosure rate below.
        </p>
      </div>

      {isPending && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-app bg-raised" />
          ))}
        </div>
      )}

      {isError && <ErrorState onRetry={() => refetch()} />}

      {!isPending && !isError && rows && rows.length === 0 && (
        <EmptyState
          title="No disclosed salaries yet"
          body="None of the currently active postings in the database disclose a salary, so there's nothing to summarize. This page will fill in as postings with real numbers come in — it never estimates one."
        />
      )}

      {!isPending && !isError && rows && rows.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <SalaryCard key={row.salary_currency} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

function SalaryCard({ row }: { row: SalaryMarketSummaryRow }) {
  const thin = row.sample_size < THIN_SAMPLE_THRESHOLD;

  return (
    <div className="rounded-app border border-rule bg-raised px-4 py-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{row.salary_currency}</h2>
        <span className="text-xs text-ink-70">
          {formatPercent(row.sample_size, row.total_active_in_currency)} disclose salary
        </span>
      </div>

      <dl className="mt-3 space-y-1.5 text-sm">
        <div className="flex items-baseline justify-between">
          <dt className="text-ink-70">Headline range</dt>
          <dd className="tabular font-medium">{money(row.min_salary, row.max_salary, row.salary_currency)}</dd>
        </div>
        <div className="flex items-baseline justify-between">
          <dt className="text-ink-70">Median</dt>
          <dd className="tabular font-medium">{formatAmount(row.median_salary, row.salary_currency)}</dd>
        </div>
        <div className="flex items-baseline justify-between">
          <dt className="text-ink-70">Average</dt>
          <dd className="tabular font-medium">{formatAmount(row.avg_salary, row.salary_currency)}</dd>
        </div>
      </dl>

      <p className="mt-3 text-xs text-ink-45">
        Based on {row.sample_size} of {row.total_active_in_currency} active {row.salary_currency}{" "}
        postings that disclose salary. "Headline range" spans each posting's own top-of-band
        figure — it isn't the lowest floor to highest ceiling across postings, so it can look
        narrower than any single job's own listed range.
      </p>

      {thin && (
        <p className="mt-1.5 text-xs text-ghost">
          Only {row.sample_size} data {row.sample_size === 1 ? "point" : "points"} — too few to
          treat as a reliable market figure.
        </p>
      )}
    </div>
  );
}
