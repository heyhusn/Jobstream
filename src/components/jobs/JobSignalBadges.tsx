import { useSeniorityOverrides, useSetSeniorityOverride } from "@/hooks/useSeniorityOverride";
import { SENIORITY_LABEL, SENIORITY_OPTIONS, VISA_LABEL } from "@/lib/jobSignals";
import type { Seniority, VisaSponsorship } from "@/types/database";

interface Props {
  jobId: string;
  seniority: Seniority | null;
  visaSponsorship: VisaSponsorship | null;
  techStack: string[];
}

/**
 * Minors m12 (visa), m13 (seniority, with the per-user override this
 * component is actually for), m14 (tech stack tags) — rendered
 * together since they're all "what does this posting's text say"
 * signals shown in the same expanded-row detail on both MatchRow and
 * SearchPage's result rows.
 */
export function JobSignalBadges({ jobId, seniority, visaSponsorship, techStack }: Props) {
  const { data: overrides } = useSeniorityOverrides();
  const setOverride = useSetSeniorityOverride();

  const effectiveSeniority = overrides?.get(jobId) ?? seniority;
  const isOverridden = !!overrides?.get(jobId);

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
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
        <span
          className={
            visaSponsorship === "offered"
              ? "rounded-full bg-live-wash px-2 py-0.5 font-medium text-live"
              : "rounded-full bg-rule px-2 py-0.5 font-medium text-ink-70"
          }
        >
          {VISA_LABEL[visaSponsorship]}
        </span>
      )}

      {techStack.length > 0 &&
        techStack.map((tag) => (
          <span key={tag} className="rounded-full border border-rule px-2 py-0.5 text-ink-70">
            {tag}
          </span>
        ))}
    </div>
  );
}
