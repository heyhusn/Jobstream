import { useBlockCompany, useCompanyBlocklistIds } from "@/hooks/useCompanyBlocklist";

/** Minor m17: exclude-companies blocklist — the "hide this" action lives right on the row it applies to. */
export function BlockCompanyButton({ companyId }: { companyId: string }) {
  const { data: blocked } = useCompanyBlocklistIds();
  const block = useBlockCompany();
  const isBlocked = blocked?.has(companyId) ?? false;

  if (isBlocked) {
    return <span className="text-xs text-ink-45">Hidden from your results</span>;
  }

  return (
    <button
      type="button"
      onClick={() => block.mutate(companyId)}
      disabled={block.isPending}
      className="text-xs text-ink-45 underline hover:text-ghost"
    >
      Hide this company
    </button>
  );
}
