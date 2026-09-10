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
- `0006_lock_down_legacy_functions.sql` — revokes EXECUTE on the
  0003 helpers from `anon`/`authenticated` (see below)

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

**All three steps are required.** The functions read every secret
from the environment with no literal fallback, and refuse to run
without them — an unconfigured deploy fails loudly instead of
running on a committed key or an open endpoint.

```bash
SECRET="$(openssl rand -hex 32)"

# 1. Secrets. DEEPSEEK_API_KEY is used by parse-resume and
#    generate-cover-letter; TASK_DISPATCH_SECRET by all three.
npx supabase secrets set DEEPSEEK_API_KEY=sk-...
npx supabase secrets set TASK_DISPATCH_SECRET="$SECRET"

# 2. The functions. Redeploy all three: parse-resume and
#    generate-matches now require the dispatch secret too.
npx supabase functions deploy generate-cover-letter
npx supabase functions deploy parse-resume
npx supabase functions deploy generate-matches

# 3. Tell the dispatcher where the functions live and what secret to
#    send. The same value as TASK_DISPATCH_SECRET above — if these
#    two disagree, every task 401s and sits queued forever.
psql "$DATABASE_URL" -c "
  insert into private.app_config (key, value) values
    ('functions_url', 'https://<project-ref>.supabase.co/functions/v1/'),
    ('anon_key', '<your anon key>'),
    ('task_dispatch_secret', '$SECRET')
  on conflict (key) do update set value = excluded.value, updated_at = now();"
```

### Why the dispatch secret matters

An Edge Function holds a service-role client — it can read and
write any row, for any user. `parse-resume` and `generate-matches`
take the user id straight from the request body, so anyone who
finds the function URL can POST `{"record":{"user_id":"<anyone>"}}`
and act as that person. That's a live hole in those two.

All three functions now close it the same two ways: they take only
the task **id** from the request and re-read `user_id` and
`task_type` from the row, and they reject any request whose
`x-task-secret` header doesn't match (compared in constant time).
An unset `TASK_DISPATCH_SECRET` returns 503 to everyone rather than
waving callers through — it fails closed, which is why step 1 above
is not optional.

The DeepSeek key that used to sit in `parse-resume/index.ts` is
gone from the source, but **it was committed, so rotate it** at
platform.deepseek.com before setting the secret above.

`0006_lock_down_legacy_functions.sql` closes a third hole in the
same area: `do_parse_resume` and `do_generate_matches` from 0003
are `security definer`, and Postgres grants EXECUTE on new
functions to PUBLIC, so any signed-in user who learned another
user's task UUID could call them and rewrite that task row —
straight past 0001's deliberate "no update policy on tasks". That
was verified as a working exploit before the migration was written.

### Credits

`consume_credit()` rejects a non-positive amount outright (a
negative one used to pass the "can you afford it" test and then add
to the balance), locks the balance row, folds in the monthly
reset, decrements, and writes a `usage_events` row — all in one
transaction, so two tabs can't both spend the last credit. The
function charges *before* calling the model and refunds on any
failure (logged as a negative usage event, not a deletion), because
charging on success lets someone run the model for free by hanging
up before the write.

`refund_credit()` is a reversal, not a top-up: it refuses to return
more than the feature actually charged this month, and returns
false rather than lying when there is no balance row to credit. If
a refund doesn't land, the task says so — "a credit was charged and
could not be returned automatically" — instead of the old message,
which claimed you hadn't been charged while the credit was gone.

Neither function is callable by `anon` or `authenticated` — a client
that could call the refund would have infinite credits.

### Delivery is at-least-once, so the function is idempotent

pg_net retries, and two deliveries of the same webhook overlap
routinely. The function claims its task with a conditional
`update ... where status = 'queued'` and proceeds only if that
matched a row, so a duplicate delivery costs nothing. Reading the
status and then trusting it — which is what it did first — let both
deliveries through: two credits, two model calls, and the second
letter overwriting the first.

### What the letter will and won't say

The prompt forbids inventing anything not in the resume or profile,
and the function refuses to charge at all when there's no resume
and no parsed skills to write from. Output that isn't usable —
not JSON, too short, truncated — is rejected and refunded rather
than shown. Placeholders the model leaves behind (`[Hiring
Manager]`) are surfaced as a warning above the letter instead of
being silently shipped.

None of that makes it safe to send unread, and the UI says so.

### Checking the letters are actually good

The function's own test suite stubs the model, which proves the
plumbing and says nothing about the prose. `bench.ts` calls the live
API with the same `buildMessages`/`parseLetter` the function uses:

```bash
export DEEPSEEK_API_KEY=sk-...
deno run --allow-net --allow-env \
  supabase/functions/generate-cover-letter/bench.ts
```

Four cases — the three tones, plus a job description that tries to
talk to the model instead of describing a job (a second
`## The candidate` block with a fabricated Google/Stanford resume).
It prints each letter and checks length, placeholders, clichéd
openings, markdown leakage, whether anything unsupported by the
resume appeared, and whether the letter names real projects from it.

Swap the `RESUME` constant for your own text. Read the letters — the
checks catch the mechanical failures, not the flat ones.

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
