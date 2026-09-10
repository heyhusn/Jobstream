# Deploying to Supabase cloud (dashboard, no CLI)

Project: `wtkmrkhaokrcxvkrfyop`

Follow this in order. Every step leaves the app working — the two
functions you already have deployed keep running until the step that
deliberately replaces them.

---

## 1. Run the migrations (SQL Editor)

If you have already run `0001`–`0004`, skip them: `0001` in particular
is not re-runnable (bare `create table`, bare `create policy`).

Paste and run, in order:

- `supabase/migrations/0005_cover_letters.sql`
- `supabase/migrations/0006_lock_down_legacy_functions.sql`

Both are safe to re-run as many times as you like.

`0005` rewrites `handle_new_task`. Until step 3 seeds the config
table it falls back to your project URL and publishable key and sends
no secret header, so `parse-resume` and `generate-matches` carry on
working exactly as they do now.

**Check it took:**

```sql
select routine_name from information_schema.routines
 where routine_schema = 'public'
   and routine_name in ('consume_credit','refund_credit','handle_new_task');

select tablename from pg_tables where schemaname = 'private';
```

---

## 2. Set the function secrets

Dashboard → Edge Functions → Secrets. Add both:

| Name | Value |
|---|---|
| `DEEPSEEK_API_KEY` | your DeepSeek key |
| `TASK_DISPATCH_SECRET` | a long random string — see below |

Generate the secret however you like; any 32+ random hex characters
will do. In your browser console:

```js
crypto.randomUUID() + crypto.randomUUID()
```

Keep it somewhere — you need the identical value in step 3.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the
platform. Don't add them.

---

## 3. Seed the dispatcher config (SQL Editor)

Replace `<the same secret>` with the value from step 2. If these two
disagree, every task 401s and sits queued forever with nothing in the
UI to explain it — so paste, don't retype.

```sql
insert into private.app_config (key, value) values
  ('functions_url',        'https://wtkmrkhaokrcxvkrfyop.supabase.co/functions/v1/'),
  ('anon_key',             'sb_publishable_gQprN2Jov1dCxyaVJlJufQ_XcxMaVVM'),
  ('task_dispatch_secret', '<the same secret>')
on conflict (key) do update
  set value = excluded.value, updated_at = now();
```

From here the trigger sends an `x-task-secret` header on every
dispatch. Your two currently-deployed functions ignore headers they
don't know about, so nothing breaks yet.

---

## 4. Deploy `generate-cover-letter`

Dashboard → Edge Functions → Deploy a new function → name it
**`generate-cover-letter`** (the name must match exactly — the
trigger builds the URL from it).

Paste the contents of:

```
supabase/functions/generate-cover-letter/_deploy.single.ts
```

That file is **generated**. The function is written as `index.ts` +
`prompt.ts` so the prompt and the response validation can be unit
tested; the dashboard editor wants one file. After changing either
source, regenerate it:

```bash
deno run --allow-read --allow-write scripts/bundle-function.ts
```

Never hand-edit `_deploy.single.ts` — your change will be overwritten
the next time anyone runs the bundler.

**Test it end to end:** sign in, save a job from Matches, open it in
the Tracker, click *Draft a cover letter*. You should see the credit
chip drop by one and a letter appear within ~10 seconds.

If it fails, look at `tasks.error` first — it carries the
user-facing reason:

```sql
select id, status, error, created_at from public.tasks
 where task_type = 'cover_letter' order by created_at desc limit 5;
```

| `tasks.error` / symptom | Cause |
|---|---|
| Stuck on `queued`, never runs | Function not deployed, or name mismatch |
| Stuck on `queued`, function logs show 401 | The two secrets in steps 2 and 3 don't match |
| Function logs show 503 "not configured" | `TASK_DISPATCH_SECRET` missing from step 2 |
| `You're out of credits for this month.` | Working as intended — free tier is 3/month |
| `DEEPSEEK_API_KEY is not set…` | Step 2 secret missing or misnamed |

---

## 5. Replace `parse-resume` and `generate-matches`

**Do this after step 3, not before.** These versions require the
dispatch secret, so they refuse everything until the config row
exists.

Paste over the existing functions in the dashboard:

- `supabase/functions/parse-resume/index.ts`
- `supabase/functions/generate-matches/index.ts`

### What changed and why

You already fixed the committed API key in `parse-resume` and dropped
the premature `profiles` write — both correct, and both kept. Three
things remain in what's currently deployed:

**They trust `record.user_id` from the request body.** Both functions
build a service-role client and then act on whichever user the POST
body names. Anyone who has your publishable key — it ships in your
frontend bundle, so that's everyone — can `POST` to
`.../functions/v1/generate-matches` with `{"record":{"task_type":
"generate_matches","user_id":"<any uuid>"}}` and write matches rows
and a profile embedding for that user. The fixed versions take only
the task **id** from the body and read `user_id` and `task_type` back
from the row.

**No authentication of the caller.** The fixed versions require the
`x-task-secret` header, compared in constant time, and return 503
rather than running if the secret isn't configured. Fail closed: an
endpoint holding a service-role key should not be reachable by
anything that merely knows the URL.

**A publishable-key fallback baked into the source.** Removed. Both
now read `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the
environment and throw a clear error if either is missing, rather than
silently degrading to a client that can't do what the code assumes.

Also worth doing regardless: **rotate the DeepSeek key that was in
the file**. It was committed to the repo and pasted into chat, so
treat it as public even though it's no longer in the source.

---

## 6. Check the letters are any good

The test suite stubs the model, which proves the plumbing and says
nothing about the prose:

```bash
export DEEPSEEK_API_KEY=sk-...
deno run --allow-net --allow-env \
  supabase/functions/generate-cover-letter/bench.ts
```

Three tones plus a job description that tries to talk to the model
instead of describing a job. Read the letters — the automated checks
catch mechanical failures (placeholders, clichéd openings, invented
employers), not flat writing.

---

## Notes on the cloud setup

**`verify_jwt`.** Functions require a JWT by default; the trigger
sends your publishable key as the bearer token, which the gateway
accepts. If you ever see a 401 that isn't the dispatch secret, check
that toggle in the function's settings.

**Wall-clock budget.** Supabase kills an Edge Function worker at
150s on the free plan (400s on paid). `generate-cover-letter` gives
its model calls a 100s budget shared across attempts — enough for
one retry at 45s each, leaving 50s for the database round trips
either side and for a cold start. If you move to a paid plan you can
raise it with an `LLM_BUDGET_MS` secret; there's no need to on free.

That cap is why the retry uses a shared deadline rather than a
per-attempt timeout: overrunning it is the one failure that kills
the worker before the refund can run, stranding a credit and leaving
the task on `running` forever.

**`Supabase.ai.Session`** in `generate-matches` only exists in
Supabase's edge runtime, so that function can't be tested locally
with plain Deno. That's fine — it's the one function whose behaviour
you'll have to verify in the dashboard.

**Realtime.** The frontend watches `tasks` over Realtime with a 4s
poll as a fallback, so a missed Realtime event costs a few seconds,
not a stuck screen.

`0006` also adds `credit_balances` to the `supabase_realtime`
publication. `0001` only added `tasks`, but `useCreditBalance`
subscribes to `credit_balances` — so that subscription has never
delivered anything, and the credit chip only ever moved when
something else happened to invalidate the query. Verify after
running it:

```sql
select tablename from pg_publication_tables
 where pubname = 'supabase_realtime' and schemaname = 'public';
```
