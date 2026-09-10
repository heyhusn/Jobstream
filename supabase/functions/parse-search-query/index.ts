// Natural Language Job Search (roadmap M06).
//
// "Remote ML roles paying over $120k that aren't a ghost job" ->
// a small typed filter object, applied client-side against the
// matches the person already has loaded. Deliberately NOT free-text
// SQL generation or a semantic-search call — per the roadmap, this
// is constrained function-calling into a fixed schema, with the
// model asked to say plainly what it couldn't map to a real filter
// (e.g. visa sponsorship — nothing in this schema tracks that yet)
// rather than silently drop it.
//
// No service-role client, no TASK_DISPATCH_SECRET, no `tasks` row:
// this reads nothing and writes nothing, so there's no state to
// protect — only DEEPSEEK_API_KEY is needed. Auth is the platform's
// default JWT verification (this function is deployed with
// verify_jwt on), which is enough to stop a stranger burning the
// DeepSeek quota; there's no per-call credit charge because parsing
// a short query is cheap and this is a Free-tier feature per the
// roadmap's pricing table.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = "deepseek-chat";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const TIMEOUT_MS = 20_000;
const MAX_QUERY_CHARS = 300;

export type RemoteType = "remote" | "hybrid" | "onsite";
export type RiskBand = "low" | "medium" | "high";

export interface SearchFilter {
  remote_type: RemoteType | null;
  min_salary: number | null;
  keywords: string[];
  max_ghost_risk: RiskBand | null;
  confidence: number;
  /** What the query asked for that this schema has no field for. */
  unsupported: string | null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

class UnusableResponse extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.retryable = retryable;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "POST only." }, 405);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    if (!query) {
      return json({ error: "No query." }, 400);
    }
    if (query.length > MAX_QUERY_CHARS) {
      return json({ error: `Query is too long (max ${MAX_QUERY_CHARS} characters).` }, 400);
    }

    const key = Deno.env.get("DEEPSEEK_API_KEY");
    if (!key) {
      return json({ error: "This function is not configured." }, 503);
    }

    const filter = await parseWithRetry(query, key);
    return json({ filter });
  } catch (error) {
    console.error("parse-search-query failed:", error);
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500);
  }
});

async function parseWithRetry(query: string, key: string): Promise<SearchFilter> {
  const ATTEMPTS = 2;
  for (let attempt = 1; ; attempt++) {
    try {
      const raw = await callDeepSeek(query, key);
      return parseFilter(raw);
    } catch (e) {
      if (!(e instanceof UnusableResponse) || !e.retryable || attempt >= ATTEMPTS) throw e;
      console.warn(`attempt ${attempt} unusable (${e.message}); retrying`);
    }
  }
}

async function callDeepSeek(query: string, key: string): Promise<string> {
  const system = [
    "You convert a job-search sentence into a JSON filter for a fixed schema.",
    "The available fields, and only these, can be filtered on:",
    "- remote_type: one of \"remote\", \"hybrid\", \"onsite\", or null if not stated",
    "- min_salary: a number (annual, in whatever currency the query implies — just",
    "  the number), or null if no salary floor was stated",
    "- keywords: up to 5 short terms to match against a job's title, company name,",
    "  or location (role names, technologies, seniority words) — [] if none",
    "- max_ghost_risk: \"low\" if the person wants to exclude anything but the safest",
    "  postings, \"medium\" to also allow some risk, null if not mentioned",
    "",
    "Nothing else can be filtered on — not visa sponsorship, not company size, not",
    "years of experience, not a specific date. If the query asks for something this",
    "schema has no field for, put one short plain-English sentence describing what",
    "you couldn't apply in `unsupported`, and still fill in whatever fields you can",
    "from the rest of the sentence. Set `unsupported` to null if nothing was left out.",
    "",
    "`confidence` is 0 to 1: how much of the sentence's actual intent this filter",
    "captures. A vague or off-topic query should score low, not be forced into a",
    "guess.",
    "",
    'Return only: {"remote_type": ..., "min_salary": ..., "keywords": [...], ' +
      '"max_ghost_risk": ..., "confidence": ..., "unsupported": ...}',
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(Deno.env.get("DEEPSEEK_BASE_URL") ?? DEEPSEEK_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: query },
        ],
        temperature: 0.1,
        max_tokens: 300,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      if (response.status === 429) {
        throw new UnusableResponse("The model is rate-limited right now.");
      }
      throw new Error(`DeepSeek returned ${response.status}: ${detail.slice(0, 300)}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new UnusableResponse("The model returned an empty response.", true);
    }
    return content;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new UnusableResponse("The model took too long to answer.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const REMOTE_TYPES: RemoteType[] = ["remote", "hybrid", "onsite"];
const RISK_BANDS: RiskBand[] = ["low", "medium", "high"];

function parseFilter(raw: string): SearchFilter {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?[ \t]*\n?/i, "")
    .replace(/\n?[ \t]*```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new UnusableResponse("The model didn't return JSON.", true);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new UnusableResponse("The model returned JSON, but not an object.", true);
  }
  const obj = parsed as Record<string, unknown>;

  const remoteType = REMOTE_TYPES.includes(obj.remote_type as RemoteType)
    ? (obj.remote_type as RemoteType)
    : null;
  const minSalary =
    typeof obj.min_salary === "number" && obj.min_salary > 0 ? obj.min_salary : null;
  const keywords = (Array.isArray(obj.keywords) ? obj.keywords : [])
    .filter((k): k is string => typeof k === "string" && k.trim().length > 0)
    .map((k) => k.trim())
    .slice(0, 5);
  const maxGhostRisk = RISK_BANDS.includes(obj.max_ghost_risk as RiskBand)
    ? (obj.max_ghost_risk as RiskBand)
    : null;
  const confidence =
    typeof obj.confidence === "number" ? Math.max(0, Math.min(1, obj.confidence)) : 0.5;
  const unsupported =
    typeof obj.unsupported === "string" && obj.unsupported.trim() ? obj.unsupported.trim() : null;

  return {
    remote_type: remoteType,
    min_salary: minSalary,
    keywords,
    max_ghost_risk: maxGhostRisk,
    confidence,
    unsupported,
  };
}
