import { Link } from "react-router-dom";
import { useCreditBalance } from "@/hooks/useCreditBalance";

export function CreditChip() {
  const { data, isPending } = useCreditBalance();

  if (isPending || !data) {
    return <div className="h-7 w-24 animate-pulse rounded-app bg-rule-soft" aria-hidden="true" />;
  }

  const low = data.credits_remaining <= 1 && data.tier === "free";

  return (
    <Link
      to="/settings/billing"
      className={
        "flex items-center gap-1.5 rounded-app border px-3 py-1.5 text-sm font-medium transition-colors " +
        (low
          ? "border-ghost/40 bg-ghost-wash text-ghost hover:bg-ghost-wash/70"
          : "border-rule bg-raised text-ink-70 hover:border-ink hover:text-ink")
      }
      title="Your AI credit balance"
    >
      <span className="tabular font-semibold">{data.credits_remaining}</span>
      <span>{data.credits_remaining === 1 ? "credit" : "credits"}</span>
    </Link>
  );
}
