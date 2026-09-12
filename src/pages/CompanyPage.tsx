import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  useCompanyIntelligence,
  useCompanyOpenRoles,
  type CompanyOpenRole,
} from "@/hooks/useCompanyIntelligence";
import {
  useCompanyContacts,
  useAddCompanyContact,
  useDeleteCompanyContact,
} from "@/hooks/useCompanyContacts";
import { useInterviewQuestionsForCompany } from "@/hooks/useAnalytics";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
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

/**
 * M08 from the roadmap: per-company view built entirely from
 * `company_intelligence` (migration 0011), a plain SQL rollup over
 * companies/jobs/ghost_signals already in the database. No LLM call,
 * no separate ingestion — this is the same market data Matches and
 * the ghost-risk badges already read, just aggregated per company.
 *
 * Same honesty rule the rest of this app holds to (see
 * ResumeOptimizerPanel / optimize-resume/prompt.ts's refusal to
 * invent an "ATS score"): a stat computed from one or two data points
 * isn't a trend, so thin history says so plainly instead of rendering
 * a number that implies more confidence than the sample supports.
 */
export function CompanyPage() {
  const { companyId } = useParams<{ companyId: string }>();
  const { data: company, isPending, isError, refetch } = useCompanyIntelligence(companyId);
  const { data: openRoles, isPending: rolesPending } = useCompanyOpenRoles(companyId);

  if (isPending) {
    return (
      <div className="space-y-4" aria-hidden="true">
        <div className="h-8 w-64 animate-pulse rounded-app bg-raised" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-app bg-raised" />
          ))}
        </div>
        <div className="h-40 animate-pulse rounded-app bg-raised" />
      </div>
    );
  }

  if (isError) return <ErrorState onRetry={() => refetch()} />;

  if (!company) {
    return (
      <EmptyState
        title="No data for this company"
        body="Either the id is wrong, or nothing's been ingested for this company yet — company intelligence only covers companies with at least one job on record."
        action={
          <Link to="/companies" className="text-sm font-medium text-ink underline">
            Back to companies
          </Link>
        }
      />
    );
  }

  const thinHistory = company.total_roles_seen <= 1;

  return (
    <div>
      <Link to="/companies" className="text-xs text-ink-70 underline hover:text-ink">
        Back to companies
      </Link>

      <div className="mt-2 mb-6">
        <h1 className="text-2xl font-semibold">{company.canonical_name}</h1>
        <p className="mt-1 text-sm text-ink-70">
          {[company.domain, company.ats_type, company.size_band, company.hq_country]
            .filter(Boolean)
            .join(" · ") || "No further company details on record."}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Open roles now" value={String(company.open_roles_count)} />
        <StatCard label="Roles ever seen" value={String(company.total_roles_seen)} />
        <StatCard
          label="Avg. days open"
          value={
            company.avg_days_open == null || thinHistory
              ? null
              : String(Math.round(company.avg_days_open))
          }
          note={
            company.avg_days_open == null
              ? "No open roles to measure."
              : thinHistory
                ? "Not enough history yet to show a trend."
                : undefined
          }
        />
        <StatCard
          label="Repost rate"
          value={
            company.repost_rate == null || thinHistory
              ? null
              : `${Math.round(company.repost_rate * 100)}%`
          }
          note={
            company.repost_rate == null
              ? "No roles on record."
              : thinHistory
                ? "Not enough history yet to show a trend."
                : undefined
          }
        />
      </div>

      <section className="mt-6 rounded-app border border-rule bg-raised px-4 py-4">
        <h2 className="mb-3 text-sm font-semibold">Ghost-risk mix</h2>
        {company.total_roles_seen === 0 ? (
          <p className="text-sm text-ink-70">No roles on record for this company yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <RiskChip band="low" count={company.ghost_low_count} />
            <RiskChip band="medium" count={company.ghost_medium_count} />
            <RiskChip band="high" count={company.ghost_high_count} />
          </div>
        )}
        <p className="mt-3 text-xs text-ink-45">
          Across every role ever ingested for this company, not just what's open now.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold">Currently open roles</h2>

        {rolesPending && (
          <div className="space-y-2" aria-hidden="true">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-app bg-raised" />
            ))}
          </div>
        )}

        {!rolesPending && (!openRoles || openRoles.length === 0) && (
          <EmptyState
            title="Nothing open right now"
            body="This company has history in the database, but no active postings at the moment."
          />
        )}

        {!rolesPending && openRoles && openRoles.length > 0 && (
          <div className="divide-y divide-rule-soft rounded-app border border-rule bg-raised px-4">
            {openRoles.map((role) => (
              <OpenRoleRow key={role.id} role={role} />
            ))}
          </div>
        )}
      </section>

      <CompanyContactsSection companyId={companyId} />
      <InterviewQuestionsSection companyId={companyId} />
    </div>
  );
}

/**
 * Minor m29: every question the signed-in user has personally been
 * asked across their own AI interview-prep sessions (M13) for jobs
 * at this company — grounded in their real sessions, not fabricated,
 * and never another user's questions (RLS on `interview_sessions`
 * scopes the underlying view before this ever renders).
 */
function InterviewQuestionsSection({ companyId }: { companyId: string | undefined }) {
  const { data: questions } = useInterviewQuestionsForCompany(companyId);

  if (!questions || questions.length === 0) return null;

  return (
    <section className="mt-6">
      <h2 className="mb-3 text-sm font-semibold">Interview questions you've been asked here</h2>
      <div className="divide-y divide-rule-soft rounded-app border border-rule bg-raised px-4">
        {questions.map((q, i) => (
          <div key={i} className="py-2.5 text-sm">
            <p>{q.question}</p>
            <p className="mt-0.5 text-xs text-ink-45">
              {q.mode} · {new Date(q.asked_at).toLocaleDateString()}
              {q.score != null ? ` · scored ${q.score}/5` : ""}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Minor m24: your own notes on a company's contacts/recruiters,
 * persisting across every application to them — not tied to one
 * specific application the way the tracker drawer's notes field is.
 */
function CompanyContactsSection({ companyId }: { companyId: string | undefined }) {
  const { data: contacts } = useCompanyContacts(companyId);
  const addContact = useAddCompanyContact(companyId);
  const deleteContact = useDeleteCompanyContact(companyId);

  const [contactName, setContactName] = useState("");
  const [note, setNote] = useState("");

  function handleAdd() {
    if (!note.trim()) return;
    addContact.mutate(
      { contactName: contactName.trim() || null, note: note.trim() },
      { onSuccess: () => { setContactName(""); setNote(""); } }
    );
  }

  return (
    <section className="mt-6">
      <h2 className="mb-3 text-sm font-semibold">Your notes on this company</h2>
      <div className="rounded-app border border-rule bg-raised px-4 py-4">
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            placeholder="Contact name (optional)"
            className="w-48 rounded-app border border-rule bg-paper px-3 py-2 text-sm outline-none focus:border-ink"
          />
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); handleAdd(); }
            }}
            placeholder="e.g. Sarah in recruiting is great, ping her directly next time"
            className="min-w-[240px] flex-1 rounded-app border border-rule bg-paper px-3 py-2 text-sm outline-none focus:border-ink"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={addContact.isPending || !note.trim()}
            className="rounded-app border border-ink px-3 py-2 text-sm font-medium hover:bg-ink hover:text-paper disabled:opacity-50"
          >
            Add
          </button>
        </div>

        {contacts && contacts.length > 0 && (
          <ul className="mt-4 space-y-2.5 border-t border-rule-soft pt-3">
            {contacts.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 text-sm">
                <div>
                  {c.contact_name && <p className="font-medium">{c.contact_name}</p>}
                  <p className="text-ink-70">{c.note}</p>
                </div>
                <button
                  type="button"
                  onClick={() => deleteContact.mutate(c.id)}
                  className="shrink-0 text-xs text-ink-45 hover:text-ghost"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function StatCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string | null;
  note?: string;
}) {
  return (
    <div className="rounded-app border border-rule bg-raised px-3.5 py-3">
      <p className="text-xs font-medium text-ink-45">{label}</p>
      {value != null ? (
        <p className="tabular mt-1 text-xl font-semibold">{value}</p>
      ) : (
        <p className="mt-1 text-sm leading-snug text-ink-70">{note ?? "Not enough data yet."}</p>
      )}
      {value != null && note && <p className="mt-0.5 text-xs text-ink-45">{note}</p>}
    </div>
  );
}

function RiskChip({ band, count }: { band: RiskBand; count: number }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${bandStyles[band]}`}
    >
      <span className="tabular font-semibold">{count}</span>
      {bandLabel[band]}
    </span>
  );
}

function OpenRoleRow({ role }: { role: CompanyOpenRole }) {
  return (
    <div className="flex items-center gap-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold">{role.title}</span>
          {role.risk_band && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${bandStyles[role.risk_band]}`}
            >
              {bandLabel[role.risk_band]}
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-sm text-ink-45">
          {role.location ?? "Location not listed"}
          {role.remote_type ? ` — ${role.remote_type}` : ""}
        </div>
      </div>

      <a
        href={role.apply_url}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 rounded-app border-[1.5px] border-ink px-3 py-1.5 text-sm font-semibold hover:bg-ink hover:text-paper"
      >
        View posting
      </a>
    </div>
  );
}
