import { ComingSoon } from "@/components/ui/ComingSoon";

export function BillingPage() {
  return (
    <ComingSoon
      title="Billing"
      note="Stripe subscriptions and the credit ledger (M19) — the credit_balances table and the chip in the header are already live and real; there's just no upgrade flow wired to Stripe yet."
    />
  );
}
