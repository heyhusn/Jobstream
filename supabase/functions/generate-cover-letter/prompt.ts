/**
 * Prompt construction and response validation, kept apart from the
 * handler so both can be exercised without a Supabase project, an
 * API key, or a network. Everything here is pure.
 */

export const PROMPT_VERSION = 1;

export type Tone = "professional" | "warm" | "direct";

export const TONES: Tone[] = ["professional", "warm", "direct"];

export function isTone(value: unknown): value is Tone {
  return typeof value === "string" && (TONES as string[]).includes(value);
}

const TONE_GUIDANCE: Record<Tone, string> = {
  professional:
    "Measured and precise. Complete sentences, no exclamation marks, no slang. " +
    "Confident without selling.",
  warm:
    "Human and specific. First person, contractions allowed, a genuine reason for " +
    "wanting this particular job. Still a professional letter, not a note to a friend.",
  direct:
    "Short sentences. Lead with the strongest evidence. No throat-clearing, no " +
    "pleasantries beyond the greeting. Every paragraph earns its place.",
};

export interface LetterContext {
  fullName: string | null;
  yearsExperience: number | null;
  skills: string[];
  /** Extracted text of the primary resume, if there is one. */
  resumeText: string | null;
  jobTitle: string;
  companyName: string | null;
  jobLocation: string | null;
  jobDescription: string;
  tone: Tone;
  /** Anything the person asked to have worked in — a referral, a date, a caveat. */
  notes: string | null;
}

/** Rough token budget for the two long fields. */
const RESUME_CHARS = 6000;
const JD_CHARS = 5000;

export function buildMessages(ctx: LetterContext) {
  const system = [
    "You write cover letters that a hiring manager reads to the end.",
    "",
    "Absolute rules:",
    "1. Invent nothing. Every claim about the candidate must come from the profile",
    "   or resume text you are given. If the resume does not mention an employer,",
    "   a metric, a degree, or a technology, it does not go in the letter. A letter",
    "   that overstates gets the candidate caught in the interview.",
    "2. Never write a placeholder like [Company Name], [Your Name], or [X years].",
    "   Use the real values provided. If a value is genuinely missing, rewrite the",
    "   sentence so it isn't needed.",
    "3. No opening cliches. Never start with 'I am writing to express my interest',",
    "   'I am excited to apply', or 'As a passionate'. Open with something only this",
    "   candidate could say about this job.",
    "4. Name specific overlaps between the resume and the posting. Vague enthusiasm",
    "   is worthless; 'you need X, I built X at Y' is the whole point.",
    "5. 250 to 350 words, 3 or 4 paragraphs, plain text, paragraphs separated by a",
    "   blank line. No markdown, no bullet lists, no signature block, no address",
    "   header — the body only, starting at the greeting.",
    "",
    "Return only a JSON object of the form:",
    '{"subject": "<email subject line, under 70 characters>", "body": "<the letter>"}',
  ].join("\n");

  const profileLines = [
    ctx.fullName ? `Name: ${ctx.fullName}` : null,
    ctx.yearsExperience != null ? `Years of experience: ${ctx.yearsExperience}` : null,
    ctx.skills.length ? `Skills on file: ${ctx.skills.join(", ")}` : null,
  ].filter(Boolean);

  const user = [
    "## The job",
    `Title: ${ctx.jobTitle}`,
    ctx.companyName ? `Company: ${ctx.companyName}` : "Company: not stated",
    ctx.jobLocation ? `Location: ${ctx.jobLocation}` : null,
    "",
    "Description:",
    truncate(ctx.jobDescription, JD_CHARS),
    "",
    "## The candidate",
    profileLines.length ? profileLines.join("\n") : "No structured profile on file.",
    "",
    ctx.resumeText
      ? `Resume text (the only source of factual claims):\n${truncate(ctx.resumeText, RESUME_CHARS)}`
      : "No resume text on file. Write from the skills above only, and keep claims general " +
        "rather than inventing employers or projects.",
    "",
    "## Tone",
    TONE_GUIDANCE[ctx.tone],
    ctx.notes ? `\n## Must be worked in\n${truncate(ctx.notes, 800)}` : "",
  ]
    .filter((line) => line !== null)
    .join("\n");

  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
}

function truncate(text: string, max: number) {
  const clean = text.trim();
  return clean.length <= max ? clean : clean.slice(0, max) + "\n[...truncated]";
}

export interface ParsedLetter {
  subject: string | null;
  body: string;
  /** Placeholders the model left behind, e.g. "[Company Name]". */
  placeholders: string[];
}

export class UnusableResponse extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnusableResponse";
  }
}

const MIN_BODY = 200;
const MAX_BODY = 8000;
const PLACEHOLDER = /\[[^\]\n]{2,40}\]/g;

/**
 * Turn whatever the model returned into a letter, or refuse.
 *
 * Refusing matters as much as parsing: a half-empty letter that
 * reaches the UI costs the person a credit and their trust, so
 * anything short, truncated, or not actually JSON is thrown back
 * to the handler, which refunds and reports.
 */
export function parseLetter(raw: string): ParsedLetter {
  const stripped = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new UnusableResponse("The model didn't return JSON.");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new UnusableResponse("The model returned JSON, but not an object.");
  }

  const obj = parsed as Record<string, unknown>;
  const rawBody = obj.body;

  if (typeof rawBody !== "string") {
    throw new UnusableResponse("The model's response had no letter body.");
  }

  const body = normalise(rawBody);

  if (body.length < MIN_BODY) {
    throw new UnusableResponse("The model returned a letter too short to send.");
  }
  if (body.length > MAX_BODY) {
    throw new UnusableResponse("The model returned far more text than a cover letter.");
  }

  const subjectRaw = typeof obj.subject === "string" ? obj.subject.trim() : "";
  const subject = subjectRaw.length > 0 && subjectRaw.length <= 200 ? subjectRaw : null;

  // Reported, not rejected. A letter with one stray bracket is
  // still worth showing — the person just needs to be told where
  // to look before they send it.
  const placeholders = [...new Set(body.match(PLACEHOLDER) ?? [])];

  return { subject, body, placeholders };
}

function normalise(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    // Models pad with three or four newlines between paragraphs;
    // one blank line is what a letter actually uses.
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .trim();
}
