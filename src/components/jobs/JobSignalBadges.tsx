import { Laptop } from "lucide-react";
import { useSeniorityOverrides, useSetSeniorityOverride } from "@/hooks/useSeniorityOverride";
import { SENIORITY_LABEL, SENIORITY_OPTIONS, VISA_LABEL } from "@/lib/jobSignals";
import { Badge } from "@/components/ui/Badge";
import type { Seniority, VisaSponsorship } from "@/types/database";

interface Props {
  jobId: string;
  seniority: Seniority | null;
  visaSponsorship: VisaSponsorship | null;
  techStack: string[];
  remoteType?: string | null;
}

const REMOTE_LABEL: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };

/**
 * Minors m12 (visa), m13 (seniority, with the per-user override this
 * component is actually for), m14 (tech stack tags), m15 (remote type,
 * already fetched by every caller but never rendered before this
 * redesign) — rendered together since they're all "what does this
 * posting's text say" signals shown in the same expanded-row detail on
 * both MatchRow and SearchPage's result rows.
 */
export function JobSignalBadges({ jobId, seniority, visaSponsorship, techStack, remoteType }: Props) {
  const { data: overrides } = useSeniorityOverrides();
  const setOverride = useSetSeniorityOverride();

  const effectiveSeniority = overrides?.get(jobId) ?? seniority;
  const isOverridden = !!overrides?.get(jobId);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      {remoteType && REMOTE_LABEL[remoteType] && (
        <Badge tone="neutral" className="gap-1">
          <Laptop size={11} /> {REMOTE_LABEL[remoteType]}
        </Badge>
      )}

      {effectiveSeniority && (
        <label className="flex items-center gap-1.5 text-ink-70">
          <span className="font-medium">{SENIORITY_LABEL[effectiveSeniority]}</span>
          {isOverridden && <span className="text-ink-45">(your override)</span>}
          <select
            value={effectiveSeniority}
            onChange={(e) => setOverride.mutate({ jobId, seniority: e.target.value as Seniority })}
            className="rounded-app border border-rule bg-paper px-1.5 py-0.5 text-xs text-ink-70 outline-none focus:border-ink"
            title="Disagree with this? Override it for yourself."
          >
            {SENIORITY_OPTIONS.map((s) => (
              <option key={s} value={s}>
                Set: {SENIORITY_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      )}

      {visaSponsorship && (
        <Badge tone={visaSponsorship === "offered" ? "live" : "neutral"}>
          {VISA_LABEL[visaSponsorship]}
        </Badge>
      )}

      {techStack.map((tag) => (
        <Badge key={tag} tone="neutral">
          {tag}
        </Badge>
      ))}
    </div>
  );
}
