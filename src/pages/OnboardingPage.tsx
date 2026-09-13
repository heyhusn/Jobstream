import { useCallback, useEffect, useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { extractResumeText } from "@/lib/extractText";
import { useAsyncTask } from "@/hooks/useAsyncTask";
import { Button } from "@/components/ui/Button";
import { TaskState } from "@/components/ui/TaskState";
import { Card } from "@/components/ui/Card";
import { Field, fieldInputClass } from "@/components/ui/Field";

interface ParseInput extends Record<string, unknown> {
  extracted_text: string;
}
interface ParseResult extends Record<string, unknown> {
  skills: string[];
  years_experience: number;
  confidence: number;
  note: string;
}

type Step = "upload" | "confirm";

function StepIndicator({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: "upload", label: "Upload" },
    { id: "confirm", label: "Confirm" },
  ];
  const activeIndex = steps.findIndex((s) => s.id === step);

  return (
    <ol className="mt-6 flex items-center gap-2 text-xs font-medium text-ink-45">
      {steps.map((s, i) => (
        <li key={s.id} className="flex items-center gap-2">
          <span
            className={clsx(
              "flex h-5 w-5 items-center justify-center rounded-full border text-[11px]",
              i <= activeIndex ? "border-ink bg-ink text-paper" : "border-rule text-ink-45"
            )}
          >
            {i + 1}
          </span>
          <span className={i <= activeIndex ? "text-ink" : undefined}>{s.label}</span>
          {i < steps.length - 1 && <span className="mx-1 h-px w-6 bg-rule" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

export function OnboardingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("upload");
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [resumeStoragePath, setResumeStoragePath] = useState<string | null>(null);

  // Editable form state, seeded from the parse but never trusted
  // as-is — nothing is written to the profile until this is saved.
  const [skillsText, setSkillsText] = useState("");
  const [years, setYears] = useState(0);
  const [remotePreference, setRemotePreference] = useState<
    "remote" | "hybrid" | "onsite" | "no_preference"
  >("no_preference");
  const [salaryFloor, setSalaryFloor] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const parseTask = useAsyncTask<ParseInput, ParseResult>("parse_resume");
  const matchTask = useAsyncTask<Record<string, never>, { matches_created: number }>(
    "generate_matches"
  );

  const handleFile = useCallback(
    async (file: File) => {
      setUploadError(null);
      if (!user) return;

      if (file.size > 10 * 1024 * 1024) {
        setUploadError("That file is over 10 MB — try a smaller one.");
        return;
      }

      let text: string;
      try {
        text = await extractResumeText(file);
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Couldn't read that file.");
        return;
      }

      const path = `${user.id}/${Date.now()}-${file.name}`;
      const { error: uploadErr } = await supabase.storage.from("resumes").upload(path, file);
      if (uploadErr) {
        setUploadError(`Upload failed: ${uploadErr.message}`);
        return;
      }

      const { data: resume, error: insertErr } = await supabase
        .from("resumes")
        .insert({
          user_id: user.id,
          storage_path: path,
          file_name: file.name,
          extracted_text: text,
          is_primary: true,
        })
        .select("id")
        .single();

      if (insertErr || !resume) {
        setUploadError(`Couldn't save that upload: ${insertErr?.message ?? "unknown error"}`);
        return;
      }

      setResumeId(resume.id);
      setResumeStoragePath(path);
      await parseTask.run({ extracted_text: text });
    },
    [user, parseTask]
  );

  // Once the parse lands, seed the editable form — this is the
  // only place its output touches the UI directly.
  useEffect(() => {
    if (parseTask.state.phase === "done" && step === "upload") {
      setSkillsText(parseTask.state.result.skills.join(", "));
      setYears(parseTask.state.result.years_experience);
      setStep("confirm");
    }
  }, [parseTask.state, step]);

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    setSaveError(null);

    const skills = skillsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const { error } = await supabase
      .from("profiles")
      .update({
        parsed: { skills },
        years_experience: years,
        remote_preference: remotePreference,
        salary_floor: salaryFloor ? Number(salaryFloor) : null,
        parse_confidence: parseTask.state.phase === "done" ? parseTask.state.result.confidence : null,
        onboarded_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (error) {
      setSaveError(error.message);
      setSaving(false);
      return;
    }

    if (resumeId && parseTask.state.phase === "done") {
      await supabase
        .from("resumes")
        .update({ parse_report: parseTask.state.result })
        .eq("id", resumeId);
    }

    await matchTask.run({});
    setSaving(false);
    navigate("/matches");
  }

  return (
    <div className="grid min-h-screen place-items-center bg-paper px-6 py-12">
      <div className="w-full max-w-lg">
        <span className="font-display text-lg font-bold tracking-tight">
          job<span className="text-live">spy</span>
        </span>

        <StepIndicator step={step} />

        {step === "upload" && (
          <>
            <h1 className="mt-8 text-2xl font-semibold">Upload your resume</h1>
            <p className="mt-1.5 text-sm text-ink-70">
              We'll read it into a profile, then show you exactly what we found before anything
              gets used.
            </p>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={
                "mt-7 rounded-app border-[1.5px] border-dashed px-6 py-14 text-center transition-colors " +
                (dragOver ? "border-ink bg-raised" : "border-ink bg-raised")
              }
            >
              {parseTask.state.phase === "idle" || parseTask.state.phase === "failed" ? (
                <>
                  <p className="font-display text-xl font-semibold">Drop your resume here</p>
                  <p className="mt-2 text-sm text-ink-45">PDF or plain text, up to 10 MB</p>
                  <label className="mt-5 inline-block cursor-pointer">
                    <span className="inline-flex items-center justify-center rounded-app border-[1.5px] border-ink bg-ink px-6 py-3 text-base font-semibold text-paper hover:bg-black">
                      Choose a file
                    </span>
                    <input
                      type="file"
                      accept=".pdf,.txt"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleFile(f);
                      }}
                    />
                  </label>
                </>
              ) : (
                <TaskState
                  phase={parseTask.state.phase}
                  queuedLabel="Queued to read your resume…"
                  runningLabel="Reading your resume…"
                />
              )}
            </div>

            {(uploadError || parseTask.state.phase === "failed") && (
              <div className="mt-4">
                <TaskState
                  phase="failed"
                  errorMessage={
                    uploadError ??
                    (parseTask.state.phase === "failed" ? parseTask.state.error : undefined)
                  }
                  onRetry={() => {
                    setUploadError(null);
                    parseTask.reset();
                  }}
                />
              </div>
            )}
          </>
        )}

        {step === "confirm" && (
          <>
            <h1 className="mt-8 text-2xl font-semibold">Does this look right?</h1>
            <p className="mt-1.5 text-sm text-ink-70">
              This is a first pass, not a verdict. Fix anything wrong before it shapes every match
              you'll see — nothing is saved until you confirm.
            </p>

            <Card className="mt-7 space-y-4">
              <Field label="Skills" htmlFor="skills" hint="Comma-separated. Add or remove freely.">
                <textarea
                  id="skills"
                  rows={3}
                  value={skillsText}
                  onChange={(e) => setSkillsText(e.target.value)}
                  className={fieldInputClass}
                  placeholder="python, fastapi, postgresql…"
                />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Years of experience" htmlFor="years">
                  <input
                    id="years"
                    type="number"
                    min={0}
                    max={50}
                    value={years}
                    onChange={(e) => setYears(Number(e.target.value))}
                    className={fieldInputClass}
                  />
                </Field>
                <Field label="Salary floor (optional)" htmlFor="salaryFloor">
                  <input
                    id="salaryFloor"
                    type="number"
                    min={0}
                    value={salaryFloor}
                    onChange={(e) => setSalaryFloor(e.target.value)}
                    placeholder="e.g. 90000"
                    className={fieldInputClass}
                  />
                </Field>
              </div>

              <Field label="Work arrangement" htmlFor="remote">
                <select
                  id="remote"
                  value={remotePreference}
                  onChange={(e) => setRemotePreference(e.target.value as typeof remotePreference)}
                  className={fieldInputClass}
                >
                  <option value="no_preference">No strong preference</option>
                  <option value="remote">Remote</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="onsite">Onsite</option>
                </select>
              </Field>
            </Card>

            {saveError && (
              <p className="mt-4 rounded-app border border-ghost/40 bg-ghost-wash px-3 py-2 text-sm text-ghost">
                {saveError}
              </p>
            )}

            <div className="mt-6 flex items-center gap-3">
              <Button
                onClick={handleSave}
                disabled={saving || skillsText.trim().length === 0}
                size="big"
              >
                {saving ? "Saving…" : "Looks right — find my matches"}
              </Button>
              <button
                onClick={async () => {
                  // Without this, "Start over" left the just-uploaded
                  // row and its storage file behind and re-dropping a
                  // file inserted a second, unrelated `resumes` row —
                  // every prior row orphaned forever, since nothing
                  // else in the app ever surfaced them until the
                  // Resumes page (minor m01) made all versions
                  // visible and this showed up as duplicate "v1"s.
                  if (resumeId) {
                    await supabase.from("resumes").delete().eq("id", resumeId);
                  }
                  if (resumeStoragePath) {
                    await supabase.storage.from("resumes").remove([resumeStoragePath]);
                  }
                  setResumeId(null);
                  setResumeStoragePath(null);
                  setStep("upload");
                  parseTask.reset();
                }}
                className="text-sm text-ink-45 hover:text-ink"
              >
                Start over
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
