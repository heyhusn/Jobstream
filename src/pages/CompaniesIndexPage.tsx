import { Link } from "react-router-dom";
import { useCompanyList, type CompanyIntelligence } from "@/hooks/useCompanyIntelligence";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import type { RiskBand } from "@/types/database";

const bandDot: Record<RiskBand, string> = {
  low: "bg-live",
  medium: "bg-ink-45",
  high: "bg-ghost",
};

/**
 * Index into Company Intelligence (M08) — every company with at
 * least one ingested job, most open roles first. `useCompanyList`
 * reads the same `company_intelligence` view the detail page does,
 * so there's nothing computed twice between the two pages.
 */
export function CompaniesIndexPage() {
  const { data: companies, isPending, isError, refetch } = useCompanyList();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Companies</h1>
        <p className="mt-1 text-sm text-ink-70">
          {isPending ? "Loading…" : `${companies?.length ?? 0} companies with jobs on record.`}
        </p>
      </div>

      {isPending && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-app bg-raised" />
          ))}
        </div>
      )}

      {isError && <ErrorState onRetry={() => refetch()} />}

      {!isPending && !isError && companies && companies.length === 0 && (
        <EmptyState
          title="No companies yet"
          body="Nothing's been ingested yet — company intelligence only covers companies that have at least one job on record."
        />
      )}

      {!isPending && !isError && companies && companies.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {companies.map((company) => (
            <CompanyCard key={company.company_id} company={company} />
          ))}
        </div>
      )}
    </div>
  );
}

function CompanyCard({ company }: { company: CompanyIntelligence }) {
  const riskiest: RiskBand | null =
    company.ghost_high_count > 0 ? "high" : company.ghost_medium_count > 0 ? "medium" : company.ghost_low_count > 0 ? "low" : null;

  return (
    <Link
      to={`/companies/${company.company_id}`}
      className="block rounded-app border border-rule bg-raised px-4 py-3.5 transition-colors hover:border-ink"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="truncate font-semibold">{company.canonical_name}</span>
        {riskiest && (
          <span
            className={`mt-1 h-2 w-2 shrink-0 rounded-full ${bandDot[riskiest]}`}
            title={
              riskiest === "high"
                ? "Has high-ghost-risk postings"
                : riskiest === "medium"
                  ? "Has medium-ghost-risk postings"
                  : "All postings look real"
            }
          />
        )}
      </div>
      <p className="mt-1 truncate text-sm text-ink-45">
        {[company.hq_country, company.size_band].filter(Boolean).join(" · ") || "No further details"}
      </p>
      <p className="tabular mt-2 text-sm text-ink-70">
        {company.open_roles_count} open {company.open_roles_count === 1 ? "role" : "roles"}
      </p>
    </Link>
  );
}
