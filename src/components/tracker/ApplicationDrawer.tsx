import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import type { ApplicationItem, ApplicationPatch } from "@/hooks/useApplications";
import { useDeleteApplication, useResumes, useUpdateApplication } from "@/hooks/useApplications";
import type { ApplicationStage } from "@/types/database";
import { STAGES } from "@/lib/stages";
import { fromDateInput, money, toDateInput } from "@/lib/format";
import { CoverLetterPanel } from "./CoverLetterPanel";

const NOTES_DEBOUNCE_MS = 700;

interface Props {
  item: ApplicationItem;
  score?: number;
  onClose: () => void;
}

/**
 * Mount this with `key={item.id}` — the parent swapping the key is
 * what resets the notes draft between cards. Deriving that reset
 * from a prop effect instead would clobber whatever the person had
 * typed in the window between debounce and cache write.
 */
export function ApplicationDrawer({ item, score, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const update = useUpdateApplication();
  const remove = useDeleteApplication();
  const { data: resumes } = useResumes();

  const [notes, setNotes] = useState(item.notes ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const notesTimer = useRef<number | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);

    // Move focus into the panel so a keyboard user isn't left
    // behind on the board with an open dialog they can't reach.
    panelRef.current
      ?.querySelector<HTMLElement>("button, select, input, textarea, a[href]")
      ?.focus();

    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // A note typed and not yet flushed must survive the drawer
  // closing — otherwise a fast close eats the last few characters.
  useEffect(() => {
    return () => {
      if (notesTimer.current) window.clearTimeout(notesTimer.current);
    };
  }, []);

  function patch(fields: ApplicationPatch) {
    update.mutate({ id: item.id, patch: fields });
  }

  function onNotesChange(value: string) {
    setNotes(value);
    if (notesTimer.current) window.clearTimeout(notesTimer.current);
    notesTimer.current = window.setTimeout(() => {
      notesTimer.current = null;
      patch({ notes: value.trim() === "" ? null : value });
    }, NOTES_DEBOUNCE_MS);
  }

  function flushNotes() {
    if (!notesTimer.current) return;
    window.clearTimeout(notesTimer.current);
    notesTimer.current = null;
    if ((item.notes ?? "") !== notes) {
      patch({ notes: notes.trim() === "" ? null : notes });
    }
  }

  function onStageChange(stage: ApplicationStage) {
    patch({
      stage,
      // Same rule as a drag into Applied: stamp the date once, and
      // never overwrite one the person set.
      ...(stage === "applied" && !item.applied_at ? { applied_at: new Date().toISOString() } : {}),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink/25 backdrop-blur-[1px]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-full w-full max-w-[560px] flex-col overflow-y-auto border-l border-rule bg-paper shadow-2xl"
      >
        <header className="sticky top-0 z-10 border-b border-rule bg-paper/95 px-5 py-4 backdrop-blur-sm">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-lg font-semibold leading-tight">
                {item.job.title}
              </h2>
              <p className="mt-0.5 truncate text-sm text-ink-45">
                {item.job.company?.canonical_name ?? "Unknown company"}
                {item.job.location ? ` — ${item.job.location}` : ""}
              </p>
            </div>
            {score != null && (
              <span className="tabular shrink-0 rounded-full bg-live-wash px-2 py-1 text-xs font-semibold text-live">
                {Math.round(score)}
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="-mr-1 shrink-0 rounded-app px-2 py-1 text-sm text-ink-45 transition-colors hover:bg-rule-soft hover:text-ink"
            >
              Close
            </button>
          </div>
          <p className="mt-2 text-sm text-ink-70">
            {money(item.job.salary_min, item.job.salary_max, item.job.salary_currency)}
          </p>
        </header>

        <div className="flex-1 space-y-5 px-5 py-5">
          <Field label="Stage">
            <select
              value={item.stage}
              onChange={(e) => onStageChange(e.target.value as ApplicationStage)}
              className={inputClass}
            >
              {STAGES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Applied on">
              <input
                type="date"
                value={toDateInput(item.applied_at)}
                onChange={(e) => patch({ applied_at: fromDateInput(e.target.value) })}
                className={inputClass}
              />
            </Field>
            <Field label="Next action" hint="Follow-up, interview, deadline">
              <input
                type="date"
                value={toDateInput(item.next_action_at)}
                onChange={(e) => patch({ next_action_at: fromDateInput(e.target.value) })}
                className={inputClass}
              />
            </Field>
          </div>

          <Field
            label="Applied with"
            hint={
              resumes && resumes.length === 0
                ? "No resume versions yet — upload one in onboarding."
                : undefined
            }
          >
            <select
              value={item.resume_version_id ?? ""}
              onChange={(e) => patch({ resume_version_id: e.target.value || null })}
              disabled={!resumes || resumes.length === 0}
              className={inputClass}
            >
              <option value="">Not recorded</option>
              {(resumes ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  v{r.version} — {r.file_name}
                  {r.is_primary ? " (primary)" : ""}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Notes" hint="Recruiter name, referral, what you asked for. Saves as you type.">
            <textarea
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              onBlur={flushNotes}
              rows={4}
              placeholder="Screen with Dana on the 14th. Asked about the on-call rotation — she's checking."
              className={clsx(inputClass, "resize-y leading-relaxed")}
            />
          </Field>

          <a
            href={item.job.apply_url}
            target="_blank"
            rel="noreferrer"
            className="inline-block rounded-app border-[1.5px] border-ink px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-ink hover:text-paper"
          >
            View posting
          </a>

          <CoverLetterPanel item={item} />
        </div>

        <footer className="sticky bottom-0 border-t border-rule bg-paper/95 px-5 py-4 backdrop-blur-sm">
          {confirmingDelete ? (
            <div className="flex items-center gap-3">
              <p className="flex-1 text-sm text-ink-70">
                Remove from tracker? Notes and dates go with it.
              </p>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded-app px-3 py-1.5 text-sm text-ink-70 hover:text-ink"
              >
                Keep
              </button>
              <button
                type="button"
                onClick={() => {
                  if (notesTimer.current) window.clearTimeout(notesTimer.current);
                  notesTimer.current = null;
                  remove.mutate(item.id);
                  onClose();
                }}
                className="rounded-app border border-ghost bg-ghost px-3 py-1.5 text-sm font-semibold text-paper hover:opacity-90"
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="text-sm text-ink-45 transition-colors hover:text-ghost"
            >
              Remove from tracker
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-app border border-rule bg-raised px-3 py-2 text-sm text-ink " +
  "transition-colors focus:border-ink disabled:cursor-not-allowed disabled:opacity-60";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-70">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-ink-45">{hint}</span>}
    </label>
  );
}
