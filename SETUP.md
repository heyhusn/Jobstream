# JobSpy — frontend setup

What this is: the Phase 0 → early Phase 1 slice from the roadmap —
auth, onboarding with a mandatory parse-confirmation step, and a
working matches screen — built against Supabase directly (Postgres,
Auth, Storage, Realtime) rather than the FastAPI/Celery backend from
the original plan. See "Why Supabase-only for now" below for what
that trades off.

**Verified working:** `npx tsc -b` and `npm run build` both pass
clean as of this writeup. Nothing here has been exercised against a
live Supabase project — that's the first thing to do.

## 1. Create the Supabase project

1. [supabase.com](https://supabase.com) → New project.
2. Settings → API → copy the **Project URL** and **anon public** key.
3. Copy `.env.example` to `.env.local` and fill both in:

   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```

## 2. Run the migrations

Everything the app needs — tables, RLS policies, the storage
bucket, the heuristic parse/match functions — is in
`supabase/migrations/`, in order:

- `0001_init.sql` — schema + row-level security
- `0002_storage.sql` — the `resumes` storage bucket
- `0003_demo_processing.sql` — the heuristic stand-ins (see below)
- `0004_real_matching.sql` — embeddings + Edge Function dispatch
- `0005_cover_letters.sql` — cover letters, credit charging, and a
  locked-down dispatch config (see "Cover letters" below)

**Easiest path:** open the Supabase SQL Editor and paste each file
in, in order.

**With the CLI**, if you have it:

```bash
npx supabase login
npx supabase link --project-ref your-project-ref
npx supabase db push
```

Then load `supabase/seed/seed.sql` the same way (SQL Editor, or
`psql "$DATABASE_URL" -f supabase/seed/seed.sql`) — five sample
jobs and companies so Matches isn't empty on first login.

## 3. Enable Google OAuth (optional)

The sign-in screen has a "Continue with Google" button already
wired up. If you don't set this up, email/password still works
fine — skip this section.

Authentication → Providers → Google, add your OAuth client ID and
secret. Add `http://localhost:5173` (and your deployed URL later)
under Authentication → URL Configuration → Redirect URLs.

## 4. Install and run

```bash
npm install
npm run dev
```

Sign up, upload a resume (PDF or `.txt`), confirm the parse, and
you should land on Matches with the five seeded jobs scored against
your profile.

## Why Supabase-only for now

The original plan (see the roadmap PDF) has FastAPI + Celery
workers doing the heavy async work, with Postgres just as storage.
This build collapses that: Supabase's Postgres holds the schema,
Supabase Auth replaces the JWT/OAuth layer, Supabase Storage holds
resumes, and a `tasks` table plus Realtime stands in for the
Celery/Redis queue.

That's a deliberate, forward-compatible choice, not a shortcut that
needs unwinding later. The frontend never talks to processing logic
directly — every generation feature writes a row to `tasks` and
watches it change (`src/hooks/useAsyncTask.ts`). Today, a Postgres
trigger fulfils `parse_resume` and `generate_matches` rows
synchronously. Later, a Celery worker can fulfil the same rows
asynchronously, and **no frontend code changes** — the UI already
handles "this might take a while" correctly, because it has to
either way.

## The heuristic stand-ins — read this before judging match quality

`0003_demo_processing.sql` is explicitly not the real thing:

- **Parse** is keyword matching against a fixed skills list plus a
  regex for "N years," not an LLM call. It's honest about this —
  every result carries `note: "Heuristic extraction — review every
  field before saving."`
- **Matching** is keyword overlap between your skills and each
  job's description, not embedding similarity. Real hybrid search
  (pgvector + full-text + RRF, per the roadmap's M03) needs actual
  embeddings, which needs an API key and a decision about which
  model — a reasonable next step, not a frontend concern.

Both are contained in one file, commented as temporary, and the
frontend has zero knowledge that they're heuristics rather than the
real pipeline. Delete the file and point the same `tasks` rows at a
real backend when it exists.

## What's real vs. stubbed

**Fully built:** sign-up/sign-in (password + Google OAuth), session
persistence, the onboarding flow (real PDF text extraction via
`pdfjs-dist`, a hard confirmation gate before anything touches your
profile), the matches screen (virtualised, expandable score
breakdowns, ghost-risk badges, live credit chip), route guards that
force onboarding before anything else is reachable.

**Also built:** the Kanban tracker (drag between stages, detail
drawer, "Save to tracker" from Matches) and AI cover letters — a
real DeepSeek call, one credit per letter, editable and saved.

**Routed but stubbed** (each page says so on screen): Skills,
Settings, Billing.

**Not started:** interview prep, assisted apply, Stripe.

## Cover letters

The first feature that calls a model and spends a credit. The flow:
the drawer writes a `cover_letter` row to `tasks` → the
`handle_new_task` trigger POSTs to the `generate-cover-letter` Edge
Function → the function charges a credit, calls DeepSeek, and
writes a row to `cover_letters` → the client sees the task go
`done` over Realtime and reads the letter.

### Deploying it

```bash
# 1. Secrets. The function reads these from the environment and has
#    no literal fallback — it fails loudly rather than running on a
#    key committed to the repo.
npx supabase secrets set DEEPSEEK_API_KEY=sk-...
npx supabase secrets set TASK_DISPATCH_SECRET="$(openssl rand -hex 32)"

# 2. The function itself.
npx supabase functions deploy generate-cover-letter

# 3. Tell the dispatcher where the functions live and what secret to
#    send. Same value as TASK_DISPATCH_SECRET above.
psql "$DATABASE_URL" -c "
  insert into private.app_config (key, value) values
    ('functions_url', 'https://<project-ref>.supabase.co/functions/v1/'),
    ('anon_key', '<your anon key>'),
    ('task_dispatch_secret', '<the same random hex>')
  on conflict (key) do update set value = excluded.value, updated_at = now();"
```

### Why the dispatch secret matters

An Edge Function holds a service-role client — it can read and
write any row, for any user. `parse-resume` and `generate-matches`
take the user id straight from the request body, so anyone who
finds the function URL can POST `{"record":{"user_id":"<anyone>"}}`
and act as that person. That's a live hole in those two.

`generate-cover-letter` closes it two ways: it takes only the task
**id** from the request and re-reads everything else from the
database, and it rejects any request without a matching
`x-task-secret` header. The header check is skipped when
`TASK_DISPATCH_SECRET` is unset, so an unconfigured project still
runs — set it. **The same fix should be ported to the other two
functions**, along with rotating the DeepSeek key that is currently
hardcoded in `parse-resume/index.ts`.

### Credits

`consume_credit()` locks the balance row, folds in the monthly
reset, decrements, and writes a `usage_events` row — all in one
transaction, so two tabs can't both spend the last credit. The
function charges *before* calling the model and refunds on any
failure (logged as a negative usage event, not a deletion), because
charging on success lets someone run the model for free by hanging
up before the write.

Neither `consume_credit` nor `refund_credit` is callable by
`anon` or `authenticated` — a client that could call the refund
would have infinite credits.

### What the letter will and won't say

The prompt forbids inventing anything not in the resume or profile,
and the function refuses to charge at all when there's no resume
and no parsed skills to write from. Output that isn't usable —
not JSON, too short, truncated — is rejected and refunded rather
than shown. Placeholders the model leaves behind (`[Hiring
Manager]`) are surfaced as a warning above the letter instead of
being silently shipped.

None of that makes it safe to send unread, and the UI says so.

## A production note before you charge anyone

The `tasks` RLS policy deliberately does **not** let a client mark
its own task `done` — only `insert` and `select` are open to the
authenticated user; `update` happens exclusively through
security-definer functions today, and will happen through a
service-role worker once Celery exists. Don't loosen this when
wiring up cover letters or interview prep — a client that could
write its own task result could fabricate a "generated" cover
letter and skip the credit charge entirely.

## Known rough edges

- `useAsyncTask`'s Realtime subscription plus its poll fallback
  both fire on every task — harmless but slightly wasteful; fine at
  this scale, worth tightening before real traffic.
- No DOCX support yet, PDF and `.txt` only.
- No rate limiting on the Supabase Auth endpoints beyond Supabase's
  own defaults — revisit before this is publicly linked anywhere.
