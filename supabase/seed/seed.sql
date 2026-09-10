-- Sample companies + jobs so the app renders real states out of the box.
-- Safe to re-run: fingerprint/domain conflicts are ignored.

insert into public.companies (canonical_name, domain, ats_type, size_band, hq_country)
values
  ('Ramp', 'ramp.com', 'greenhouse', '201-500', 'US'),
  ('Linear', 'linear.app', 'ashby', '51-200', 'US'),
  ('Notion', 'notion.so', 'greenhouse', '501-1000', 'US'),
  ('Vercel', 'vercel.com', 'greenhouse', '201-500', 'US'),
  ('Staffing Partner Co', null, 'unknown', '1-10', 'US')
on conflict (domain) do nothing;

with c as (select id, canonical_name from public.companies)
insert into public.jobs
  (company_id, title, description, location, remote_type, salary_min, salary_max,
   salary_currency, source, apply_url, fingerprint, first_seen_at, last_seen_at, repost_count, posted_at)
select
  c.id, j.title, j.description, j.location, j.remote_type,
  j.salary_min, j.salary_max, j.currency, j.source, j.apply_url, j.fingerprint,
  now() - (j.days_open || ' days')::interval,
  now(),
  j.reposts,
  now() - (j.days_open || ' days')::interval
from c
join (values
  ('Ramp', 'Machine Learning Engineer',
   'Build retrieval and ranking systems for spend intelligence. Python, PyTorch, production ML.',
   'Berlin, hybrid', 'hybrid', 95000, 125000, 'EUR', 'greenhouse',
   'https://job-boards.greenhouse.io/ramp/jobs/1', 'ramp-mle-berlin-001', 2, 0),
  ('Linear', 'Backend Engineer, Platform',
   'Own core services powering issue tracking at scale. Async Python or Go, PostgreSQL.',
   'Remote, EU', 'remote', 90000, 120000, 'EUR', 'ashby',
   'https://jobs.ashbyhq.com/linear/2', 'linear-backend-platform-002', 4, 0),
  ('Notion', 'AI Engineer, Applied Research',
   'Ship LLM-backed features end to end, from prompt design to production evaluation.',
   'Remote', 'remote', null, null, 'USD', 'greenhouse',
   'https://job-boards.greenhouse.io/notion/jobs/3', 'notion-ai-applied-003', 6, 0),
  ('Vercel', 'Frontend Engineer, Developer Experience',
   'Build the tools other engineers use daily. React, TypeScript, performance-obsessed.',
   'Remote', 'remote', 110000, 150000, 'USD', 'greenhouse',
   'https://job-boards.greenhouse.io/vercel/jobs/4', 'vercel-fe-dx-004', 1, 0),
  ('Staffing Partner Co', 'Senior Software Engineer',
   'Growing team seeks rockstar ninja engineer for fast-paced environment.',
   'Remote', 'remote', null, null, 'USD', 'aggregator',
   'https://example-aggregator.test/job/5', 'staffing-sse-005', 214, 6)
) as j(company_name, title, description, location, remote_type, salary_min, salary_max,
       currency, source, apply_url, fingerprint, days_open, reposts)
  on c.canonical_name = j.company_name
on conflict (fingerprint) do nothing;

-- Ghost signals are no longer seeded by hand: migration 0007 adds a
-- trigger that computes them from the job row itself the moment
-- it's inserted (days open, repost count, salary disclosure,
-- first-party vs. aggregator source). Re-running
-- `select public.recompute_all_ghost_signals();` after this file
-- refreshes them if you re-seed on a later day and want days_open
-- to reflect it.
