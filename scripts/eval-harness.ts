/**
 * Eval harness (M23) — a fixed set of pass/fail checks across
 * several AI features, run on demand by a person. Not CI: nothing
 * here is wired to a git hook or a GitHub Actions workflow, and
 * this repo's ethos (see CLAUDE.md) is a small hand-rolled tool that
 * does exactly what's needed, not a testing framework looking for a
 * reason to exist — so no promptfoo/Ragas/DeepEval, no test runner.
 *
 * `generate-cover-letter/bench.ts` is this script's precursor: it
 * calls the real model and asks a human to *read* the letters. This
 * generalises the idea across features and turns it into pass/fail
 * assertions a human — or, one day, CI — can read off an exit code.
 *
 * Two independent modes:
 *
 * ── Dry-run (default) ───────────────────────────────────────────
 * Zero network, zero API keys, zero cost. Imports each feature's
 * pure `prompt.ts` (no HTTP, no Supabase, no DeepSeek) and feeds it
 * hand-written fixture strings — both well-formed and deliberately
 * garbled "model responses" — asserting the parsing/validation
 * logic behaves exactly as that file's own comments say it should.
 * This is what regresses silently if a prompt.ts is "simplified"
 * without re-reading why a check exists: an ATS score sneaking back
 * in, `insufficient_info` stopping being mutually exclusive with a
 * fabricated answer, placeholder detection going quiet.
 *
 *   deno run --allow-read scripts/eval-harness.ts
 *
 * ── Live (strictly opt-in) ───────────────────────────────────────
 * Actually inserts real `tasks` rows against a real Supabase
 * project, using the same SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 * environment convention every Edge Function already uses (never
 * hardcode a project URL or key), polls until each task reaches
 * done/failed, and asserts the same kind of invariant against real
 * model output. This spends real credits and real DeepSeek cost
 * against a real user, so:
 *
 *   - it refuses to run at all without both --live and --user <uuid>
 *   - it prints an explicit warning and pauses before doing anything
 *   - it never runs as a side effect of the dry-run path above
 *
 *   deno run --allow-read --allow-env --allow-net scripts/eval-harness.ts --live --user <uuid>
 *
 * Note on the import below: this script lives outside
 * supabase/functions/, and Supabase deploys each function directory
 * independently — but that's a deploy-bundling boundary, not a
 * filesystem one. Deno resolves relative imports at the filesystem
 * level regardless of it, so `../supabase/functions/*\/prompt.ts`
 * resolves and typechecks like any other local module. Confirmed by
 * actually running this file, not just by reading the two systems'
 * docs and assuming.
 */

// ── dry-run imports: pure, no network, no Supabase, no API keys ───
import {
  parseOptimizerResult,
  UnusableResponse as OptimizerUnusable,
  type ParsedOptimizerResult,
} from "../supabase/functions/optimize-resume/prompt.ts";
import {
  parseAnswers,
  UnusableResponse as ApplyUnusable,
} from "../supabase/functions/assisted-apply/prompt.ts";
import {
  parseLetter,
  UnusableResponse as LetterUnusable,
} from "../supabase/functions/generate-cover-letter/prompt.ts";
import {
  parseSkillGapResult,
  UnusableResponse as SkillGapUnusable,
} from "../supabase/functions/analyze-skill-gap/prompt.ts";
import {
  parseOpening,
  parseAnswerEval,
  UnusableResponse as InterviewUnusable,
} from "../supabase/functions/interview-prep/prompt.ts";
import {
  parseTailorResult,
  UnusableResponse as TailorUnusable,
} from "../supabase/functions/tailor-resume/prompt.ts";

// ── tiny pass/fail runner ──────────────────────────────────────────
// No test framework, per this repo's own conventions — just a
// counter and a printed line, the same shape as bench.ts's `check`.

let total = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string) {
  total++;
  if (!ok) failed++;
  const prefix = ok ? "  ok  " : "  FAIL";
  console.log(`${prefix} ${label}${detail ? ` — ${detail}` : ""}`);
}

/** Runs `fn`, expecting it to throw an error `isExpected` accepts. */
function expectThrows(label: string, fn: () => unknown, isExpected: (e: unknown) => boolean) {
  try {
    fn();
    check(label, false, "did not throw");
  } catch (e) {
    if (isExpected(e)) {
      check(label, true);
    } else {
      check(label, false, `threw the wrong thing: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

function section(name: string) {
  console.log(`\n${"═".repeat(70)}\n${name}\n${"═".repeat(70)}`);
}

/**
 * Wraps a whole section so one unexpected exception (a typo in a
 * fixture, a signature that changed) fails that section's checks
 * loudly instead of crashing the rest of the harness silently.
 */
function runSection(name: string, fn: () => void) {
  section(name);
  try {
    fn();
  } catch (e) {
    check(`${name}: section did not complete`, false, e instanceof Error ? e.message : String(e));
  }
}

// ─────────────────────────────────────────────────────────────────
// optimize-resume — never a numeric score, garbled input handled
// exactly as prompt.ts's own salvage/refuse logic says it should.
// ─────────────────────────────────────────────────────────────────

function checkOptimizeResume() {
  const WELL_FORMED = JSON.stringify({
    matched: [
      { requirement: "3+ years Python", evidence: "Built backend services in Python for 3 years at Acme." },
    ],
    gaps: [
      {
        requirement: "Kubernetes",
        why_it_matters: "The posting lists it as a core infra skill.",
        suggestion: "Add the k8s deployment work from the Acme project if it actually happened.",
      },
    ],
    knockouts: ["Must hold an active security clearance"],
  });

  const result = parseOptimizerResult(WELL_FORMED);
  check(
    "well-formed fixture: matched parsed correctly",
    result.matched.length === 1 &&
      result.matched[0].requirement === "3+ years Python" &&
      result.matched[0].evidence.includes("Acme")
  );
  check(
    "well-formed fixture: gaps parsed correctly",
    result.gaps.length === 1 &&
      result.gaps[0].requirement === "Kubernetes" &&
      result.gaps[0].suggestion.length > 0
  );
  check(
    "well-formed fixture: knockouts parsed correctly",
    result.knockouts.length === 1 && result.knockouts[0].includes("clearance")
  );

  // The load-bearing regression guard: this feature's entire premise
  // is "no fabricated ATS score, ever" (see prompt.ts's header
  // comment). Assert the parsed shape structurally can't carry one,
  // not just that this one fixture happens not to have one.
  const keys = allKeysDeep(result as unknown as Record<string, unknown>);
  check(
    "parsed result never carries a score-shaped key",
    !keys.some((k) => /score|percent|grade|rating/i.test(k)),
    keys.some((k) => /score|percent|grade|rating/i.test(k)) ? `found: ${keys.join(", ")}` : undefined
  );
  check(
    "parsed result JSON never mentions 'score' even as a value",
    !/score/i.test(JSON.stringify(result))
  );

  // A model that wraps well-formed JSON in a stray sentence and a
  // markdown fence — observed live on this exact prompt shape in
  // generate-cover-letter's bench.ts notes — must be salvaged by
  // pulling the outermost {...}, per parseOptimizerResult's own
  // `salvage()` helper.
  const WRAPPED = `Sure! Here's the analysis:\n\`\`\`json\n${WELL_FORMED}\n\`\`\`[…more chatter after]`;
  let salvaged: ParsedOptimizerResult | undefined;
  try {
    salvaged = parseOptimizerResult(WRAPPED);
  } catch {
    salvaged = undefined;
  }
  check(
    "prose-wrapped JSON is salvaged, not rejected",
    salvaged !== undefined && salvaged.matched.length === 1
  );

  // Truncated mid-object (a real truncation, e.g. hit max_tokens) has
  // no closing brace for salvage() to find — parseOptimizerResult's
  // own logic says this must be rejected as retryable, not
  // half-parsed into a misleading partial result.
  const TRUNCATED = `{"matched": [{"requirement": "Python", "evidence": "built stuff for 3 yea`;
  expectThrows(
    "truncated JSON is rejected as retryable, not half-parsed",
    () => parseOptimizerResult(TRUNCATED),
    (e) => e instanceof OptimizerUnusable && e.retryable === true
  );

  // Well-formed JSON, but structurally empty — no matches and no
  // gaps — is "nothing usable" per parseOptimizerResult's explicit
  // check, not a valid (if boring) result.
  const EMPTY = JSON.stringify({ matched: [], gaps: [], knockouts: [] });
  expectThrows(
    "empty matched+gaps is refused as nothing usable",
    () => parseOptimizerResult(EMPTY),
    (e) => e instanceof OptimizerUnusable
  );
}

function allKeysDeep(obj: unknown, acc: string[] = []): string[] {
  if (Array.isArray(obj)) {
    for (const item of obj) allKeysDeep(item, acc);
  } else if (obj !== null && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      acc.push(k);
      allKeysDeep(v, acc);
    }
  }
  return acc;
}

// ─────────────────────────────────────────────────────────────────
// assisted-apply — insufficient_info and a fabricated answer must
// never both be true at once; well-formed multi-answer fixtures
// parse in order.
// ─────────────────────────────────────────────────────────────────

function checkAssistedApply() {
  const questions = ["Why do you want this role?", "What are your salary expectations?"];

  const WELL_FORMED = JSON.stringify({
    answers: [
      {
        question: questions[0],
        answer: "I built a retrieval pipeline very similar to what this posting describes.",
        insufficient_info: false,
        note: null,
      },
      {
        question: questions[1],
        answer: "",
        insufficient_info: true,
        note: "No salary floor is on file — you'll need to fill in your own number here.",
      },
    ],
  });

  const answers = parseAnswers(WELL_FORMED, questions);
  check("well-formed fixture: both answers parsed, in order", answers.length === 2 && answers[0].question === questions[0] && answers[1].question === questions[1]);
  check(
    "answerable question: real content, no honesty flag",
    !answers[0].insufficientInfo && answers[0].answer.length > 0
  );
  check(
    "unanswerable question: empty answer + a non-empty note",
    answers[1].insufficientInfo && answers[1].answer === "" && !!answers[1].note && answers[1].note.length > 0
  );

  // The regression this exists to catch: a model that sets the
  // honesty flag but ALSO writes a plausible-sounding answer anyway.
  // parseAnswers must force answer to "" whenever insufficient_info
  // is true, regardless of what the model put in `answer` — never
  // both a fabricated content string AND the flag.
  const MISBEHAVING = JSON.stringify({
    answers: [
      {
        question: questions[1],
        answer: "$120,000 - $140,000 per year",
        insufficient_info: true,
        note: "No salary floor is on file.",
      },
    ],
  });
  const forced = parseAnswers(MISBEHAVING, [questions[1]]);
  check(
    "insufficient_info forces answer to empty even if the model filled it in",
    forced.length === 1 && forced[0].insufficientInfo === true && forced[0].answer === ""
  );

  // Garbled: not JSON at all.
  expectThrows(
    "non-JSON response is rejected as retryable",
    () => parseAnswers("I'm not going to answer in JSON, sorry.", questions),
    (e) => e instanceof ApplyUnusable && e.retryable === true
  );

  // Garbled: valid JSON, but an empty answers array — nothing usable.
  expectThrows(
    "empty answers array is refused as nothing usable",
    () => parseAnswers(JSON.stringify({ answers: [] }), questions),
    (e) => e instanceof ApplyUnusable
  );
}

// ─────────────────────────────────────────────────────────────────
// generate-cover-letter — placeholder detection fires on an actual
// placeholder and stays quiet on a clean letter.
// ─────────────────────────────────────────────────────────────────

function checkCoverLetter() {
  const CLEAN_BODY = [
    "Dear Hiring Team,",
    "",
    "Joblogic's posting asks for someone who has shipped retrieval and tool-calling",
    "features end to end, which is exactly the shape of the RAG system and the",
    "ScholarMind assistant I built last year — chunking, embeddings, a JSON-repair",
    "layer around the model's output, and a Streamlit front end real users touched.",
    "",
    "I would bring that same build-it-end-to-end habit to your agent platform, from",
    "the ingestion pipeline through the guardrails that keep it honest in production.",
    "",
    "Husnain Aslam",
  ].join("\n");
  // Pad past MIN_BODY (200 chars) without introducing brackets.
  const CLEAN = JSON.stringify({
    subject: "Application for AI/ML Engineer",
    body: CLEAN_BODY + "\n\nHappy to walk through any of the projects above in more detail.",
  });

  const letter = parseLetter(CLEAN);
  check("clean fixture: parses with a subject", letter.subject === "Application for AI/ML Engineer");
  check("clean fixture: no placeholders detected", letter.placeholders.length === 0);

  const PLACEHOLDER_BODY = CLEAN_BODY.replace("Joblogic's posting", "[Company Name]'s posting") +
    "\n\nI look forward to hearing from [Your Name here].";
  const WITH_PLACEHOLDER = JSON.stringify({
    subject: "Application for AI/ML Engineer",
    body: PLACEHOLDER_BODY,
  });

  const withPlaceholder = parseLetter(WITH_PLACEHOLDER);
  check(
    "placeholder fixture: [Company Name]-style bracket is caught",
    withPlaceholder.placeholders.some((p) => p.includes("Company Name"))
  );
  check("placeholder fixture: still returns the letter, not a refusal", withPlaceholder.body.length > 0);

  // Garbled: body far too short to be a real letter.
  expectThrows(
    "too-short body is rejected as retryable",
    () => parseLetter(JSON.stringify({ subject: "Hi", body: "Short." })),
    (e) => e instanceof LetterUnusable && e.retryable === true
  );

  // Garbled: not JSON.
  expectThrows(
    "non-JSON response is rejected as retryable",
    () => parseLetter("Sorry, I can't help with that."),
    (e) => e instanceof LetterUnusable && e.retryable === true
  );
}

// ─────────────────────────────────────────────────────────────────
// analyze-skill-gap — grounded gaps parse in rank order; an empty
// response is refused rather than shown as "no gaps found".
// ─────────────────────────────────────────────────────────────────

function checkSkillGap() {
  const WELL_FORMED = JSON.stringify({
    gaps: [
      {
        skill: "Kubernetes",
        mentioned_in: 3,
        why_it_matters: "Three of the four target postings list it as required infra experience.",
        resource: "Deploy one of your existing side projects to a small k8s cluster end to end.",
      },
    ],
    strengths: ["Python", "PostgreSQL"],
    narrative: "Strong backend fundamentals; the main gap is container orchestration experience.",
  });

  const result = parseSkillGapResult(WELL_FORMED);
  check(
    "well-formed fixture: gap parsed with rounded mentioned_in",
    result.gaps.length === 1 && result.gaps[0].skill === "Kubernetes" && result.gaps[0].mentionedIn === 3
  );
  check("well-formed fixture: strengths parsed", result.strengths.includes("Python"));
  check("well-formed fixture: narrative present", result.narrative.length > 0);

  // Garbled: syntactically valid JSON, but nothing usable — no gaps,
  // no narrative. parseSkillGapResult's own check refuses this
  // rather than showing an empty "you have no skill gaps" card.
  expectThrows(
    "empty gaps+narrative is refused as nothing usable",
    () => parseSkillGapResult(JSON.stringify({ gaps: [], strengths: [], narrative: "" })),
    (e) => e instanceof SkillGapUnusable
  );

  // Garbled: not JSON.
  expectThrows(
    "non-JSON response is rejected as retryable",
    () => parseSkillGapResult("<html>rate limited</html>"),
    (e) => e instanceof SkillGapUnusable && e.retryable === true
  );
}

// ─────────────────────────────────────────────────────────────────
// interview-prep — the multi-turn state machine's own parsers:
// an opening question, an adaptive follow-up, and the final-turn
// summary branch, each refusing a garbled/incomplete response.
// ─────────────────────────────────────────────────────────────────

function checkInterviewPrep() {
  const question = parseOpening(JSON.stringify({ question: "Tell me about a time you debugged a production issue under time pressure." }));
  check("opening fixture: question extracted", question.startsWith("Tell me about a time"));

  expectThrows(
    "opening fixture with no question is refused",
    () => parseOpening(JSON.stringify({})),
    (e) => e instanceof InterviewUnusable && e.retryable === true
  );

  const continueEval = parseAnswerEval(
    JSON.stringify({ feedback: "Good use of a concrete metric, but light on what you'd do differently.", score: 4, next_question: "What would you change if you had another week?" }),
    false
  );
  check(
    "mid-interview fixture: continues with a follow-up",
    continueEval.kind === "continue" && continueEval.score === 4 && continueEval.nextQuestion.length > 0
  );

  // Score outside 1-5 must be clamped, not passed through raw.
  const clamped = parseAnswerEval(JSON.stringify({ feedback: "Fine.", score: 9, next_question: "Next?" }), false);
  check("out-of-range score is clamped to 5", clamped.kind === "continue" && clamped.score === 5);

  const finalEval = parseAnswerEval(
    JSON.stringify({
      feedback: "Solid, specific answer.",
      score: 4,
      summary: {
        overall_feedback: "Consistently grounded answers with real detail from past projects.",
        strengths: ["Clear STAR structure", "Concrete metrics"],
        areas_to_improve: ["Could name tradeoffs more explicitly"],
      },
    }),
    true
  );
  check(
    "final-turn fixture: produces a session summary",
    finalEval.kind === "done" &&
      finalEval.summary.overallFeedback.length > 0 &&
      finalEval.summary.strengths.length === 2
  );

  // Final turn without a summary object is exactly the failure mode
  // the turn cap depends on never silently passing — the state
  // machine needs a real summary to mark the session completed.
  expectThrows(
    "final turn missing a summary is refused, not silently completed",
    () => parseAnswerEval(JSON.stringify({ feedback: "Fine.", score: 3 }), true),
    (e) => e instanceof InterviewUnusable && e.retryable === true
  );
}

// ─────────────────────────────────────────────────────────────────
// tailor-resume — every `not_addressed` requirement must never leak
// into a `tailored` bullet's text (that would be exactly the
// fabrication this feature exists to refuse); garbled input handled
// the same way optimize-resume's parser handles it.
// ─────────────────────────────────────────────────────────────────

function checkTailorResume() {
  const WELL_FORMED = JSON.stringify({
    rewrites: [
      {
        original: "Built backend services in Python for 3 years at Acme.",
        tailored: "Built and shipped Python backend services in production for 3 years at Acme.",
        rationale: "Mirrors the posting's own phrase 'production Python services'.",
      },
    ],
    not_addressed: ["Kubernetes"],
  });

  const result = parseTailorResult(WELL_FORMED);
  check(
    "well-formed fixture: rewrite parsed correctly",
    result.rewrites.length === 1 &&
      result.rewrites[0].original.includes("Acme") &&
      result.rewrites[0].tailored.includes("production")
  );
  check(
    "well-formed fixture: not_addressed parsed correctly",
    result.notAddressed.length === 1 && result.notAddressed[0] === "Kubernetes"
  );

  // The load-bearing regression guard: a `not_addressed` item must
  // never simultaneously appear folded into a `tailored` bullet —
  // that would mean the model both admitted it couldn't support a
  // requirement AND fabricated a bullet claiming it anyway.
  const overlap = result.notAddressed.some((n) =>
    result.rewrites.some((r) => r.tailored.toLowerCase().includes(n.toLowerCase()))
  );
  check("not_addressed items never leak into a tailored bullet", !overlap);

  // Prose-wrapped JSON (a stray sentence + markdown fence) must be
  // salvaged, same as optimize-resume's salvage() helper.
  const WRAPPED = `Here you go:\n\`\`\`json\n${WELL_FORMED}\n\`\`\``;
  let salvaged;
  try {
    salvaged = parseTailorResult(WRAPPED);
  } catch {
    salvaged = undefined;
  }
  check("prose-wrapped JSON is salvaged, not rejected", salvaged !== undefined && salvaged.rewrites.length === 1);

  // Garbled: not JSON at all.
  expectThrows(
    "non-JSON response is rejected as retryable",
    () => parseTailorResult("I can't help rewrite that, sorry."),
    (e) => e instanceof TailorUnusable && e.retryable === true
  );

  // Well-formed JSON, but structurally empty — nothing usable.
  expectThrows(
    "empty rewrites+not_addressed is refused as nothing usable",
    () => parseTailorResult(JSON.stringify({ rewrites: [], not_addressed: [] })),
    (e) => e instanceof TailorUnusable
  );
}

// ─────────────────────────────────────────────────────────────────
// live mode — opt-in only, real tasks rows, real credits, real
// DeepSeek cost. Never imported/executed unless --live is passed.
// ─────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function runLive(userId: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.error(
      "Live mode needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment " +
        "— the same convention every Edge Function in this repo already uses. Neither is hardcoded here."
    );
    Deno.exit(1);
  }

  const LIVE_CHECKS = 2; // one resume_optimize task, one assisted_apply task — see below.
  console.log(
    `\nLIVE MODE: this will insert ${LIVE_CHECKS} real tasks and spend up to ${LIVE_CHECKS} ` +
      `credits against user ${userId} on the project at ${supabaseUrl}.\n` +
      `This calls the real DeepSeek API through the real Edge Functions. Ctrl+C now to abort.\n`
  );
  await new Promise((r) => setTimeout(r, 5000));
  console.log("Proceeding.\n");

  // Imported dynamically, and only here, so dry-run mode never
  // touches the network. This has to be more than "only called when
  // --live is passed": deno run builds its module graph by walking
  // every dynamic import() whose specifier is a literal string,
  // regardless of whether the code path calling it is ever reached
  // — verified empirically, a plain `await import("https://...")`
  // inside an uncalled function still triggered a real download.
  // Splitting the literal defeats that static analysis, so dry-run
  // mode really does stay at zero network calls until --live asks
  // for this function to run. Same package/version
  // generate-cover-letter and friends already depend on.
  const SUPABASE_JS_SPECIFIER = "https://esm.sh/" + "@supabase/supabase-js@2.39.3";
  const { createClient } = await import(SUPABASE_JS_SPECIFIER);
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("id, title, description")
    .not("description", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (jobErr || !job) {
    check("live: found a real job to test against", false, jobErr?.message ?? "no jobs in this project");
    return;
  }
  check("live: found a real job to test against", true, `${job.title} (${job.id})`);

  async function insertTask(taskType: string, input: Record<string, unknown>): Promise<string | null> {
    const { data, error } = await supabase
      .from("tasks")
      .insert({ user_id: userId, task_type: taskType, input })
      .select("id")
      .single();
    if (error || !data) {
      check(`live: inserted a ${taskType} task`, false, error?.message);
      return null;
    }
    check(`live: inserted a ${taskType} task`, true, data.id);
    return data.id as string;
  }

  async function pollTask(taskId: string, timeoutMs = 100_000): Promise<{ status: string; result: unknown; error: string | null } | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { data, error } = await supabase
        .from("tasks")
        .select("status, result, error")
        .eq("id", taskId)
        .single();
      if (error) return null;
      if (data.status === "done" || data.status === "failed") return data;
      await new Promise((r) => setTimeout(r, 2000));
    }
    return null;
  }

  // ── resume_optimize: the same "never a score" guarantee, now
  // checked against a real DeepSeek response instead of a fixture.
  const optimizeId = await insertTask("resume_optimize", { job_id: job.id });
  if (optimizeId) {
    const finished = await pollTask(optimizeId);
    if (!finished) {
      check("live: resume_optimize task reached done/failed", false, "timed out waiting");
    } else if (finished.status === "failed") {
      check("live: resume_optimize task reached done/failed", false, finished.error ?? "failed");
    } else {
      check("live: resume_optimize task reached done/failed", true);
      const resultText = JSON.stringify(finished.result ?? {});
      check("live: real resume_optimize output never mentions a score", !/score|percent|grade/i.test(resultText));
    }
  }

  // ── assisted_apply: a question this app cannot honestly answer
  // (no salary floor on file for a fresh test resume) must come back
  // insufficient_info, not a confident guess.
  const applyId = await insertTask("assisted_apply", {
    job_id: job.id,
    questions: ["What are your salary expectations for this role?"],
  });
  if (applyId) {
    const finished = await pollTask(applyId);
    if (!finished) {
      check("live: assisted_apply task reached done/failed", false, "timed out waiting");
    } else if (finished.status === "failed") {
      check("live: assisted_apply task reached done/failed", false, finished.error ?? "failed");
    } else {
      check("live: assisted_apply task reached done/failed", true);
      const result = (finished.result ?? {}) as { answers?: { insufficient_info?: boolean; answer?: string }[] };
      const answer = result.answers?.[0];
      check(
        "live: unanswerable salary question comes back insufficient_info, not a guess",
        !!answer && answer.insufficient_info === true && (answer.answer ?? "") === "",
        answer ? `got: ${JSON.stringify(answer)}` : "no answer in result"
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// entry point
// ─────────────────────────────────────────────────────────────────

async function main() {
  const args = Deno.args;
  const live = args.includes("--live");
  const userFlagIndex = args.indexOf("--user");
  const userId = userFlagIndex !== -1 ? args[userFlagIndex + 1] : undefined;

  console.log("Eval harness (M23) — dry-run checks across this app's AI features.\n");

  runSection("optimize-resume/prompt.ts", checkOptimizeResume);
  runSection("assisted-apply/prompt.ts", checkAssistedApply);
  runSection("generate-cover-letter/prompt.ts", checkCoverLetter);
  runSection("analyze-skill-gap/prompt.ts", checkSkillGap);
  runSection("interview-prep/prompt.ts", checkInterviewPrep);
  runSection("tailor-resume/prompt.ts", checkTailorResume);

  console.log(`\n${"─".repeat(70)}`);
  console.log(`Dry-run: ${total - failed}/${total} checks passed.`);

  if (live) {
    if (!userId || !UUID_RE.test(userId)) {
      console.error(
        "\n--live requires --user <uuid> naming whose credits/tasks to spend — refusing to run live mode."
      );
      Deno.exit(1);
    }
    await runSection2("live mode", () => runLive(userId));
    console.log(`\n${"─".repeat(70)}`);
    console.log(`Total: ${total - failed}/${total} checks passed.`);
  } else if (userId) {
    console.log(
      "\n(--user was given without --live — ignoring it. Dry-run mode never touches a real project.)"
    );
  }

  console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`);
  Deno.exit(failed === 0 ? 0 : 1);
}

/** Async sibling of runSection, for the one section that awaits. */
async function runSection2(name: string, fn: () => Promise<void>) {
  section(name);
  try {
    await fn();
  } catch (e) {
    check(`${name}: section did not complete`, false, e instanceof Error ? e.message : String(e));
  }
}

await main();
