# JobSpy — project memory

Read this first. It exists so future sessions don't need to re-read SETUP.md,
DEPLOY.md, all seven migrations, and the roadmap PDF from scratch. Go to those
source docs only for the details this file intentionally omits.

**Live status:** deployed and end-to-end verified on the real cloud project
(`wtkmrkhaokrcxvkrfyop`, org `jusddluiausmulvfemmh`). The local Supabase CLI
is logged in and linked to it — `npx supabase db push` / `functions deploy`
act on production directly, with no staging environment in between. Treat
any DB/function deploy command as a real production action requiring the
user's go-ahead, not a routine one.

## What this actually is

A job-search web app: auth → resume upload → AI-parsed profile → scored job
matches → Kanban application tracker → AI cover letters. Package name is
`jobspy-app`; there is **no scraper in this repo** despite the name — job data
is static seed rows (`supabase/seed/seed.sql`), not live ingestion.

This repo is **Platform A** of a two-platform master spec
(`implementation_plan.md`). Platform B (a Pakistan→Germany study-abroad
marketplace) is documented there but has zero code in this repo — ignore it
unless the user explicitly pivots to it.

A separate roadmap PDF (`JobSpy_Platform_Research_and_Feature_Roadmap`,
shared in chat, not stored in-repo) proposed a much larger target: FastAPI +
Celery + pgvector + ATS ingestion + agent layer, 25 major + 40 minor
features. **What's built diverges from that plan on purpose** — see below.

## Actual stack (not the roadmap's target stack)

- Frontend: React 19 + TypeScript + Vite 8, Tailwind CSS 4, React Router 7,
  TanStack Query + Virtual, Zustand, `@dnd-kit` (Kanban DnD), `pdfjs-dist`
  (client-side PDF text extraction, no DOCX).
- Backend: **Supabase only** — Postgres, Auth, Storage, Realtime, Edge
  Functions (Deno). No FastAPI, no Celery/Redis, no separate vector DB.
- AI: DeepSeek (`deepseek-chat`) for parsing and cover letters. Matching uses
  Supabase's on-device `gte-small` embedding model (384-dim), not
  OpenAI/pgvector ANN search.
- No Stripe. No LangGraph/agent framework. No Sentry/observability stack.

**Why Supabase-only**: deliberate, documented in SETUP.md as
forward-compatible, not a shortcut needing unwinding. A `tasks` table +
Realtime stands in for Celery/Redis: every AI feature inserts a `tasks` row,
a Postgres trigger (`handle_new_task`) POSTs to an Edge Function via
`pg_net`, the function does the work and updates the row, the client watches
it via Realtime (`src/hooks/useAsyncTask.ts`). Swapping in a real worker
later requires zero frontend changes.

## Feature status vs. the roadmap's 25 major features

Only meaningful for judging what's real. IDs (M01 etc.) match the roadmap PDF.

**Built and working:**
- Auth & Identity (M18) — Supabase Auth, email/password + Google OAuth, route guards.
- LLM Resume Parser (M04) — DeepSeek call on extracted text, confidence + mandatory confirm screen. PDF/txt only, no DOCX.
- Explainable Matching (M05, partial) — score + breakdown + explanation shown in UI, but scoring is cosine similarity (gte-small) + heuristic bonuses, not the full composite the roadmap specced.
- AI Cover Letter Generator (M11) — the most complete AI feature. DeepSeek, credit-gated, tone/notes input, editable, regenerate, placeholder detection, idempotent Edge Function, refund-on-failure. See SETUP.md "Cover letters" section for the full design (worth reading before touching this code).
- Application Tracker / Kanban (M14) — drag-and-drop, stages, notes, next-action dates, resume-version-sent snapshot (minor m23).
- Billing/Credit Ledger foundation (M19, partial) — `credit_balances` + `usage_events` tables, `consume_credit`/`refund_credit` RPCs with race-condition handling. **No Stripe** — BillingPage is a stub.

- Ghost Job Detector (M07) — deterministic SQL scoring function (`public.compute_ghost_signal`, migration `0007_ghost_job_detector.sql`), auto-recomputed via trigger on job insert/update, backfilled for existing rows. Scores on days-open, repost count, salary disclosure, first-party-ATS-vs-aggregator source; company fill-rate term is wired but dormant until something populates `companies.enrichment->>'fill_rate'`. No scheduler exists yet (no pg_cron/Celery Beat), so a job's `days_open` only re-ages on the next write to that row — call `select public.recompute_all_ghost_signals();` periodically until that's wired up.

**Schema exists, logic doesn't (don't assume these work):**
- Canonical Schema & Dedup (M02) — `jobs.fingerprint` column exists; no ingestion pipeline populates it.
- Hybrid Semantic Search (M03) — NOT built. `job_embeddings` table (vector(768) + HNSW) from migration 0001 is orphaned/unused; real embeddings live on `jobs.embedding`/`profiles.embedding` (vector(384)) from migration 0004. No FTS, no RRF, no ANN index actually queried.

**Not started at all:** Unified Job Ingestion (M01, no ATS connectors, no scraper), NL Job Search (M06), Company Intelligence (M08), Salary Intelligence (M09), ATS Resume Optimiser (M10), Skill Gap Analyser (M12, page is a `<ComingSoon>` stub), AI Interview Prep (M13), Assisted Apply (M15), Smart Job Alerts (M16), Agent Orchestration (M17), AI Cost Guardrails/Model Router (M20), Market Analytics Dashboard (M21), Notification/Email Infra (M22), Eval Harness (M23 — `bench.ts` is a manual one-off script, not CI), Admin Console (M24), Compliance/Governance (M25).

Net: **Phase 0 → early Phase 1** of the roadmap's 6-phase plan, per SETUP.md's own framing.

## Database (`supabase/migrations/0001`–`0007`)

- `profiles` — parsed resume JSONB, years_experience, remote_preference, salary_floor, embedding vector(384)
- `resumes` — storage path, extracted_text, parse_report, versioning
- `companies`, `jobs` — jobs has fingerprint (dedup, unused), embedding vector(384), source, apply_url
- `job_embeddings` — orphaned, vector(768)+HNSW, don't use, don't trust it's populated
- `ghost_signals` — schema only, unpopulated
- `matches` — score, score_breakdown JSONB, explanation
- `applications` — Kanban state
- `tasks` — the async queue backbone; RLS deliberately blocks client `update` (only `insert`/`select`) — only security-definer functions or a future service-role worker may write results. **Never loosen this.**
- `usage_events`, `credit_balances` — billing source of truth
- `cover_letters` — one per (user, job), trigger pins provenance columns against client tampering
- `private.app_config` — dispatcher URL + shared secret, not in public schema

Migration `0006` fixed a real, verified exploit: `do_parse_resume`/
`do_generate_matches`/`tier_monthly_credits` were `security definer` with
Postgres's default PUBLIC execute grant, letting any signed-in user rewrite
another user's task row by guessing/learning its UUID.

## Edge Functions (`supabase/functions/`, Deno)

- `generate-cover-letter` — see SETUP.md, it's the reference implementation for how AI features here should be built (shared-secret auth, credit charge-before-call with refund-on-failure, idempotent via conditional `update ... where status='queued'`, prompt-injection fencing, output validation). **Deployed for the first time** in this session — it existed only in source before, never pushed.
- `generate-matches` — heuristic cosine similarity + bonuses. Had a live bug (referenced the Supabase client before initializing it, in the task-re-read path added for the auth fix) — **fixed**, client now initializes before the lookup.
- `parse-resume` — DeepSeek call, plain-text input only, no file parsing (that's client-side via `pdfjs-dist`). Had the identical client-before-init bug — **fixed**.
- All three require `TASK_DISPATCH_SECRET` and fail closed (503) if unset — see DEPLOY.md before deploying. **Live and set** on the real project as of this session, matched to a `private.app_config` row seeded with the same value. All three verified end-to-end against production (real DeepSeek calls, real ghost-signal-adjusted match scores).

## Known rough edges / things to check before relying on them

- `check-tasks.js`, `invoke-ef.js`, `test-matches.js` at repo root are manual debug scripts with a hardcoded Supabase URL/anon key and a plaintext test-account password. Lower risk than it looks: all three are in `.gitignore`, so they never reach git history, and the key in them is the public "publishable" anon key (same one shipped in the frontend bundle) — not a secret. Still don't copy the pattern into anything that does get committed.
- A DeepSeek API key was previously committed to `parse-resume/index.ts` source; SETUP.md flags it must be rotated at platform.deepseek.com if not already done.
- No DOCX support (PDF/txt only). No rate limiting beyond Supabase defaults.
- Git history is a single "Initial commit" — most of the security fixes, `scripts/bundle-function.ts`, migration 0006, and now 0007 (ghost job detector) exist only in the working tree, not committed yet.

## Session log (chronological, most recent first)

- **Deployed all of the above to the live cloud project (`wtkmrkhaokrcxvkrfyop`)** via `npx supabase` CLI (linked with `supabase link --project-ref wtkmrkhaokrcxvkrfyop`), and end-to-end tested it against real data. Key finding along the way: the remote database had **no CLI migration-history records at all** (everything had been applied by pasting into the SQL Editor, per SETUP.md's "easiest path"), and migrations 0005/0006 turned out to have **never actually been applied** despite cover letters "looking done" in code — there was no `cover_letters` table, no `private.app_config`, no `consume_credit`/`refund_credit` live. Fixed by: `migration repair --status applied` for 0001–0004 (genuinely already live), `db push` for 0007 (new), then repair+push for 0005/0006 once the gap was found. Also generated and set `TASK_DISPATCH_SECRET`, seeded `private.app_config` (functions_url/anon_key/task_dispatch_secret), and deployed `generate-cover-letter` for the first time (it had never been deployed at all). Verified live: inserted real `generate_matches` and `parse_resume` tasks directly via `supabase db query --linked` and watched both go `queued → done` with real DeepSeek output and real ghost-risk-adjusted scores. **Lesson for next time:** "the function is already there" doesn't mean its migrations ran — check `information_schema` against what a migration actually creates before trusting `migration list`/repair state on a project that was ever set up by hand.
- Fixed a live bug shared by `parse-resume` and `generate-matches`: both re-read the task row (a security fix — never trust `user_id` from the request body) *before* the Supabase client that query needs existed. Every invocation of either function was throwing. Client init now happens first in both.
- Implemented the Ghost Job Detector (M07): `supabase/migrations/0007_ghost_job_detector.sql` adds `compute_ghost_signal()` (deterministic scoring — days-open, reposts, salary disclosure, first-party-ATS-vs-aggregator source, optional company fill-rate), a trigger that recomputes it on relevant `jobs` column changes, and a backfill. `seed.sql`'s hand-written `ghost_signals` rows were removed since the trigger now produces them from the job data itself.

## Where to look for more

- `SETUP.md` — local dev setup, full "what's real vs stubbed" list, credit-charging design rationale.
- `DEPLOY.md` — dashboard-only deploy steps, secrets, the authorization holes it closes.
- `implementation_plan.md` — the original two-platform master spec (Platform A + B).
- The roadmap PDF (shared in chat, not in-repo) — competitive landscape, risk register, phased plan, pricing model. Ask the user to re-share if it's needed and not in conversation context.
