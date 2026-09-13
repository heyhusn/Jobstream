import { useMemo, useRef, useState } from "react";
import { FileText, Trash2, Upload } from "lucide-react";
import {
  useResumeVersions,
  useUploadResumeVersion,
  useSetPrimaryResume,
  useDeleteResumeVersion,
  type ResumeVersion,
} from "@/hooks/useResumeVersions";
import { diffLines } from "@/lib/diffText";
import { downloadResumeTxt, downloadResumeRtf, printResumeAsPdf } from "@/lib/resumeExport";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { fieldInputClass } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Minors m01 (version manager + diff), m02 (per-track resume sets),
 * and m03 (multi-format export) all live here — onboarding was
 * previously the only way to ever create a `resumes` row, so this is
 * also the first real place to upload a second version at all.
 */
export function ResumesPage() {
  const { data: versions, isPending } = useResumeVersions();
  const upload = useUploadResumeVersion();
  const setPrimary = useSetPrimaryResume();
  const del = useDeleteResumeVersion();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [trackName, setTrackName] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [compareA, setCompareA] = useState<string>("");
  const [compareB, setCompareB] = useState<string>("");

  async function handleFile(file: File) {
    setUploadError(null);
    if (file.size > 10 * 1024 * 1024) {
      setUploadError("That file is over 10 MB — try a smaller one.");
      return;
    }
    try {
      await upload.mutateAsync({ file, trackName: trackName.trim() || null });
      setTrackName("");
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Couldn't upload that file.");
    }
  }

  const versionA = versions?.find((v) => v.id === compareA);
  const versionB = versions?.find((v) => v.id === compareB);
  const diff = useMemo(() => {
    if (!versionA || !versionB) return null;
    return diffLines(versionA.extracted_text ?? "", versionB.extracted_text ?? "");
  }, [versionA, versionB]);

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Resumes</h1>
        <p className="mt-1 text-sm text-ink-70">
          Every version you've uploaded, optionally labeled by track (AI/ML, backend, etc.).
          Whichever one is marked primary is what cover letters, interview prep, and the resume
          optimiser read from.
        </p>
      </div>

      <Card className="mb-6 border-dashed">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-ink-45" />
          <h2 className="text-sm font-semibold">Upload a new version</h2>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={trackName}
            onChange={(e) => setTrackName(e.target.value)}
            placeholder="Track (optional) — e.g. AI/ML, Backend"
            className={fieldInputClass + " w-auto"}
          />
          <Button
            variant="ghost"
            onClick={() => fileInputRef.current?.click()}
            disabled={upload.isPending}
          >
            <Upload size={15} />
            {upload.isPending ? "Uploading…" : "Choose a file"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
        </div>
        {uploadError && <p className="mt-2 text-xs text-ghost">{uploadError}</p>}
      </Card>

      {isPending && (
        <div className="space-y-2" aria-hidden="true">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      )}

      {!isPending && (!versions || versions.length === 0) && (
        <EmptyState title="No resumes yet" body="Upload one above to get started." />
      )}

      {!isPending && versions && versions.length > 0 && (
        <Card padding="none" className="px-4">
          {versions.map((v) => (
            <ResumeRow
              key={v.id}
              version={v}
              onSetPrimary={() => setPrimary.mutate(v.id)}
              onDelete={() => {
                if (window.confirm(`Delete version ${v.version} (${v.file_name})? This can't be undone.`)) {
                  del.mutate({ id: v.id, storage_path: v.storage_path });
                }
              }}
            />
          ))}
        </Card>
      )}

      {versions && versions.length > 1 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold">Compare two versions</h2>
          <div className="flex flex-wrap gap-2">
            <select
              value={compareA}
              onChange={(e) => setCompareA(e.target.value)}
              className={fieldInputClass + " w-auto"}
            >
              <option value="">Version A…</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version} — {v.file_name}
                </option>
              ))}
            </select>
            <select
              value={compareB}
              onChange={(e) => setCompareB(e.target.value)}
              className={fieldInputClass + " w-auto"}
            >
              <option value="">Version B…</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version} — {v.file_name}
                </option>
              ))}
            </select>
          </div>

          {diff && (
            <Card className="mt-4 max-h-[500px] overflow-y-auto font-mono text-xs leading-relaxed">
              {diff.map((line, i) => (
                <div
                  key={i}
                  className={
                    line.type === "added"
                      ? "bg-live-wash text-live"
                      : line.type === "removed"
                        ? "bg-ghost-wash text-ghost line-through"
                        : "text-ink-70"
                  }
                >
                  {line.type === "added" ? "+ " : line.type === "removed" ? "− " : "  "}
                  {line.text || " "}
                </div>
              ))}
            </Card>
          )}
        </section>
      )}
    </div>
  );
}

function ResumeRow({
  version,
  onSetPrimary,
  onDelete,
}: {
  version: ResumeVersion;
  onSetPrimary: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule-soft py-3.5 last:border-b-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold">v{version.version}</span>
          <span className="truncate text-sm text-ink-70">{version.file_name}</span>
          {version.is_primary && <Badge tone="live">Primary</Badge>}
          {version.track_name && <Badge tone="neutral">{version.track_name}</Badge>}
        </div>
        <p className="mt-0.5 text-xs text-ink-45">
          Uploaded {new Date(version.created_at).toLocaleDateString()}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!version.is_primary && (
          <button
            type="button"
            onClick={onSetPrimary}
            className="text-xs text-ink-70 underline hover:text-ink"
          >
            Set as primary
          </button>
        )}
        <button
          type="button"
          onClick={() => downloadResumeTxt(version.extracted_text ?? "", `${version.file_name}-v${version.version}`)}
          className="rounded-app border border-rule px-2.5 py-1 text-xs font-medium text-ink-70 hover:border-ink hover:text-ink"
        >
          .txt
        </button>
        <button
          type="button"
          onClick={() => downloadResumeRtf(version.extracted_text ?? "", `${version.file_name}-v${version.version}`)}
          className="rounded-app border border-rule px-2.5 py-1 text-xs font-medium text-ink-70 hover:border-ink hover:text-ink"
          title="Rich Text Format — opens in Word, Google Docs, LibreOffice"
        >
          .rtf
        </button>
        <button
          type="button"
          onClick={() => printResumeAsPdf(version.extracted_text ?? "", `${version.file_name}-v${version.version}`)}
          className="rounded-app border border-rule px-2.5 py-1 text-xs font-medium text-ink-70 hover:border-ink hover:text-ink"
          title="Opens your browser's print dialog — choose 'Save as PDF'"
        >
          PDF
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="flex items-center gap-1 text-xs text-ink-45 hover:text-ghost"
        >
          <Trash2 size={12} /> Delete
        </button>
      </div>
    </div>
  );
}
