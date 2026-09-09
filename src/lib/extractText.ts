/**
 * Extracts raw text from an uploaded resume so it can be sent to
 * the parse task. PDF and plain text only for now — DOCX needs a
 * separate library and is a reasonable v2 addition, not a blocker
 * for the core flow.
 *
 * pdfjs-dist is dynamically imported rather than loaded at module
 * scope: it's a large library, and every screen that doesn't touch
 * a resume — sign-in, matches, tracker — has no reason to pay for
 * it in the initial bundle.
 */
export async function extractResumeText(file: File): Promise<string> {
  if (file.type === "text/plain") {
    return file.text();
  }

  if (file.type === "application/pdf") {
    const [pdfjs, workerUrl] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.mjs?url").then((m) => m.default),
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

    const buffer = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: buffer }).promise;
    const pages: string[] = [];

    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      pages.push(text);
    }

    return pages.join("\n\n");
  }

  throw new Error(
    "That file type isn't supported yet — upload a PDF or a plain text file."
  );
}
