import { useRef } from "react";
import { useReactToPrint } from "react-to-print";
import { useAsyncTask } from "@/hooks/useAsyncTask";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export function ResumeBuilder() {
  const { state, run } = useAsyncTask<any, { resume: any }>("build_resume");
  const componentRef = useRef<HTMLDivElement>(null);

  // NOTE: react-to-print handles the PDF conversion client-side natively.
  // v3's API takes contentRef and returns the trigger function directly
  // (the old `content: () => node` callback form was removed).
  const handlePrint = useReactToPrint({
    contentRef: componentRef,
  });

  if (state.phase === "idle" || state.phase === "queued" || state.phase === "running") {
    return (
      <Card className="p-4">
        <h2 className="mb-2 text-lg font-semibold">AI Resume Builder</h2>
        <p className="mb-4 text-sm text-ink-70">
          Transform your unstructured resume text into a beautifully formatted, ATS-friendly standard PDF.
        </p>
        <Button
          onClick={() => run({})}
          disabled={state.phase === "queued" || state.phase === "running"}
        >
          {state.phase === "queued" || state.phase === "running" ? "Building..." : "Build Resume PDF"}
        </Button>
      </Card>
    );
  }

  if (state.phase === "failed") {
    return (
      <Card className="p-4 border-error/30 bg-error/5">
        <p className="text-error">{state.error}</p>
        <Button onClick={() => run({})} className="mt-4">Try Again</Button>
      </Card>
    );
  }

  const resume = state.result.resume;
  
  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Resume PDF Preview</h2>
          <p className="text-sm text-ink-70">Your structured AI-generated resume is ready.</p>
        </div>
        <Button onClick={handlePrint}>Download PDF</Button>
      </div>
      <div className="overflow-auto border p-4 bg-ink/5" style={{ maxHeight: "800px" }}>
        <div ref={componentRef} className="bg-canvas text-ink p-8" style={{ width: "21cm", minHeight: "29.7cm", margin: "0 auto", boxSizing: "border-box" }}>
          <header className="mb-6 text-center border-b pb-4 border-ink">
            <h1 className="text-3xl font-bold uppercase">{resume.basics?.name || "Name"}</h1>
            <p className="text-sm mt-2">
              {resume.basics?.email} | {resume.basics?.phone} | {resume.basics?.location}
            </p>
          </header>
          
          <section className="mb-6">
            <h2 className="text-xl font-bold uppercase mb-2 border-b border-ink">Experience</h2>
            {resume.work?.map((w: any, i: number) => (
              <div key={i} className="mb-4">
                <div className="flex justify-between font-bold">
                  <span>{w.position}</span>
                  <span>{w.startDate} - {w.endDate}</span>
                </div>
                <div className="italic mb-2">{w.company}</div>
                <ul className="list-disc pl-5 text-sm space-y-1">
                  {w.highlights?.map((h: string, j: number) => <li key={j}>{h}</li>)}
                </ul>
              </div>
            ))}
          </section>

          <section className="mb-6">
            <h2 className="text-xl font-bold uppercase mb-2 border-b border-ink">Education</h2>
            {resume.education?.map((e: any, i: number) => (
              <div key={i} className="mb-4">
                <div className="flex justify-between font-bold">
                  <span>{e.institution}</span>
                  <span>{e.startDate} - {e.endDate}</span>
                </div>
                <div>{e.studyType} in {e.area}</div>
              </div>
            ))}
          </section>

          <section>
            <h2 className="text-xl font-bold uppercase mb-2 border-b border-ink">Skills</h2>
            <div className="text-sm space-y-1">
              {resume.skills?.map((s: any, i: number) => (
                <div key={i}>
                  <strong>{s.name}:</strong> {s.keywords?.join(", ")}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </Card>
  );
}
