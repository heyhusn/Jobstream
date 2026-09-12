import { Link } from "react-router-dom";
import { useSystemStatus, type SystemStatusLevel } from "@/hooks/useSystemStatus";

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
    <div className="grid min-h-screen place-items-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <Link to="/" className="font-display text-lg font-bold tracking-tight">
          job<span className="text-live">spy</span>
        </Link>
        <h1 className="mt-8 text-2xl font-semibold">System status</h1>

        {isPending && <div className="mt-6 h-20 animate-pulse rounded-app bg-raised" />}
        {isError && <p className="mt-6 text-sm text-ghost">Couldn't load status right now.</p>}

        {data && (
          <div className="mt-6 rounded-app border border-rule bg-raised px-4 py-4">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${STATUS_STYLE[data.status]}`}
            >
              {STATUS_LABEL[data.status]}
            </span>
            {data.message && <p className="mt-3 text-sm leading-relaxed text-ink-70">{data.message}</p>}
            <p className="mt-3 text-xs text-ink-45">
              Last updated {new Date(data.updated_at).toLocaleString()}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
