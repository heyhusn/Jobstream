/**
 * Minor m03: multi-format resume export. Scoped honestly rather than
 * to the roadmap's literal "PDF and DOCX templates" — this app has
 * no DOCX-writing library and no zip/XML tooling to hand-roll a real
 * OOXML file, and adding one is disproportionate for a minor
 * feature. What's shipped instead:
 *
 *   - .txt — the extracted text as-is.
 *   - .rtf — the same content wrapped in minimal Rich Text Format
 *     markup, which Word/Google Docs/LibreOffice all open natively.
 *     This is the Word-compatible format offered in place of true
 *     DOCX, not a mislabeled substitute — it's named .rtf, not .docx.
 *   - PDF — via the browser's native print-to-PDF (a styled,
 *     single-column print view + `window.print()`), not a generated
 *     PDF binary.
 *
 * All three render the SAME already-extracted text single-column and
 * unstyled — which is exactly the "parser-safe" property M10's ATS
 * callout cares about: no tables, multi-column layouts, or text
 * boxes to confuse a resume parser, because there's nothing here but
 * one column of plain paragraphs.
 */

function slugify(parts: (string | null | undefined)[]): string {
  return (
    parts
      .filter(Boolean)
      .join("-")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "resume"
  );
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadResumeTxt(text: string, name: string) {
  download(new Blob([text], { type: "text/plain;charset=utf-8" }), `${slugify([name])}.txt`);
}

/** Escapes RTF control characters and turns newlines into paragraph breaks. */
export function downloadResumeRtf(text: string, name: string) {
  const escaped = text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .split("\n")
    .join("\\par\n");
  const rtf = `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\f0\\fs22 ${escaped}}`;
  download(new Blob([rtf], { type: "application/rtf" }), `${slugify([name])}.rtf`);
}

/** Opens a styled, single-column, print-ready view and triggers the browser's own print-to-PDF. */
export function printResumeAsPdf(text: string, name: string) {
  const win = window.open("", "_blank");
  if (!win) return;
  const escapedHtml = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  win.document.write(`<!doctype html>
<html>
<head>
<title>${name}</title>
<style>
  @page { margin: 2.5cm 2cm; }
  body { font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; line-height: 1.5; color: #111; max-width: 40em; white-space: pre-wrap; }
</style>
</head>
<body>${escapedHtml}</body>
</html>`);
  win.document.close();
  win.focus();
  win.print();
}
