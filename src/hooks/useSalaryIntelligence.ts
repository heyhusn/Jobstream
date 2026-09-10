import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * Row shape of `public.salary_market_summary` (migration
 * 0012_salary_intelligence.sql) — a plain aggregation view over
 * `jobs`, not a table the hand-written `Database` type in
 * `src/types/database.ts` knows about. Same containment strategy as
 * `useCompanyIntelligence`/`useMatches`: one honest interface here,
 * one cast at the query boundary, rather than teaching the whole
 * app's type layer about a view it only reads.
 *
 * This is market data, not user data — like jobs/companies
 * themselves, it's public-read (see 0001_init.sql and 0012's
 * grants), so these hooks don't gate on `useAuth` the way per-user
 * hooks like `useMatches` do.
 *
 * `sample_size` and `total_active_in_currency` are not decoration —
 * every consumer of `min_salary`/`max_salary`/`avg_salary`/
 * `median_salary` must show them next to the numbers. This view
 * deliberately does not attempt cross-currency conversion or infer
 * bands for undisclosed roles; see 0012's header comment for why.
 */
export interface SalaryMarketSummaryRow {
  salary_currency: string;
  sample_size: number;
  total_active_in_currency: number;
  min_salary: number | null;
  max_salary: number | null;
  avg_salary: number | null;
  median_salary: number | null;
}

/** One row per (company, currency), for a company detail page to show what that employer specifically pays. */
export interface CompanySalaryBandRow {
  company_id: string;
  salary_currency: string;
  sample_size: number;
  min_salary: number;
  max_salary: number;
  avg_salary: number;
}

const SALARY_MARKET_SUMMARY_SELECT =
  "salary_currency, sample_size, total_active_in_currency, min_salary, max_salary, avg_salary, median_salary";

const COMPANY_SALARY_BANDS_SELECT =
  "company_id, salary_currency, sample_size, min_salary, max_salary, avg_salary";

/** Every currency with at least one disclosed active posting, most-sampled first. */
export function useSalaryMarketSummary() {
  return useQuery({
    queryKey: ["salary-market-summary"],
    queryFn: async (): Promise<SalaryMarketSummaryRow[]> => {
      const { data, error } = await supabase
        .from("salary_market_summary")
        .select(SALARY_MARKET_SUMMARY_SELECT)
        .order("sample_size", { ascending: false });

      if (error) throw error;
      return (data ?? []) as unknown as SalaryMarketSummaryRow[];
    },
  });
}

export function companySalaryBandsKey(companyId: string | undefined) {
  return ["company-salary-bands", companyId] as const;
}

/**
 * One company's disclosed salary bands, one row per currency it
 * pays in. Meant for a company detail page (`CompanyPage.tsx`) to
 * import directly — pass the company's id, get back whatever this
 * repo actually knows that company pays, or an empty array if it's
 * never disclosed a salary.
 */
export function useCompanySalaryBands(companyId: string | undefined) {
  return useQuery({
    queryKey: companySalaryBandsKey(companyId),
    enabled: !!companyId,
    queryFn: async (): Promise<CompanySalaryBandRow[]> => {
      const { data, error } = await supabase
        .from("company_salary_bands")
        .select(COMPANY_SALARY_BANDS_SELECT)
        .eq("company_id", companyId!);

      if (error) throw error;
      return (data ?? []) as unknown as CompanySalaryBandRow[];
    },
  });
}
