/**
 * Prompt construction and response validation for build-resume.
 */

export const PROMPT_VERSION = 1;

export interface ResumeBuildContext {
  resumeText: string;
}

const RESUME_CHARS = 10000;

export function buildMessages(ctx: ResumeBuildContext) {
  const system = [
    "You are an expert resume builder. You take unstructured resume text and output",
    "a highly structured JSON object representing a standard, professional resume.",
    "",
    "Absolute rules:",
    "1. Invent nothing. Every claim about the candidate must come from the resume text.",
    "   Do not hallucinate skills, experiences, dates, or jobs.",
    "2. Group experiences logically. If dates are missing, omit them.",
    "3. Provide bullet points for experience entries.",
    "4. Format the output STRICTLY as the following JSON structure:",
    "   {",
    '     "basics": { "name": "...", "email": "...", "phone": "...", "location": "...", "summary": "..." },',
    '     "work": [{ "company": "...", "position": "...", "startDate": "...", "endDate": "...", "highlights": ["..."] }],',
    '     "education": [{ "institution": "...", "area": "...", "studyType": "...", "startDate": "...", "endDate": "..." }],',
    '     "skills": [{ "name": "...", "keywords": ["..."] }]',
    "   }",
    "",
    "Do not include any markdown, just raw JSON. The output must parse perfectly with JSON.parse().",
  ].join("\n");

  const user = [
    "## The resume text",
    fence(truncate(ctx.resumeText, RESUME_CHARS)),
  ].join("\n");

  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
}

function truncate(text: string, max: number) {
  const clean = text.trim();
  return clean.length <= max ? clean : clean.slice(0, max) + "\n[...truncated]";
}

function fence(text: string) {
  const safe = text.replace(/<<<\/?UNTRUSTED>>>/gi, "[marker removed]");
  return `<<<UNTRUSTED>>>\n${safe}\n<<</UNTRUSTED>>>`;
}

export interface ParsedBuildResult {
  basics: Record<string, string>;
  work: Record<string, unknown>[];
  education: Record<string, unknown>[];
  skills: Record<string, unknown>[];
}

export class UnusableResponse extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.name = "UnusableResponse";
    this.retryable = retryable;
  }
}

export function parseBuildResult(raw: string): ParsedBuildResult {
  const trimmed = raw.trim();
  const stripped = trimmed
    .replace(/^```(?:json)?[ \t]*\n?/i, "")
    .replace(/\n?[ \t]*```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    const salvaged = salvage(stripped);
    if (salvaged === undefined) {
      throw new UnusableResponse("The model didn't return JSON.", true);
    }
    parsed = salvaged;
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new UnusableResponse("The model returned JSON, but not an object.", true);
  }
  const obj = parsed as Record<string, unknown>;

  return {
    basics: (obj.basics as Record<string, string>) || {},
    work: (Array.isArray(obj.work) ? obj.work : []),
    education: (Array.isArray(obj.education) ? obj.education : []),
    skills: (Array.isArray(obj.skills) ? obj.skills : []),
  };
}

function salvage(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}
