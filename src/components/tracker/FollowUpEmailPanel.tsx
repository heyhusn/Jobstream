import { useMemo, useState } from "react";
import type { ApplicationItem } from "@/hooks/useApplications";
import { followUpEmail } from "@/lib/followUpEmail";

/** Minor m21 — see followUpEmail.ts for why this is a template, not an AI generation. */
export function FollowUpEmailPanel({ item }: { item: ApplicationItem }) {
  const [copied, setCopied] = useState(false);

  const daysSinceApplied = useMemo(() => {
    if (!item.applied_at) return null;
    const ms = Date.now() - new Date(item.applied_at).getTime();
    return Math.max(0, Math.floor(ms / 86_400_000));
  }, [item.applied_at]);

  if (daysSinceApplied == null || item.stage === "rejected" || item.stage === "withdrawn" || item.stage === "offer") {
    return null;
  }

  const { subject, body } = followUpEmail({
    jobTitle: item.job.title,
    company: item.job.company?.canonical_name ?? "the company",
    daysSinceApplied,
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be refused outright; there's nothing else to fall back to here.
    }
  }

  return (
    <section className="border-t border-rule pt-5">
      <h3 className="mb-2 text-sm font-semibold">Follow-up email</h3>
      <p className="mb-3 text-xs text-ink-70">
        A starting draft — {daysSinceApplied} day{daysSinceApplied === 1 ? "" : "s"} since you
        applied. Edit before sending.
      </p>
      <div className="rounded-app border border-rule bg-raised px-3 py-2.5">
        <p className="text-xs font-medium text-ink-70">{subject}</p>
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink-70">{body}</p>
      </div>
      <button
        type="button"
        onClick={copy}
        className="mt-2 rounded-app border-[1.5px] border-ink px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-ink hover:text-paper"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </section>
  );
}
