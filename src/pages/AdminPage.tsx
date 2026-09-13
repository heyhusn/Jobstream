import { useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Card } from "@/components/ui/Card";
import { Stat } from "@/components/ui/Stat";
import { Skeleton } from "@/components/ui/Skeleton";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";
import { Button } from "@/components/ui/Button";
import {
  useAdminAction,
  useAdminOverview,
  useAdminSourceHealth,
  useAdminTaskHealth,
  useIsAdmin,
  type AdminActionName,
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
    return <Skeleton className="h-40" />;
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

      <ActionsPanel />

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold">Overview</h2>
        {overviewPending && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-hidden="true">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        )}
        {overviewError && <ErrorState onRetry={() => refetchOverview()} />}
        {overview && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Card padding="none" className="px-3.5 py-3">
              <Stat label="Users" value={compactNumber.format(overview.total_users)} />
            </Card>
            <Card padding="none" className="px-3.5 py-3">
              <Stat label="Active jobs" value={compactNumber.format(overview.total_active_jobs)} />
            </Card>
            <Card padding="none" className="px-3.5 py-3">
              <Stat label="Applications" value={compactNumber.format(overview.total_applications)} />
            </Card>
            <Card padding="none" className="px-3.5 py-3">
              <Stat label="Unread notifications" value={compactNumber.format(overview.unread_notifications)} />
            </Card>
            <Card padding="none" className="px-3.5 py-3">
              <Stat
                label="Spend today"
                value={usd.format(overview.cost_today_usd)}
                hint={
                  overview.daily_cost_cap_usd != null
                    ? `of ${usd.format(overview.daily_cost_cap_usd)} cap`
                    : "no cap configured"
                }
              />
            </Card>
            <Card padding="none" className="px-3.5 py-3">
              <Stat label="Credits charged today" value={compactNumber.format(overview.credits_charged_today)} />
            </Card>
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold">Task health, last 24h</h2>
        {taskPending && <Skeleton className="h-32" />}
        {taskError && <ErrorState />}
        {taskHealth && taskHealth.length === 0 && (
          <EmptyState title="No task activity" body="No tasks have run in the last 24 hours." />
        )}
        {taskHealth && taskHealth.length > 0 && <TaskHealthTable rows={taskHealth} />}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Source health</h2>
        {sourcePending && <Skeleton className="h-32" />}
        {sourceError && <ErrorState />}
        {sourceHealth && sourceHealth.length === 0 && (
          <EmptyState title="No companies yet" body="Nothing has been ingested yet." />
        )}
        {sourceHealth && sourceHealth.length > 0 && <SourceHealthTable rows={sourceHealth} />}
      </section>
    </div>
  );
}

const ACTIONS: { name: AdminActionName; label: string; description: string }[] = [
  {
    name: "ingest_jobs",
    label: "Run ingestion",
    description: "Pulls the latest postings from the configured Greenhouse boards, right now.",
  },
  {
    name: "recompute_ghost_signals",
    label: "Recompute ghost signals",
    description: "Re-scores every active job's ghost-risk band with today's days-open figure.",
  },
  {
    name: "send_notification_digest",
    label: "Send notification digest",
    description:
      "Emails everyone with unread notifications — inert (503) until a real Resend key is configured.",
  },
];

/**
 * The part that makes this a console rather than a dashboard: before
 * this existed, ingestion and the notification digest could only be
 * triggered by curl with a secret that must never reach the browser.
 * `admin-action` holds that secret server-side and re-checks
 * `is_admin()` itself against the caller's verified identity — this
 * panel being reachable client-side grants nothing on its own.
 */
function ActionsPanel() {
  const action = useAdminAction();
  const [running, setRunning] = useState<AdminActionName | null>(null);
  const [lastResult, setLastResult] = useState<{ name: AdminActionName; message: string; ok: boolean } | null>(
    null
  );

  function run(name: AdminActionName) {
    setRunning(name);
    setLastResult(null);
    action.mutate(name, {
      onSuccess: (data) => {
        setRunning(null);
        const summary =
          name === "recompute_ghost_signals"
            ? `Recomputed ${data?.jobs_recomputed ?? "?"} jobs.`
            : JSON.stringify(data?.result ?? data);
        setLastResult({ name, message: summary, ok: data?.success !== false });
      },
      onError: (error) => {
        setRunning(null);
        setLastResult({
          name,
          message: error instanceof Error ? error.message : "Something went wrong.",
          ok: false,
        });
      },
    });
  }

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold">Actions</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {ACTIONS.map((a) => (
          <Card key={a.name}>
            <p className="text-sm font-semibold">{a.label}</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-70">{a.description}</p>
            <Button
              variant="ghost"
              onClick={() => run(a.name)}
              disabled={running !== null}
              className="mt-3"
            >
              {running === a.name ? "Running…" : "Run"}
            </Button>
            {lastResult && lastResult.name === a.name && (
              <p className={`mt-2 text-xs ${lastResult.ok ? "text-live" : "text-ghost"}`}>
                {lastResult.message}
              </p>
            )}
          </Card>
        ))}
      </div>
    </section>
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
    <Table>
      <Thead>
        <tr>
          <Th>Task type</Th>
          {STATUS_ORDER.map((s) => (
            <Th key={s} className="capitalize">{s}</Th>
          ))}
        </tr>
      </Thead>
      <tbody>
        {Array.from(byType.entries()).map(([taskType, counts]) => (
          <Tr key={taskType}>
            <Td className="font-medium">{taskType}</Td>
            {STATUS_ORDER.map((s) => (
              <Td
                key={s}
                className={`tabular ${s === "failed" && counts[s] ? "font-semibold text-ghost" : "text-ink-70"}`}
              >
                {counts[s] ?? 0}
              </Td>
            ))}
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

function SourceHealthTable({ rows }: { rows: SourceHealthRow[] }) {
  return (
    <Table>
      <Thead>
        <tr>
          <Th>Company</Th>
          <Th>Active jobs</Th>
          <Th>Total jobs seen</Th>
          <Th>Last ingested</Th>
        </tr>
      </Thead>
      <tbody>
        {rows.map((r) => (
          <Tr key={r.company_id}>
            <Td className="font-medium">
              <Link to={`/companies/${r.company_id}`} className="hover:underline">
                {r.canonical_name}
              </Link>
            </Td>
            <Td className="tabular text-ink-70">{r.active_jobs}</Td>
            <Td className="tabular text-ink-70">{r.total_jobs}</Td>
            <Td className="text-ink-70">
              {r.last_ingested_at ? new Date(r.last_ingested_at).toLocaleString() : "Never"}
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
