-- ═══════════════════════════════════════════════════════════
-- Hybrid Semantic Search (M03) — the roadmap's real gap: embeddings
-- existed (jobs.embedding, vector(384), populated by generate-matches
-- via the on-device gte-small model) but were never fused with full
-- text search, and nothing queried them through a real ANN index.
-- This migration builds both halves and fuses them with Reciprocal
-- Rank Fusion (RRF).
--
-- Two independent retrieval signals, each ranking its own top 50:
--
--   1. Full-text search over `search_vector` (title weighted above
--      description, GIN-indexed) — catches exact keyword hits
--      ("Kubernetes", "CFA", a specific tool name) that a pure
--      embedding search can blur into near-synonyms.
--   2. Cosine similarity over `jobs.embedding` (HNSW-indexed here for
--      real ANN search instead of a full-table scan) — catches
--      conceptual matches that don't share exact wording ("ML
--      engineer" finding a "machine learning scientist" posting).
--
-- RRF combines the two RANKINGS (1/(k+rank), k=60 — the standard
-- constant from Cormack/Clarke/Buettcher 2009), not the raw scores:
-- a tsrank value and a cosine distance live on unrelated scales, and
-- averaging them directly would just let whichever happens to have
-- the bigger numeric range dominate. Rank-based fusion sidesteps
-- that, which is why it's the standard technique for combining
-- full-text and vector search.
--
-- `public.job_embeddings` (vector(768)+HNSW, from 0001_init.sql)
-- stays orphaned on purpose — it's the wrong dimension for the
-- gte-small embeddings this app actually produces (384). This builds
-- hybrid search on the real `jobs.embedding` column from
-- 0004_real_matching.sql instead of trying to resurrect it.
-- ═══════════════════════════════════════════════════════════

-- ── full-text half ───────────────────────────────────────────
alter table public.jobs
  add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) stored;

create index if not exists jobs_search_vector_idx on public.jobs using gin (search_vector);

-- ── vector half ───────────────────────────────────────────────
-- Cosine ops to match how generate-matches already compares these
-- embeddings (normalized vectors, dot-product-as-cosine similarity).
create index if not exists jobs_embedding_hnsw_idx
  on public.jobs using hnsw (embedding vector_cosine_ops);

-- ── fusion ────────────────────────────────────────────────────
-- security invoker, not definer: `jobs` is already public-read (see
-- 0001_init.sql), so this only needs to run with the caller's own
-- privileges rather than being granted anything extra.
create or replace function public.search_jobs_hybrid(
  query_text text,
  query_embedding vector(384),
  match_count int default 20
)
returns table (
  job_id uuid,
  rrf_score double precision,
  fts_rank int,
  vector_rank int
)
language sql
stable
security invoker
set search_path = public
as $$
  with fts as (
    select id, row_number() over (
      order by ts_rank_cd(search_vector, websearch_to_tsquery('english', query_text)) desc
    ) as rnk
    from public.jobs
    where is_active
      and search_vector @@ websearch_to_tsquery('english', query_text)
    limit 50
  ),
  vec as (
    select id, row_number() over (
      order by embedding <=> query_embedding
    ) as rnk
    from public.jobs
    where is_active and embedding is not null
    order by embedding <=> query_embedding
    limit 50
  )
  select
    coalesce(fts.id, vec.id) as job_id,
    (1.0 / (60 + coalesce(fts.rnk, 10000))) + (1.0 / (60 + coalesce(vec.rnk, 10000))) as rrf_score,
    fts.rnk as fts_rank,
    vec.rnk as vector_rank
  from fts
  full outer join vec on fts.id = vec.id
  order by rrf_score desc
  limit match_count;
$$;

-- Authenticated only — this is an in-app search surface, not a
-- public API; matches the app's existing "everything lives behind
-- ProtectedRoute" posture even though the underlying `jobs` rows are
-- public-read.
grant execute on function public.search_jobs_hybrid(text, vector, int) to authenticated;
