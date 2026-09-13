import { useState } from "react";
import { Copy } from "lucide-react";
import { useCreditBalance } from "@/hooks/useCreditBalance";
import { useCreditUsage } from "@/hooks/useAnalytics";
import { useReferralCode, useMyReferrals } from "@/hooks/useReferrals";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Card } from "@/components/ui/Card";
import { Stat } from "@/components/ui/Stat";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";

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

      <Card className="mt-6">
        {balancePending && <Skeleton className="h-16" />}
        {balanceError && <ErrorState onRetry={() => refetchBalance()} />}
        {balance && (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Stat label="Current plan" value={<span className="capitalize">{balance.tier}</span>} />
            <Stat label="Credits remaining" value={balance.credits_remaining} />
            <Stat
              label="Resets"
              value={
                <span className="text-sm">
                  {new Date(balance.credits_reset_at).toLocaleDateString()}
                </span>
              }
            />
          </div>
        )}
      </Card>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold">Usage by feature</h2>
        {usagePending && (
          <div className="space-y-2" aria-hidden="true">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-12" />
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
          <Card padding="none" className="px-4">
            {usage.map((row) => (
              <div key={row.feature} className="flex items-center justify-between gap-4 border-b border-rule-soft py-3 last:border-b-0">
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
          </Card>
        )}
      </section>

      <ReferralSection />
    </div>
  );
}

/**
 * Minor m39: the reward is granted server-side once the referred
 * person actually finishes onboarding (see grant_referral_reward(),
 * migration 0030) — not at signup, which would trivially pay out for
 * a bare email with nobody behind it.
 */
function ReferralSection() {
  const { data: code } = useReferralCode();
  const { data: referrals } = useMyReferrals();
  const [copied, setCopied] = useState(false);

  const link = code ? `${window.location.origin}/sign-up?ref=${code}` : null;
  const rewardedCount = (referrals ?? []).filter((r) => r.reward_granted).length;

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be refused outright; nothing else to fall back to.
    }
  }

  return (
    <Card className="mt-6">
      <h2 className="text-sm font-semibold">Refer a friend</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-70">
        Share your link — once someone signs up through it and finishes onboarding, you get bonus
        credits.
      </p>
      {link && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="flex-1 truncate rounded-app border border-rule bg-paper px-3 py-2 text-xs">
            {link}
          </code>
          <Button variant="ghost" onClick={copyLink}>
            <Copy size={14} />
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      )}
      {referrals && referrals.length > 0 && (
        <p className="mt-3 text-xs text-ink-45">
          {referrals.length} {referrals.length === 1 ? "signup" : "signups"} via your link,{" "}
          {rewardedCount} rewarded so far.
        </p>
      )}
    </Card>
  );
}
