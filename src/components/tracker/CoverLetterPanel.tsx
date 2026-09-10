import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useAsyncTask } from "@/hooks/useAsyncTask";
import { useAuth } from "@/hooks/useAuth";
import { useCreditBalance } from "@/hooks/useCreditBalance";
import {
  coverLetterKey,
  draftKey,
  useCoverLetter,
  useDeleteCoverLetter,
  useInFlightCoverLetterTask,
  useUpdateCoverLetter,
  type CoverLetterTaskResult,
} from "@/hooks/useCoverLetter";
import type { ApplicationItem } from "@/hooks/useApplications";
import type { CoverLetterTone } from "@/types/database";
import { TaskState } from "@/components/ui/TaskState";

const SAVE_DEBOUNCE_MS = 900;

const TONES: { id: CoverLetterTone; label: string; hint: string }[] = [
  { id: "professional", label: "Professional", hint: "Measured and precise." },
  { id: "warm", label: "Warm", hint: "Human and specific, still a letter." },
  { id: "direct", label: "Direct", hint: "Short sentences, evidence first." },
];

interface Props {
  item: ApplicationItem;
}

/**
 * The cover letter section of the application drawer.
 *
 * Generation goes through the `tasks` table like every other AI
 * feature — the client writes a row and watches it, and never
 * talks to the model or holds an API key. What comes back is a
 * row in `cover_letters` the person can edit in place.
 */
export function CoverLetterPanel({ item }: Props) {
  const jobId = item.job.id;
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: letter, isPending } = useCoverLetter(jobId);
  const { data: credits } = useCreditBalance();
  const update = useUpdateCoverLetter(jobId);
  const remove = useDeleteCoverLetter(jobId);

  const { state: task, run, watch, reset } = useAsyncTask<
    Record<string, unknown>,
    CoverLetterTaskResult
  >("cover_letter");

  const { data: inFlightTaskId } = useInFlightCoverLetterTask(jobId);

  const [tone, setTone] = useState<CoverLetterTone>("professional");
  const [notes, setNotes] = useState("");
  const [showOptions, setShowOptions] = useState(false);
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [copied, setCopied] = useState(false);
  const adoptedRef = useRef<string | null>(null);

  // A generation started before the drawer was closed is still
  // running server-side. Pick it back up rather than offering a
  // button that would spend a second credit on the same letter.
  useEffect(() => {
    if (!inFlightTaskId || adoptedRef.current === inFlightTaskId) return;
    if (task.phase !== "idle") return;
    adoptedRef.current = inFlightTaskId;
    watch(inFlightTaskId);
  }, [inFlightTaskId, task.phase, watch]);

  // The function wrote the row; pull it in, and re-read the balance
  // in case the realtime update on credit_balances didn't land.
  useEffect(() => {
    if (task.phase !== "done") return;
    adoptedRef.current = null;
    qc.invalidateQueries({ queryKey: coverLetterKey(user?.id, jobId) });
    qc.invalidateQueries({ queryKey: ["credit-balance", user?.id] });
    qc.invalidateQueries({ queryKey: ["cover-letter-task", user?.id, jobId] });
    // A stale "that edit didn't save" from before the regenerate
    // would otherwise sit under a draft it has nothing to do with.
    update.reset();
  }, [task.phase, qc, user?.id, jobId, update]);

  const busy = task.phase === "queued" || task.phase === "running";
  // Unknown is not "yes". Treating a loading or failed balance as
  // "has credits" let a spent-out user click through to a server-side
  // rejection, and left the button live forever if the query errored.
  const outOfCredits = credits == null || credits.credits_remaining < 1;
  const placeholders = task.phase === "done" ? (task.result?.placeholders ?? []) : [];

  function generate() {
    setConfirmingRegenerate(false);
    setConfirmingDiscard(false);
    update.reset();
    reset();
    run({
      job_id: jobId,
      application_id: item.id,
      tone,
      notes: notes.trim() || null,
    });
  }

  return (
    <section className="border-t border-rule pt-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">Cover letter</h3>
        {letter && (
          <p className="text-[11px] text-ink-70">
            {letter.model}
            {letter.edited ? " · edited by you" : ""}
          </p>
        )}
      </div>

      {busy && (
        <TaskState
          phase={task.phase}
          queuedLabel="Queued — this takes a few seconds."
          runningLabel="Reading the posting and your resume…"
        />
      )}

      {task.phase === "failed" && (
        <div className="mb-3">
          <TaskState phase="failed" errorMessage={task.error} onRetry={generate} />
        </div>
      )}

      {/* A failed regenerate is not a reason to take away the draft
          that is still sitting in the database — the person can no
          longer even copy it, and the only listed way out is another
          credit. The error shows above; the letter stays. */}
      {!busy && (
        <>
          {isPending && <div className="h-24 animate-pulse rounded-app bg-raised" />}

          {!isPending && !letter && task.phase !== "failed" && (
            <Composer
              tone={tone}
              setTone={setTone}
              notes={notes}
              setNotes={setNotes}
              showOptions={showOptions}
              setShowOptions={setShowOptions}
              outOfCredits={outOfCredits}
              onGenerate={generate}
              label="Draft a cover letter"
            />
          )}

          {!isPending && letter && (
            <LetterEditor
              key={draftKey(letter)}
              letterId={letter.id}
              initialSubject={letter.subject}
              initialBody={letter.body}
              placeholders={placeholders}
              copied={copied}
              setCopied={setCopied}
              onSave={(subject, body) => update.mutate({ id: letter.id, subject, body })}
              saveFailed={update.isError}
              confirming={confirmingRegenerate}
              edited={letter.edited}
              outOfCredits={outOfCredits}
              onRegenerate={() => (letter.edited ? setConfirmingRegenerate(true) : generate())}
              onConfirmRegenerate={generate}
              onCancelRegenerate={() => setConfirmingRegenerate(false)}
              confirmingDiscard={confirmingDiscard}
              onDiscard={() => setConfirmingDiscard(true)}
              onConfirmDiscard={() => {
                setConfirmingDiscard(false);
                remove.mutate(letter.id);
              }}
              onCancelDiscard={() => setConfirmingDiscard(false)}
              jobTitle={item.job.title}
              company={item.job.company?.canonical_name ?? null}
            />
          )}
        </>
      )}
    </section>
  );
}

function Composer({
  tone,
  setTone,
  notes,
  setNotes,
  showOptions,
  setShowOptions,
  outOfCredits,
  onGenerate,
  label,
}: {
  tone: CoverLetterTone;
  setTone: (t: CoverLetterTone) => void;
  notes: string;
  setNotes: (n: string) => void;
  showOptions: boolean;
  setShowOptions: (b: boolean) => void;
  outOfCredits: boolean;
  onGenerate: () => void;
  label: string;
}) {
  return (
    <div className="rounded-app border border-dashed border-rule bg-raised px-4 py-4">
      <p className="text-sm leading-relaxed text-ink-70">
        Written from your resume and this posting. It won't claim anything your resume doesn't —
        read it before you send it.
      </p>

      <button
        type="button"
        onClick={() => setShowOptions(!showOptions)}
        aria-expanded={showOptions}
        className="mt-3 text-xs font-medium text-ink-70 underline hover:text-ink"
      >
        {showOptions ? "Hide options" : "Tone and notes"}
      </button>

      {showOptions && (
        <div className="mt-3 space-y-3">
          <fieldset>
            <legend className="mb-1.5 text-xs font-medium text-ink-70">Tone</legend>
            <div className="flex flex-wrap gap-1.5">
              {TONES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTone(t.id)}
                  aria-pressed={tone === t.id}
                  title={t.hint}
                  className={clsx(
                    "rounded-app border px-2.5 py-1 text-xs font-medium transition-colors",
                    tone === t.id
                      ? "border-ink bg-ink text-paper"
                      : "border-rule text-ink-70 hover:border-ink hover:text-ink"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-ink-70">
              {TONES.find((t) => t.id === tone)?.hint}
            </p>
          </fieldset>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-70">
              Anything to work in
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Referred by Sana on the platform team. Available from November."
              className="w-full rounded-app border border-rule bg-paper px-3 py-2 text-sm transition-colors focus:border-ink"
            />
          </label>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onGenerate}
          disabled={outOfCredits}
          className="rounded-app border-[1.5px] border-ink bg-ink px-3.5 py-2 text-sm font-semibold text-paper transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          {label}
        </button>
        <span className="text-xs text-ink-70">1 credit</span>
        {outOfCredits && (
          <Link to="/settings/billing" className="text-xs text-ghost underline">
            You're out of credits
          </Link>
        )}
      </div>
    </div>
  );
}

function LetterEditor({
  letterId,
  initialSubject,
  initialBody,
  placeholders,
  copied,
  setCopied,
  onSave,
  saveFailed,
  confirming,
  edited,
  outOfCredits,
  onRegenerate,
  onConfirmRegenerate,
  onCancelRegenerate,
  confirmingDiscard,
  onDiscard,
  onConfirmDiscard,
  onCancelDiscard,
  jobTitle,
  company,
}: {
  letterId: string;
  initialSubject: string | null;
  initialBody: string;
  placeholders: string[];
  copied: boolean;
  setCopied: (b: boolean) => void;
  onSave: (subject: string | null, body: string) => void;
  saveFailed: boolean;
  confirming: boolean;
  edited: boolean;
  outOfCredits: boolean;
  onRegenerate: () => void;
  onConfirmRegenerate: () => void;
  onCancelRegenerate: () => void;
  confirmingDiscard: boolean;
  onDiscard: () => void;
  onConfirmDiscard: () => void;
  onCancelDiscard: () => void;
  jobTitle: string;
  company: string | null;
}) {
  // Mounted with key={letter.id}, so a regenerated letter arrives
  // as a fresh editor rather than fighting a stale draft.
  const [subject, setSubject] = useState(initialSubject ?? "");
  const [body, setBody] = useState(initialBody);
  const timer = useRef<number | null>(null);
  // The last text this editor put on the wire, so an echo of our own
  // save isn't mistaken for a new draft arriving.
  const sent = useRef<{ subject: string | null; body: string } | null>(null);

  // Adopt a draft that arrived from the server.
  //
  // Regeneration upserts on `unique (user_id, job_id)`, so the row id
  // does not change and remounting on it never happens: without this
  // the editor keeps showing the previous draft after a regenerate,
  // and the next keystroke saves that stale text back over the new
  // one. Local edits still win — a pending save or text we just sent
  // is never overwritten by its own round trip.
  useEffect(() => {
    if (timer.current) return;
    if (sent.current?.body === initialBody && sent.current?.subject === (initialSubject ?? null)) {
      return;
    }
    setBody((current) => (current === initialBody ? current : initialBody));
    setSubject((current) => (current === (initialSubject ?? "") ? current : initialSubject ?? ""));
  }, [initialBody, initialSubject]);

  // Kept fresh so the unmount flush writes what is on screen now.
  // Assigned in an effect, not during render — a ref written while
  // rendering is unsafe under concurrent rendering.
  const latest = useRef({ subject, body, onSave });
  useEffect(() => {
    latest.current = { subject, body, onSave };
  });

  // Closing the drawer, or pressing Escape, unmounts this while a
  // save may still be debounced. Escape never blurs the textarea, so
  // onBlur doesn't cover it — clearing the timer alone would eat the
  // last second of typing under a label reading "saves as you type".
  useEffect(() => {
    return () => {
      if (!timer.current) return;
      window.clearTimeout(timer.current);
      timer.current = null;
      const { subject: sub, body: bod, onSave: save } = latest.current;
      sent.current = { subject: sub.trim() || null, body: bod };
      save(sub.trim() || null, bod);
    };
  }, []);

  function queueSave(nextSubject: string, nextBody: string) {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      sent.current = { subject: nextSubject.trim() || null, body: nextBody };
      onSave(nextSubject.trim() || null, nextBody);
    }, SAVE_DEBOUNCE_MS);
  }

  function flush() {
    if (!timer.current) return;
    window.clearTimeout(timer.current);
    timer.current = null;
    sent.current = { subject: subject.trim() || null, body };
    onSave(subject.trim() || null, body);
  }

  async function copy() {
    const text = subject ? `${subject}\n\n${body}` : body;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused outright (insecure context,
      // a permission policy). Selecting the textarea is the honest
      // fallback: the person can still hit their own copy shortcut.
      document.getElementById(`letter-body-${letterId}`)?.focus();
      (document.getElementById(`letter-body-${letterId}`) as HTMLTextAreaElement | null)?.select();
    }
  }

  function download() {
    const text = subject ? `${subject}\n\n${body}` : body;
    const slug = [company, jobTitle]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `cover-letter-${slug || "draft"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      {placeholders.length > 0 && (
        <p
          role="alert"
          className="rounded-app border border-ghost/40 bg-ghost-wash px-3 py-2 text-xs leading-relaxed text-ghost"
        >
          The model left {placeholders.length === 1 ? "a placeholder" : "placeholders"} in this
          draft: {placeholders.join(", ")}. Fill {placeholders.length === 1 ? "it" : "them"} in
          before you send it.
        </p>
      )}

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-ink-70">Subject line</span>
        <input
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value);
            queueSave(e.target.value, body);
          }}
          onBlur={flush}
          className="w-full rounded-app border border-rule bg-raised px-3 py-2 text-sm transition-colors focus:border-ink"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-ink-70">
          Letter <span className="font-normal text-ink-70">— saves as you type</span>
        </span>
        <textarea
          id={`letter-body-${letterId}`}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            queueSave(subject, e.target.value);
          }}
          onBlur={flush}
          rows={16}
          className="w-full resize-y rounded-app border border-rule bg-raised px-3 py-2 text-sm leading-relaxed transition-colors focus:border-ink"
        />
      </label>

      {saveFailed && (
        <p role="alert" className="text-xs text-ghost">
          That edit didn't save. Your text is still here — check your connection.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={copy}
          className="rounded-app border-[1.5px] border-ink px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-ink hover:text-paper"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          onClick={download}
          className="rounded-app border border-rule px-3 py-1.5 text-sm font-medium text-ink-70 transition-colors hover:border-ink hover:text-ink"
        >
          Download .txt
        </button>
        <button
          type="button"
          onClick={onRegenerate}
          disabled={outOfCredits}
          className="rounded-app border border-rule px-3 py-1.5 text-sm font-medium text-ink-70 transition-colors hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          Regenerate
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="ml-auto rounded-app px-2 py-1.5 text-sm text-ink-70 transition-colors hover:text-ghost"
        >
          Discard
        </button>
      </div>

      {confirmingDiscard && (
        <div role="alertdialog" aria-label="Discard this letter?" className="rounded-app border border-ghost/40 bg-ghost-wash px-3 py-2.5">
          <p className="text-xs leading-relaxed text-ink-70">
            Discard this letter? Your edits go with it, and writing another costs a credit.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              // Focused on mount so the confirmation isn't silently
              // inserted below a screen reader user's cursor.
              ref={(el) => el?.focus()}
              onClick={onCancelDiscard}
              className="rounded-app border-[1.5px] border-ink px-3 py-1 text-xs font-semibold"
            >
              Keep it
            </button>
            <button
              type="button"
              onClick={onConfirmDiscard}
              className="rounded-app border border-ghost bg-ghost px-3 py-1 text-xs font-semibold text-paper hover:opacity-90"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {confirming && (
        <div
          role="alertdialog"
          aria-label="Replace this letter?"
          className="rounded-app border border-rule bg-raised px-3 py-2.5"
        >
          <p className="text-xs leading-relaxed text-ink-70">
            {edited
              ? "You've edited this letter. Regenerating replaces it with a new draft and costs another credit."
              : "Regenerating replaces this draft and costs another credit."}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              // Focus follows the confirmation, so a keyboard or
              // screen-reader user knows it appeared at all.
              ref={(el) => el?.focus()}
              onClick={onConfirmRegenerate}
              className="rounded-app border-[1.5px] border-ink bg-ink px-3 py-1 text-xs font-semibold text-paper"
            >
              Replace it
            </button>
            <button
              type="button"
              onClick={onCancelRegenerate}
              className="rounded-app px-3 py-1 text-xs text-ink-70 hover:text-ink"
            >
              Keep what I have
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
