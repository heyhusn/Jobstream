import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useHybridSearch, type HybridSearchResult, type MatchedVia } from "@/hooks/useHybridSearch";
import { useSaveToTracker, useTrackedJobIds } from "@/hooks/useApplications";
import { useCompanyBlocklistIds } from "@/hooks/useCompanyBlocklist";
import { useNegativeKeywords, matchesNegativeKeywords } from "@/hooks/useNegativeKeywords";
import {
  useSavedSearches,
  useCreateSavedSearch,
  useDeleteSavedSearch,
} from "@/hooks/useSavedSearches";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { JobSignalBadges } from "@/components/jobs/JobSignalBadges";
import { BlockCompanyButton } from "@/components/jobs/BlockCompanyButton";
import { money, relativeDays } from "@/lib/format";
import { STAGE_LABEL } from "@/lib/stages";
import type { RiskBand } from "@/types/database";

const bandStyles: Record<RiskBand, string> = {
  low: "bg-live-wash text-live",
  medium: "bg-rule text-ink-70",
  high: "bg-ghost-wash text-ghost",
};
const bandLabel: Record<RiskBand, string> = {
  low: "Looks real",
  medium: "Worth a second look",
  high: "High ghost risk",
};

const matchedViaLabel: Record<MatchedVia, string> = {
  both: "Keyword + semantic match",
  keyword: "Keyword match",
  semantic: "Semantic match only — no shared wording",
};

/**
 * M03 from the roadmap: search the whole active job board, fusing
 * full-text and vector retrieval server-side (hybrid-search Edge
 * Function + search_jobs_hybrid, migration 0023) rather than filtering
 * whatever's already loaded on Matches. Every result says plainly
 * which half of the fusion actually found it — a semantic-only hit
 * shares no wording with the query, which is worth knowing before
 * trusting why it showed up.
 */
export function SearchPage() {
  const [query, setQuery] = useState("");
  const [ranQuery, setRanQuery] = useState<string | null>(null);
  const search = useHybridSearch();

  const { data: blocked } = useCompanyBlocklistIds();
  const { data: negativeKeywords } = useNegativeKeywords();
  const { data: savedSearches } = useSavedSearches();
  const createSaved = useCreateSavedSearch();
  const deleteSaved = useDeleteSavedSearch();

  const keywordList = useMemo(
    () => (negativeKeywords ?? []).map((k) => k.keyword),
    [negativeKeywords]
  );

  // Minors m17/m18: a blocked company or a negative-keyword hit is
  // filtered out here rather than server-side — same tradeoff as
  // useJobAlerts.ts's client-side filter, since neither "a set of
  // ids to exclude" nor "a set of free-text phrases to exclude"
  // is something search_jobs_hybrid's RPC signature takes today.
  const results = useMemo(() => {
    if (!search.data) return search.data;
    return search.data.filter(
      (r) =>
        !(r.job.company && blocked?.has(r.job.company.id)) &&
        matchesNegativeKeywords(r.job, keywordList)
    );
  }, [search.data, blocked, keywordList]);

  function runSearch(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setQuery(trimmed);
    setRanQuery(trimmed);
    search.mutate(trimmed);
  }

  function saveCurrentSearch() {
    if (!ranQuery) return;
    const name = window.prompt("Name this search", ranQuery);
    if (!name) return;
    createSaved.mutate({ name, query_text: ranQuery });
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Search all postings</h1>
        <p className="mt-1 text-sm text-ink-70">
          Searches every active job on the board, not just the matches computed against your
          profile — combining keyword search with semantic similarity so wording you didn't type
          can still surface a relevant posting.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          runSearch(query);
        }}
        className="mb-3 flex flex-wrap items-center gap-2"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Try "machine learning scientist" or "on-call SRE, Kubernetes"'
          className="w-full min-w-[240px] flex-1 rounded-app border border-rule bg-raised px-3 py-2 text-sm transition-colors focus:border-ink"
        />
        <Button type="submit" variant="ghost" disabled={search.isPending || !query.trim()}>
          {search.isPending ? "Searching…" : "Search"}
        </Button>
        {ranQuery && (
          <button
            type="button"
            onClick={saveCurrentSearch}
            disabled={createSaved.isPending}
            className="text-xs text-ink-70 underline hover:text-ink"
          >
            Save this search
          </button>
        )}
      </form>

      {savedSearches && savedSearches.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-45">Saved:</span>
          {savedSearches.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-rule bg-raised py-1 pl-3 pr-1.5 text-xs"
            >
              <button type="button" onClick={() => runSearch(s.query_text)} className="hover:underline">
                {s.name}
              </button>
              <button
                type="button"
                onClick={() => deleteSaved.mutate(s.id)}
                title="Delete this saved search"
                className="rounded-full px-1 text-ink-45 hover:text-ghost"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {search.isError && (
        <p role="alert" className="mb-4 text-xs text-ghost">
          Couldn't run that search. Try again in a moment.
        </p>
      )}

      {search.isPending && (
        <div className="space-y-2" aria-hidden="true">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-app bg-raised" />
          ))}
        </div>
      )}

      {!search.isPending && ranQuery && results && results.length === 0 && (
        <EmptyState
          title="Nothing matched that"
          body="No active posting shares enough wording or meaning with that query — or everything that did is hidden by a blocked company or negative keyword. Try loosening it."
        />
      )}

      {!search.isPending && results && results.length > 0 && (
        <div className="rounded-app border border-rule bg-raised px-4 divide-y divide-rule-soft">
          {results.map((r) => (
            <SearchResultRow key={r.job.id} result={r} />
          ))}
        </div>
      )}

      {!ranQuery && !search.isPending && (
        <EmptyState
          title="Search the whole board"
          body="Type a role, skill, or a looser description of what you're after — this doesn't require a computed match score first."
        />
      )}
    </div>
  );
}

function SearchResultRow({ result }: { result: HybridSearchResult }) {
  const [open, setOpen] = useState(false);
  const { data: tracked } = useTrackedJobIds();
  const save = useSaveToTracker();
  const isTracked = tracked?.has(result.job.id) ?? false;
  const trackedStage = tracked?.get(result.job.id);

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-4 px-1 py-4 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{result.job.title}</span>
            {result.risk_band && (
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${bandStyles[result.risk_band]}`}
              >
                {bandLabel[result.risk_band]}
              </span>
            )}
            {result.job.repost_count > 0 && (
              <span className="shrink-0 rounded-full bg-rule px-2 py-0.5 text-xs font-medium text-ink-70">
                Reposted {result.job.repost_count}×
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-sm text-ink-45">
            {result.job.company?.canonical_name ?? "Unknown company"}
            {result.job.location ? ` — ${result.job.location}` : ""} —{" "}
            {money(result.job.salary_min, result.job.salary_max, result.job.salary_currency)}
            {" — "}
            First seen {relativeDays(result.job.first_seen_at, Date.now())}
          </div>
        </div>
        <span className="shrink-0 text-xs text-ink-45">{matchedViaLabel[result.matched_via]}</span>
      </button>

      {open && (
        <div className="mb-4 rounded-app border border-rule-soft bg-raised px-4 py-3">
          <p className="text-sm leading-relaxed text-ink-70">{result.job.description}</p>

          {trackedStage && (
            <p className="mt-3 rounded-app border border-live/30 bg-live-wash px-3 py-2 text-xs text-live">
              You already have this tracked as <strong>{STAGE_LABEL[trackedStage]}</strong> — check
              the tracker before applying again.
            </p>
          )}

          <JobSignalBadges
            jobId={result.job.id}
            seniority={result.job.seniority}
            visaSponsorship={result.job.visa_sponsorship}
            techStack={result.job.tech_stack}
          />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <a
              href={result.job.apply_url}
              target="_blank"
              rel="noreferrer"
              className="inline-block rounded-app border-[1.5px] border-ink px-3 py-1.5 text-sm font-semibold hover:bg-ink hover:text-paper"
            >
              View posting
            </a>

            {result.job.company && (
              <Link
                to={`/companies/${result.job.company.id}`}
                className="inline-block rounded-app border-[1.5px] border-rule px-3 py-1.5 text-sm font-medium text-ink-70 transition-colors hover:border-ink hover:text-ink"
              >
                View company
              </Link>
            )}

            <button
              type="button"
              onClick={() => save.mutate(result.job.id)}
              disabled={isTracked || save.isPending}
              className={
                "inline-flex items-center gap-1.5 rounded-app border-[1.5px] px-3 py-1.5 text-sm font-semibold transition-colors disabled:cursor-default " +
                (isTracked
                  ? "border-live/40 bg-live-wash text-live"
                  : "border-rule text-ink-70 hover:border-ink hover:text-ink disabled:opacity-60")
              }
            >
              {isTracked ? "Saved to tracker" : save.isPending ? "Saving…" : "Save to tracker"}
            </button>

            {result.job.company && (
              <span className="ml-auto">
                <BlockCompanyButton companyId={result.job.company.id} />
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
