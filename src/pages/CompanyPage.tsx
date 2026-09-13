import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Briefcase, Clock, ExternalLink, Repeat, TrendingUp } from "lucide-react";
import {
  useCompanyIntelligence,
  useCompanyOpenRoles,
  type CompanyOpenRole,
} from "@/hooks/useCompanyIntelligence";
import { useCompanySalaryBands } from "@/hooks/useSalaryIntelligence";
import {
  useCompanyContacts,
  useAddCompanyContact,
  useDeleteCompanyContact,
} from "@/hooks/useCompanyContacts";
import { useInterviewQuestionsForCompany } from "@/hooks/useAnalytics";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Stat } from "@/components/ui/Stat";
import { Field, fieldInputClass } from "@/components/ui/Field";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { money } from "@/lib/format";
import type { RiskBand } from "@/types/database";

const bandStyles: Record<RiskBand, "live" | "neutral" | "ghost"> = {
  low: "live",
  medium: "neutral",
  high: "ghost",
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

      <div className="mt-3 mb-6 flex items-center gap-4">
        <Avatar name={company.canonical_name} domain={company.domain} size="lg" />
        <div>
          <h1 className="text-2xl font-semibold">{company.canonical_name}</h1>
          <p className="mt-0.5 text-sm text-ink-70">
            {[company.domain, company.ats_type, company.size_band, company.hq_country]
              .filter(Boolean)
              .join(" · ") || "No further company details on record."}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card padding="none" className="px-3.5 py-3">
          <Stat icon={<Briefcase size={16} />} label="Open roles now" value={company.open_roles_count} />
        </Card>
        <Card padding="none" className="px-3.5 py-3">
          <Stat icon={<TrendingUp size={16} />} label="Roles ever seen" value={company.total_roles_seen} />
        </Card>
        <Card padding="none" className="px-3.5 py-3">
          <Stat
            icon={<Clock size={16} />}
            label="Avg. days open"
            value={
              company.avg_days_open == null || thinHistory
                ? "—"
                : Math.round(company.avg_days_open)
            }
            hint={
              company.avg_days_open == null
                ? "No open roles to measure."
                : thinHistory
                  ? "Not enough history yet."
                  : undefined
            }
          />
        </Card>
        <Card padding="none" className="px-3.5 py-3">
          <Stat
            icon={<Repeat size={16} />}
            label="Repost rate"
            value={
              company.repost_rate == null || thinHistory
                ? "—"
                : `${Math.round(company.repost_rate * 100)}%`
            }
            hint={
              company.repost_rate == null
                ? "No roles on record."
                : thinHistory
                  ? "Not enough history yet."
                  : undefined
            }
          />
        </Card>
      </div>

      <Tabs defaultValue="about" className="mt-6">
        <TabsList>
          <TabsTrigger value="about">About</TabsTrigger>
          <TabsTrigger value="roles">Open roles</TabsTrigger>
          <TabsTrigger value="salary">Salary bands</TabsTrigger>
          <TabsTrigger value="notes">Your notes</TabsTrigger>
          <TabsTrigger value="questions">Interview questions</TabsTrigger>
        </TabsList>

        <TabsContent value="about">
          <AboutTab company={company} />
        </TabsContent>
        <TabsContent value="roles">
          <OpenRolesTab companyId={companyId} />
        </TabsContent>
        <TabsContent value="salary">
          <SalaryBandsTab companyId={companyId} />
        </TabsContent>
        <TabsContent value="notes">
          <CompanyContactsSection companyId={companyId} />
        </TabsContent>
        <TabsContent value="questions">
          <InterviewQuestionsSection companyId={companyId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AboutTab({ company }: { company: { total_roles_seen: number; ghost_low_count: number; ghost_medium_count: number; ghost_high_count: number } }) {
  return (
    <Card>
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
    </Card>
  );
}

function OpenRolesTab({ companyId }: { companyId: string | undefined }) {
  const { data: openRoles, isPending: rolesPending } = useCompanyOpenRoles(companyId);

  if (rolesPending) {
    return (
      <div className="space-y-2" aria-hidden="true">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-app bg-raised" />
        ))}
      </div>
    );
  }

  if (!openRoles || openRoles.length === 0) {
    return (
      <EmptyState
        title="Nothing open right now"
        body="This company has history in the database, but no active postings at the moment."
      />
    );
  }

  return (
    <Card padding="none" className="px-4">
      {openRoles.map((role) => (
        <OpenRoleRow key={role.id} role={role} />
      ))}
    </Card>
  );
}

/**
 * M09's `company_salary_bands` view existed since it was built, with no
 * page reading it until now — SalaryIntelligencePage only ever showed
 * the market-wide summary, never a per-company breakdown.
 */
function SalaryBandsTab({ companyId }: { companyId: string | undefined }) {
  const { data: bands, isPending } = useCompanySalaryBands(companyId);

  if (isPending) return <div className="h-24 animate-pulse rounded-app bg-raised" aria-hidden="true" />;

  if (!bands || bands.length === 0) {
    return (
      <EmptyState
        title="No disclosed salaries yet"
        body="Nothing this company has posted discloses a salary figure — no band to show."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {bands.map((band) => (
        <Card key={band.salary_currency}>
          <p className="text-xs font-medium text-ink-45">{band.salary_currency}</p>
          <p className="tabular mt-1 text-xl font-semibold">
            {money(band.min_salary, band.max_salary, band.salary_currency)}
          </p>
          <p className="mt-1 text-xs text-ink-45">
            Avg {money(band.avg_salary, band.avg_salary, band.salary_currency)}
            {band.avg_salary_usd != null && ` (≈ $${Math.round(band.avg_salary_usd).toLocaleString()} USD)`}
            {" "}· from {band.sample_size} disclosed {band.sample_size === 1 ? "posting" : "postings"}
          </p>
        </Card>
      ))}
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

  if (!questions || questions.length === 0) {
    return (
      <EmptyState
        title="No interview sessions here yet"
        body="Run an AI interview-prep session against a job at this company and it'll show up here."
      />
    );
  }

  return (
    <Card padding="none" className="px-4">
      {questions.map((q, i) => (
        <div key={i} className="border-b border-rule-soft py-2.5 text-sm last:border-b-0">
          <p>{q.question}</p>
          <p className="mt-0.5 text-xs text-ink-45">
            {q.mode} · {new Date(q.asked_at).toLocaleDateString()}
            {q.score != null ? ` · scored ${q.score}/5` : ""}
          </p>
        </div>
      ))}
    </Card>
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
    <Card>
      <div className="grid gap-3 sm:grid-cols-[200px_1fr_auto] sm:items-end">
        <Field label="Contact name" hint="Optional">
          <input
            type="text"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            className={fieldInputClass}
          />
        </Field>
        <Field label="Note">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); handleAdd(); }
            }}
            placeholder="e.g. Sarah in recruiting is great, ping her directly next time"
            className={fieldInputClass}
          />
        </Field>
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
    </Card>
  );
}

function RiskChip({ band, count }: { band: RiskBand; count: number }) {
  return (
    <Badge tone={bandStyles[band]} className="gap-1.5 rounded-full px-2.5 py-1">
      <span className="tabular font-semibold">{count}</span>
      {bandLabel[band]}
    </Badge>
  );
}

function OpenRoleRow({ role }: { role: CompanyOpenRole }) {
  return (
    <div className="flex items-center gap-4 border-b border-rule-soft py-3.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold">{role.title}</span>
          {role.risk_band && <Badge tone={bandStyles[role.risk_band]}>{bandLabel[role.risk_band]}</Badge>}
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
        className="inline-flex shrink-0 items-center gap-1.5 rounded-app border-[1.5px] border-ink px-3 py-1.5 text-sm font-semibold hover:bg-ink hover:text-paper"
      >
        <ExternalLink size={14} /> View posting
      </a>
    </div>
  );
}
