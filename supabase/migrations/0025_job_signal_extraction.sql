-- ═══════════════════════════════════════════════════════════
-- Job signal extraction — minors m12 (visa sponsorship), m13
-- (seniority classifier), m14 (tech stack tags). Same posture as
-- 0007's ghost detector and m15's remote_type normaliser: plain
-- regex/keyword classification over columns already on `jobs`, not
-- an LLM call — nothing to prompt-inject, nothing to hallucinate,
-- effectively free to run, and it recomputes via the same
-- insert/update trigger pattern 0007 established.
--
-- Honesty note, same rule as everywhere else in this app: these are
-- text-pattern signals, not verified facts. `visa_sponsorship` says
-- what the posting's own text claims, not what the company will
-- actually do; `seniority` is inferred from the job title, which is
-- occasionally wrong (a "Senior" title at one company can be a
-- "Staff" title at another) — that's exactly why m13 also ships a
-- per-user override table below rather than treating the classifier
-- as final.
-- ═══════════════════════════════════════════════════════════

alter table public.jobs
  add column if not exists visa_sponsorship text
    check (visa_sponsorship in ('offered', 'not_offered')),
  add column if not exists seniority text
    check (seniority in ('intern', 'entry', 'mid', 'senior', 'staff', 'lead', 'manager', 'director', 'executive')),
  add column if not exists tech_stack text[] not null default '{}';

create index if not exists jobs_seniority_idx on public.jobs(seniority);
create index if not exists jobs_tech_stack_idx on public.jobs using gin (tech_stack);

create or replace function public.extract_job_signals(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs%rowtype;
  v_text text;
  v_title text;
  v_visa text;
  v_seniority text;
  v_tags text[] := '{}';
  -- (pattern, tag) — checked as case-insensitive regex against
  -- title+description. Ambiguous common-English-word names (Go, R,
  -- C) are deliberately left out rather than guessed at; "Golang"
  -- and "C++"/"C#" are unambiguous enough to keep.
  v_dict text[][] := array[
    array['\ypython\y', 'Python'], array['\ytypescript\y', 'TypeScript'],
    array['\yjavascript\y', 'JavaScript'], array['\yjava\y', 'Java'],
    array['\ygolang\y', 'Go'], array['\yrust\y', 'Rust'], array['c\+\+', 'C++'],
    array['c#', 'C#'], array['\yruby\y', 'Ruby'], array['\yphp\y', 'PHP'],
    array['\yswift\y', 'Swift'], array['\ykotlin\y', 'Kotlin'],
    array['\yreact\y', 'React'], array['\yvue(\.js)?\y', 'Vue'],
    array['\yangular\y', 'Angular'], array['\ynode(\.js)?\y', 'Node.js'],
    array['\ydjango\y', 'Django'], array['\yflask\y', 'Flask'],
    array['\yfastapi\y', 'FastAPI'], array['\yspring( boot)?\y', 'Spring'],
    array['\yrails\y', 'Rails'], array['\ypostgres(ql)?\y', 'PostgreSQL'],
    array['\ymysql\y', 'MySQL'], array['\ymongodb\y', 'MongoDB'],
    array['\yredis\y', 'Redis'], array['\ykafka\y', 'Kafka'],
    array['\yaws\y', 'AWS'], array['\ygcp\y', 'GCP'], array['\yazure\y', 'Azure'],
    array['\ydocker\y', 'Docker'], array['\ykubernetes\y', 'Kubernetes'],
    array['\yterraform\y', 'Terraform'], array['\ygraphql\y', 'GraphQL'],
    array['\ytensorflow\y', 'TensorFlow'], array['\ypytorch\y', 'PyTorch'],
    array['scikit-learn', 'Scikit-learn'], array['\yspark\y', 'Spark'],
    array['\yairflow\y', 'Airflow'], array['\ysnowflake\y', 'Snowflake'],
    array['\ysalesforce\y', 'Salesforce']
  ];
  v_pair text[];
begin
  select * into v_job from public.jobs where id = p_job_id;
  if not found then
    return;
  end if;

  v_title := coalesce(v_job.title, '');
  v_text  := v_title || ' ' || coalesce(v_job.description, '');

  -- m12: visa sponsorship signal. Negative phrasing checked first —
  -- "no sponsorship available" would otherwise also match a naive
  -- positive "sponsorship" pattern.
  if v_text ~* '(no|not|unable to|does not|won''t|will not)\s+(provide\s+|offer\s+)?(visa\s+)?sponsor' then
    v_visa := 'not_offered';
  elsif v_text ~* '(visa\s+)?sponsorship\s+(is\s+)?(available|offered|provided)|will\s+sponsor|sponsor(s|ing)?\s+visas?|\yh-?1b\y|open\s+to\s+sponsor' then
    v_visa := 'offered';
  else
    v_visa := null;
  end if;

  -- m13: seniority, from the title first (most reliable signal),
  -- most-specific patterns checked before general ones so "Senior
  -- Engineering Manager" lands on manager, not senior.
  if v_title ~* '\yintern(ship)?\y' then
    v_seniority := 'intern';
  elsif v_title ~* '\y(vp|vice president|chief|c[a-z]o|head of)\y' then
    v_seniority := 'executive';
  elsif v_title ~* '\ydirector\y' then
    v_seniority := 'director';
  elsif v_title ~* '\y(manager|mgr)\y' then
    v_seniority := 'manager';
  elsif v_title ~* '\y(principal|distinguished)\y' then
    v_seniority := 'staff';
  elsif v_title ~* '\ystaff\y' then
    v_seniority := 'staff';
  elsif v_title ~* '\ylead\y' then
    v_seniority := 'lead';
  elsif v_title ~* '\y(senior|sr\.?)\y' then
    v_seniority := 'senior';
  elsif v_title ~* '\y(entry.level|junior|jr\.?|associate|new grad|graduate)\y' then
    v_seniority := 'entry';
  else
    v_seniority := 'mid';
  end if;

  -- m14: tech stack tags, deduplicated.
  foreach v_pair slice 1 in array v_dict loop
    if v_text ~* v_pair[1] then
      v_tags := array_append(v_tags, v_pair[2]);
    end if;
  end loop;

  update public.jobs
     set visa_sponsorship = v_visa,
         seniority = v_seniority,
         tech_stack = v_tags
   where id = p_job_id;
end;
$$;

revoke all on function public.extract_job_signals(uuid) from public, anon, authenticated;
grant execute on function public.extract_job_signals(uuid) to service_role;

create or replace function public.trigger_extract_job_signals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.extract_job_signals(new.id);
  return new;
end;
$$;

drop trigger if exists jobs_extract_signals on public.jobs;
create trigger jobs_extract_signals
  after insert or update of title, description
  on public.jobs
  for each row execute function public.trigger_extract_job_signals();

-- Backfill every existing row.
do $$
declare
  v_job_id uuid;
begin
  for v_job_id in select id from public.jobs loop
    perform public.extract_job_signals(v_job_id);
  end loop;
end;
$$;

-- ── seniority_overrides ──────────────────────────────────────
-- m13's "user override": the classifier above is shared/global (one
-- row per job), so a person who disagrees with it can't edit `jobs`
-- directly without changing what every other user sees. This is a
-- plain per-user override instead — same owner-only CRUD posture as
-- `applications`/`job_alerts`.
create table if not exists public.seniority_overrides (
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  seniority text not null
    check (seniority in ('intern', 'entry', 'mid', 'senior', 'staff', 'lead', 'manager', 'director', 'executive')),
  created_at timestamptz not null default now(),
  primary key (user_id, job_id)
);

alter table public.seniority_overrides enable row level security;

create policy "seniority overrides are owner-only" on public.seniority_overrides
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
