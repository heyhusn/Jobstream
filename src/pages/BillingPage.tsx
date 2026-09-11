import { useCreditBalance } from "@/hooks/useCreditBalance";
import { useCreditUsage } from "@/hooks/useAnalytics";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";

const compactNumber = new Intl.NumberFormat("en-US", { notation: "compact" });

/**
 * M19 (Billing/Credit Ledger), scoped to what's real without a
 * payment gateway (deliberately not built — see CLAUDE.md): the
 * ledger itself is genuine — `credit_balances`/`usage_events` are the
 * real billing source of truth this whole app already charges
 * against, and this page is the first real surface for it beyond the
 * header's credit chip. What isn't here yet is a way to actually pay
 * for more — tier changes are a manual operation for now, not a
 * self-serve Stripe checkout.
 */
export function BillingPage() {
  const { data: balance, isPending: balancePending, isError: balanceError, refetch: refetchBalance } =
    useCreditBalance();
  const { data: usage, isPending: usagePending, isError: usageError } = useCreditUsage();

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold">Billing</h1>
      <p className="mt-1 text-sm text-ink-70">
        Your credit balance and how it's been spent. There's no payment gateway wired up yet, so
        upgrading tiers or buying more credits isn't self-serve — this page shows what's real
        today rather than a checkout flow that doesn't exist.
      </p>

      <section className="mt-6 rounded-app border border-rule bg-raised px-5 py-4">
        {balancePending && <div className="h-16 animate-pulse rounded-app bg-paper" aria-hidden="true" />}
        {balanceError && <ErrorState onRetry={() => refetchBalance()} />}
        {balance && (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-ink-45">Current plan</p>
              <p className="mt-0.5 text-lg font-semibold capitalize">{balance.tier}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-ink-45">Credits remaining</p>
              <p className="tabular mt-0.5 text-lg font-semibold">{balance.credits_remaining}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-ink-45">Resets</p>
              <p className="mt-0.5 text-sm text-ink-70">
                {new Date(balance.credits_reset_at).toLocaleDateString()}
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold">Usage by feature</h2>
        {usagePending && (
          <div className="space-y-2" aria-hidden="true">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-app bg-raised" />
            ))}
          </div>
        )}
        {usageError && <ErrorState />}
        {usage && usage.length === 0 && (
          <EmptyState
            title="No usage yet"
            body="Once you use a credit-charging feature (a cover letter, resume check, interview prep session, and so on), it shows up here."
          />
        )}
        {usage && usage.length > 0 && (
          <div className="divide-y divide-rule-soft rounded-app border border-rule bg-raised px-4">
            {usage.map((row) => (
              <div key={row.feature} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium capitalize">
                    {row.feature.replace(/_/g, " ")}
                  </p>
                  <p className="text-xs text-ink-45">
                    Used {compactNumber.format(row.times_used)}{" "}
                    {row.times_used === 1 ? "time" : "times"} — last on{" "}
                    {new Date(row.last_used_at).toLocaleDateString()}
                  </p>
                </div>
                <span className="tabular shrink-0 text-sm font-semibold text-ink-70">
                  {compactNumber.format(row.credits_used)} credit{row.credits_used === 1 ? "" : "s"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
