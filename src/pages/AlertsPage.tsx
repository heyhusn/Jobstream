import { useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, fieldInputClass } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Skeleton";
import { money } from "@/lib/format";
import type { RemoteType, RiskBand } from "@/types/database";
import {
  emptyAlertFilter,
  useAlertMatches,
  useCreateJobAlert,
  useDeleteJobAlert,
  useJobAlerts,
  useMarkAlertChecked,
  type AlertFilter,
  type AlertJob,
  type JobAlert,
} from "@/hooks/useJobAlerts";

const bandTone: Record<RiskBand, "live" | "neutral" | "ghost"> = {
  low: "live",
  medium: "neutral",
  high: "ghost",
};
const bandLabel: Record<RiskBand, string> = {
  low: "Looks real",
  medium: "Worth a second look",
  high: "High ghost risk",
};

function summarizeFilter(filter: AlertFilter): string {
  const parts: string[] = [];
  if (filter.remote_type) parts.push(capitalize(filter.remote_type));
  if (filter.min_salary != null) parts.push(`$${Math.round(filter.min_salary / 1000)}k+`);
  if (filter.max_ghost_risk) parts.push(`${filter.max_ghost_risk} ghost risk`);
  if (filter.keywords.length > 0) {
    parts.push(filter.keywords.map((k) => `"${k}"`).join(", "));
  }
  return parts.length > 0 ? parts.join(" · ") : "Any active posting, no filters";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Smart Job Alerts (M16), scoped to what this codebase can actually
 * do (see migration 0014_job_alerts.sql's header comment): there is
 * no scheduler and no email/push infrastructure anywhere in this
 * app, so an "alert" here is a saved filter, checked live whenever
 * this page is open or "Check now" is pressed — never in the
 * background, never by notification.
 */
export function AlertsPage() {
  const { data: alerts, isPending, isError, refetch } = useJobAlerts();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Job alerts</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-70">
          Save a named filter over active postings. There's no email or push notification yet —
          this checks live, right now, whenever you open this page or press "Check now" on an
          alert below.
        </p>
      </div>

      <NewAlertForm />

      <div className="mt-8">
        {isPending && (
          <div className="space-y-3" aria-hidden="true">
            {[...Array(2)].map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        )}

        {isError && <ErrorState onRetry={() => refetch()} />}

        {!isPending && !isError && alerts && alerts.length === 0 && (
          <EmptyState
            title="No alerts yet"
            body="Create one above — name it, set a remote type, salary floor, ghost-risk ceiling, or a few keywords, and this page will show how many active postings match every time you visit."
          />
        )}

        {!isPending && !isError && alerts && alerts.length > 0 && (
          <div className="space-y-3">
            {alerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NewAlertForm() {
  const create = useCreateJobAlert();
  const [name, setName] = useState("");
  const [remoteType, setRemoteType] = useState<RemoteType | "">("");
  const [minSalary, setMinSalary] = useState("");
  const [keywords, setKeywords] = useState("");
  const [maxGhostRisk, setMaxGhostRisk] = useState<RiskBand | "">("");

  const canSave = name.trim().length > 0 && !create.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;

    const filter: AlertFilter = {
      ...emptyAlertFilter(),
      remote_type: remoteType || null,
      min_salary: minSalary.trim() === "" ? null : Number(minSalary),
      keywords: keywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
      max_ghost_risk: maxGhostRisk || null,
    };

    create.mutate(
      { name: name.trim(), filter },
      {
        onSuccess: () => {
          setName("");
          setRemoteType("");
          setMinSalary("");
          setKeywords("");
          setMaxGhostRisk("");
        },
      }
    );
  };

  return (
    <Card>
      <form onSubmit={handleSubmit} aria-label="Create a new job alert">
        <h2 className="mb-3 text-sm font-semibold">New alert</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Name" className="lg:col-span-1">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Staff platform roles"
              className={fieldInputClass}
            />
          </Field>

          <Field label="Remote type">
            <select
              value={remoteType}
              onChange={(e) => setRemoteType(e.target.value as RemoteType | "")}
              className={fieldInputClass}
            >
              <option value="">Any</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">Onsite</option>
            </select>
          </Field>

          <Field label="Minimum salary">
            <input
              type="number"
              min={0}
              step={1000}
              value={minSalary}
              onChange={(e) => setMinSalary(e.target.value)}
              placeholder="Optional"
              className={fieldInputClass}
            />
          </Field>

          <Field label="Keywords">
            <input
              type="text"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="staff, platform"
              className={fieldInputClass}
            />
          </Field>

          <Field label="Max ghost risk">
            <select
              value={maxGhostRisk}
              onChange={(e) => setMaxGhostRisk(e.target.value as RiskBand | "")}
              className={fieldInputClass}
            >
              <option value="">Any</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </Field>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <Button type="submit" disabled={!canSave}>
            {create.isPending ? "Saving…" : "Save alert"}
          </Button>
          {create.isError && (
            <p role="alert" className="text-xs text-ghost">
              Couldn't save that alert. Try again.
            </p>
          )}
        </div>
      </form>
    </Card>
  );
}

function AlertCard({ alert }: { alert: JobAlert }) {
  const { data: matches, isPending, isError, refetch, isFetching } = useAlertMatches(
    alert.filter
  );
  const markChecked = useMarkAlertChecked();
  const remove = useDeleteJobAlert();
  const [expanded, setExpanded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const newCount =
    matches?.filter((job) => new Date(job.first_seen_at) > new Date(alert.last_checked_at))
      .length ?? 0;

  const handleCheckNow = () => {
    refetch();
    markChecked.mutate(alert.id);
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">{alert.name}</h3>
          <p className="mt-0.5 text-sm text-ink-70">{summarizeFilter(alert.filter)}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" onClick={handleCheckNow} disabled={isFetching}>
            {isFetching ? "Checking…" : "Check now"}
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
        {isPending ? (
          <span className="text-ink-45">Checking current matches…</span>
        ) : isError ? (
          <span className="text-ghost">Couldn't check this alert.</span>
        ) : (
          <>
            <StatChip label="matching now" value={matches?.length ?? 0} />
            <StatChip label="new since last check" value={newCount} highlight={newCount > 0} />
            {matches && matches.length > 0 && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="text-sm font-medium text-ink underline"
              >
                {expanded ? "Hide matches" : "Show matches"}
              </button>
            )}
          </>
        )}
      </div>

      <p className="mt-2 text-xs text-ink-45">
        Last checked {new Date(alert.last_checked_at).toLocaleString()}.
      </p>

      {expanded && matches && matches.length > 0 && (
        <div className="mt-3 divide-y divide-rule-soft border-t border-rule">
          {matches.map((job) => (
            <MatchRow key={job.id} job={job} />
          ))}
        </div>
      )}

      <div className="mt-3 border-t border-rule pt-3">
        {confirmingDelete ? (
          <div className="flex items-center gap-3">
            <p className="flex-1 text-sm text-ink-70">Delete this alert?</p>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="rounded-app px-3 py-1.5 text-sm text-ink-70 hover:text-ink"
            >
              Keep
            </button>
            <button
              type="button"
              onClick={() => remove.mutate(alert.id)}
              className="rounded-app border border-ghost bg-ghost px-3 py-1.5 text-sm font-semibold text-paper hover:opacity-90"
            >
              Delete
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="text-sm text-ink-45 transition-colors hover:text-ghost"
          >
            Delete alert
          </button>
        )}
      </div>
    </Card>
  );
}

function StatChip({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <span className={highlight ? "font-semibold text-live" : "text-ink-70"}>
      <span className="tabular font-semibold">{value}</span> {label}
    </span>
  );
}

function MatchRow({ job }: { job: AlertJob }) {
  return (
    <div className="flex items-center gap-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold">{job.title}</span>
          {job.risk_band && <Badge tone={bandTone[job.risk_band]}>{bandLabel[job.risk_band]}</Badge>}
        </div>
        <div className="mt-0.5 truncate text-sm text-ink-45">
          {job.company ? (
            <Link to={`/companies/${job.company.id}`} className="hover:underline">
              {job.company.canonical_name}
            </Link>
          ) : (
            "Unknown company"
          )}{" "}
          — {job.location ?? "Location not listed"}
          {job.remote_type ? ` — ${job.remote_type}` : ""}
          {" — "}
          {money(job.salary_min, job.salary_max, job.salary_currency)}
        </div>
      </div>

      <a
        href={job.apply_url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-app border-[1.5px] border-ink px-3 py-1.5 text-sm font-semibold hover:bg-ink hover:text-paper"
      >
        <ExternalLink size={14} /> View posting
      </a>
    </div>
  );
}
