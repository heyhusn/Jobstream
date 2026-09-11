import { Link } from "react-router-dom";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import {
  useAdminOverview,
  useAdminSourceHealth,
  useAdminTaskHealth,
  useIsAdmin,
  type SourceHealthRow,
  type TaskHealthRow,
} from "@/hooks/useAdmin";

const compactNumber = new Intl.NumberFormat("en-US", { notation: "compact" });
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

/**
 * Admin Console (M24) — real cross-user data, gated server-side by
 * `is_admin()` inside every RPC this page calls (migration
 * 0020_admin_console.sql), not by this page existing or not. Source
 * health is a proxy derived from `jobs.last_seen_at`, not a real
 * ingestion-run log — this app doesn't have one — and says so
 * directly rather than implying more visibility than actually exists.
 */
export function AdminPage() {
  const { data: isAdmin, isPending: adminPending } = useIsAdmin();
  const enabled = isAdmin === true;

  const { data: overview, isPending: overviewPending, isError: overviewError, refetch: refetchOverview } =
    useAdminOverview(enabled);
  const { data: taskHealth, isPending: taskPending, isError: taskError } = useAdminTaskHealth(enabled);
  const { data: sourceHealth, isPending: sourcePending, isError: sourceError } = useAdminSourceHealth(enabled);

  if (adminPending) {
    return <div className="h-40 animate-pulse rounded-app bg-raised" aria-hidden="true" />;
  }

  if (!isAdmin) {
    return (
      <EmptyState
        title="Not authorised"
        body="This page is for the project's admin account only. If you believe this is wrong, add your account to private.admin_users directly in the database."
      />
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Admin console</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-70">
          Cross-user operational data — spend, task health, and a source-health proxy. Not a
          real ingestion-run log (this app doesn't have one yet): "last ingested" below is the
          most recent posting seen for that company, which only moves when a real ingestion run
          touches it.
        </p>
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold">Overview</h2>
        {overviewPending && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-hidden="true">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-app bg-raised" />
            ))}
          </div>
        )}
        {overviewError && <ErrorState onRetry={() => refetchOverview()} />}
        {overview && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Users" value={compactNumber.format(overview.total_users)} />
            <StatCard label="Active jobs" value={compactNumber.format(overview.total_active_jobs)} />
            <StatCard label="Applications" value={compactNumber.format(overview.total_applications)} />
            <StatCard label="Unread notifications" value={compactNumber.format(overview.unread_notifications)} />
            <StatCard
              label="Spend today"
              value={usd.format(overview.cost_today_usd)}
              note={
                overview.daily_cost_cap_usd != null
                  ? `of ${usd.format(overview.daily_cost_cap_usd)} cap`
                  : "no cap configured"
              }
            />
            <StatCard label="Credits charged today" value={compactNumber.format(overview.credits_charged_today)} />
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold">Task health, last 24h</h2>
        {taskPending && <div className="h-32 animate-pulse rounded-app bg-raised" aria-hidden="true" />}
        {taskError && <ErrorState />}
        {taskHealth && taskHealth.length === 0 && (
          <EmptyState title="No task activity" body="No tasks have run in the last 24 hours." />
        )}
        {taskHealth && taskHealth.length > 0 && <TaskHealthTable rows={taskHealth} />}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Source health</h2>
        {sourcePending && <div className="h-32 animate-pulse rounded-app bg-raised" aria-hidden="true" />}
        {sourceError && <ErrorState />}
        {sourceHealth && sourceHealth.length === 0 && (
          <EmptyState title="No companies yet" body="Nothing has been ingested yet." />
        )}
        {sourceHealth && sourceHealth.length > 0 && <SourceHealthTable rows={sourceHealth} />}
      </section>
    </div>
  );
}

function StatCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-app border border-rule bg-raised px-3.5 py-3">
      <p className="text-xs font-medium text-ink-45">{label}</p>
      <p className="tabular mt-1 text-xl font-semibold">{value}</p>
      {note && <p className="mt-0.5 text-xs text-ink-45">{note}</p>}
    </div>
  );
}

const STATUS_ORDER = ["failed", "running", "queued", "done"];

function TaskHealthTable({ rows }: { rows: TaskHealthRow[] }) {
  const byType = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const entry = byType.get(row.task_type) ?? {};
    entry[row.status] = row.count;
    byType.set(row.task_type, entry);
  }

  return (
    <div className="overflow-x-auto rounded-app border border-rule bg-raised">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-rule text-left text-xs text-ink-45">
            <th className="px-3 py-2 font-medium">Task type</th>
            {STATUS_ORDER.map((s) => (
              <th key={s} className="px-3 py-2 font-medium capitalize">
                {s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from(byType.entries()).map(([taskType, counts]) => (
            <tr key={taskType} className="border-b border-rule/60 last:border-b-0">
              <td className="px-3 py-2 font-medium">{taskType}</td>
              {STATUS_ORDER.map((s) => (
                <td
                  key={s}
                  className={`tabular px-3 py-2 ${s === "failed" && counts[s] ? "font-semibold text-ghost" : "text-ink-70"}`}
                >
                  {counts[s] ?? 0}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SourceHealthTable({ rows }: { rows: SourceHealthRow[] }) {
  return (
    <div className="overflow-x-auto rounded-app border border-rule bg-raised">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-rule text-left text-xs text-ink-45">
            <th className="px-3 py-2 font-medium">Company</th>
            <th className="px-3 py-2 font-medium">Active jobs</th>
            <th className="px-3 py-2 font-medium">Total jobs seen</th>
            <th className="px-3 py-2 font-medium">Last ingested</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.company_id} className="border-b border-rule/60 last:border-b-0">
              <td className="px-3 py-2 font-medium">
                <Link to={`/companies/${r.company_id}`} className="hover:underline">
                  {r.canonical_name}
                </Link>
              </td>
              <td className="tabular px-3 py-2 text-ink-70">{r.active_jobs}</td>
              <td className="tabular px-3 py-2 text-ink-70">{r.total_jobs}</td>
              <td className="px-3 py-2 text-ink-70">
                {r.last_ingested_at ? new Date(r.last_ingested_at).toLocaleString() : "Never"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
