// Hybrid Semantic Search (roadmap M03) — searches the whole active
// job board, not just a signed-in user's precomputed matches (that's
// what Matches + parse-search-query's client-side filter already do).
// Fuses two independent retrieval signals via `search_jobs_hybrid`
// (migration 0023_hybrid_search.sql): Postgres full-text search over
// title/description, and cosine similarity over the same gte-small
// embeddings generate-matches already computes — combined with
// Reciprocal Rank Fusion rather than averaging two scores that live
// on unrelated scales.
//
// No `tasks` row, no TASK_DISPATCH_SECRET, no credit charge — same
// posture as parse-search-query: this reads public job data and
// writes nothing, so there's no state to protect and nothing to bill
// for. Auth is the platform's default JWT verification (this
// function is deployed with verify_jwt on); a caller-scoped client
// (anon key + the caller's own bearer token) is used for the actual
// query anyway, on general principle — minimum privilege, not because
// `jobs` RLS treats a signed-in user any differently from another.
//
// The one real cost here is the embedding call itself, which runs
// on Supabase's on-device gte-small model (the same
// `Supabase.ai.Session('gte-small')` generate-matches uses) — cheap
// and local, not a billed LLM call, which is why this stays free-tier
// like parse-search-query rather than going through the credit ledger.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_QUERY_CHARS = 300;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set in this function's environment.`);
  return value;
}

/** Flattens whatever shape the on-device model hands back into a plain number[]. */
function flattenEmbedding(raw: unknown): number[] {
  if (Array.isArray(raw) && Array.isArray(raw[0])) return raw[0] as number[];
  return Array.from(raw as ArrayLike<number>);
}

interface HybridRow {
  job_id: string;
  rrf_score: number;
  fts_rank: number | null;
  vector_rank: number | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "POST only." }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "Not authenticated." }, 401);
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
    const limit = Math.max(1, Math.min(MAX_LIMIT, Number(body?.limit) || DEFAULT_LIMIT));

    const supabaseUrl = requireEnv("SUPABASE_URL");
    const anonKey = requireEnv("SUPABASE_ANON_KEY");

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Minor m37: same free-tier-but-JWT-gated exposure as
    // parse-search-query — see that function's header comment for
    // why this class of endpoint needed a rate limit that the credit
    // ledger doesn't provide for it.
    // `getUser()` with no argument reads from the client's own
    // session, which is empty (persistSession is off) — the
    // Authorization header forwarded above only flows into
    // PostgREST/RPC calls, never into the GoTrue auth client. The
    // JWT has to be handed to getUser() explicitly to actually
    // validate the caller. (Found while testing this rate limit:
    // the identical omission in delete-my-account and admin-action
    // meant both silently 401'd for every real caller — see CLAUDE.md.)
    const bearerToken = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData } = await supabase.auth.getUser(bearerToken);
    if (userData?.user) {
      const { data: allowed, error: rateLimitErr } = await supabase.rpc("check_rate_limit", {
        p_user_id: userData.user.id,
        p_bucket: "hybrid-search",
        p_limit: 30,
        p_window_seconds: 300,
      });
      if (!rateLimitErr && allowed === false) {
        return json({ error: "Too many searches — try again in a few minutes." }, 429);
      }
    }

    // Same on-device model, same mean-pool/normalize settings
    // generate-matches uses to build jobs.embedding, so the query
    // vector lives in the same space as what it's being compared to.
    const session = new (globalThis as any).Supabase.ai.Session("gte-small");
    const rawEmbedding = await session.run(query, { mean_pool: true, normalize: true });
    const queryEmbedding = flattenEmbedding(rawEmbedding);

    const { data: hybridRows, error: rpcError } = await supabase.rpc("search_jobs_hybrid", {
      query_text: query,
      query_embedding: queryEmbedding,
      match_count: limit,
    });
    if (rpcError) throw rpcError;

    const rows = (hybridRows ?? []) as HybridRow[];
    if (rows.length === 0) {
      return json({ results: [] });
    }

    const jobIds = rows.map((r) => r.job_id);
    const { data: jobs, error: jobsError } = await supabase
      .from("jobs")
      .select(
        `id, title, description, location, remote_type, salary_min, salary_max,
         salary_currency, apply_url, posted_at, first_seen_at, repost_count,
         visa_sponsorship, seniority, tech_stack,
         company:companies ( id, canonical_name ),
         ghost_signals ( risk_band )`
      )
      .in("id", jobIds);
    if (jobsError) throw jobsError;

    const byId = new Map((jobs ?? []).map((j: any) => [j.id, j]));

    const results = rows
      .map((r) => {
        const job = byId.get(r.job_id);
        if (!job) return null;
        const matchedVia =
          r.fts_rank != null && r.vector_rank != null
            ? "both"
            : r.fts_rank != null
              ? "keyword"
              : "semantic";
        return {
          job: {
            id: job.id,
            title: job.title,
            description: job.description,
            location: job.location,
            remote_type: job.remote_type,
            salary_min: job.salary_min,
            salary_max: job.salary_max,
            salary_currency: job.salary_currency,
            apply_url: job.apply_url,
            posted_at: job.posted_at,
            first_seen_at: job.first_seen_at,
            repost_count: job.repost_count,
            visa_sponsorship: job.visa_sponsorship,
            seniority: job.seniority,
            tech_stack: job.tech_stack,
            company: job.company,
          },
          risk_band: job.ghost_signals?.[0]?.risk_band ?? null,
          rrf_score: r.rrf_score,
          matched_via: matchedVia,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    return json({ results });
  } catch (error) {
    console.error("hybrid-search failed:", error);
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return json({ error: message }, 500);
  }
});
