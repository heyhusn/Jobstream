import { useSystemStatus, type SystemStatusLevel } from "@/hooks/useSystemStatus";
import { Card } from "@/components/ui/Card";
import { PublicHeader } from "@/components/layout/PublicHeader";

const STATUS_LABEL: Record<SystemStatusLevel, string> = {
  operational: "All systems operational",
  degraded: "Degraded performance",
  outage: "Outage",
};
const STATUS_STYLE: Record<SystemStatusLevel, string> = {
  operational: "bg-live-wash text-live",
  degraded: "bg-rule text-ink-70",
  outage: "bg-ghost-wash text-ghost",
};

/** Minor m40: public, no sign-in required — a status page behind auth defeats the point. */
export function StatusPage() {
  const { data, isPending, isError } = useSystemStatus();

  return (
    <div className="min-h-screen bg-paper">
      <PublicHeader />
      <div className="grid min-h-[calc(100vh-62px)] place-items-center px-6 py-12">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold">System status</h1>

          {isPending && <div className="mt-6 h-20 animate-pulse rounded-app bg-raised" />}
          {isError && <p className="mt-6 text-sm text-ghost">Couldn't load status right now.</p>}

          {data && (
            <Card className="mt-6">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${STATUS_STYLE[data.status]}`}
              >
                {STATUS_LABEL[data.status]}
              </span>
              {data.message && <p className="mt-3 text-sm leading-relaxed text-ink-70">{data.message}</p>}
              <p className="mt-3 text-xs text-ink-45">
                Last updated {new Date(data.updated_at).toLocaleString()}
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
