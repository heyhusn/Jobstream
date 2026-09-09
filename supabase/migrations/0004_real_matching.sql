-- Enable pgvector and pg_net extensions
create extension if not exists vector;
create extension if not exists pg_net;

-- Add embedding columns (gte-small is 384 dimensions)
alter table public.jobs add column if not exists embedding vector(384);
alter table public.profiles add column if not exists embedding vector(384);

-- Replace handle_new_task to call edge functions
create or replace function public.handle_new_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_anon_key text;
begin
  -- Note: These URLs should point to your deployed Edge Functions.
  -- For local dev with Supabase CLI, it's typically http://host.docker.internal:54321/functions/v1/
  -- For production, it's https://<project-ref>.supabase.co/functions/v1/
  v_url := 'https://wtkmrkhaokrcxvkrfyop.supabase.co/functions/v1/';
  v_anon_key := 'sb_publishable_gQprN2Jov1dCxyaVJlJufQ_XcxMaVVM';

  if new.task_type = 'parse_resume' then
    -- Send to DeepSeek parser edge function
    perform net.http_post(
      url := v_url || 'parse-resume',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_anon_key
      ),
      body := jsonb_build_object('record', row_to_json(new))
    );
  elsif new.task_type = 'generate_matches' then
    -- Send to embedding/matching edge function
    perform net.http_post(
      url := v_url || 'generate-matches',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_anon_key
      ),
      body := jsonb_build_object('record', row_to_json(new))
    );
  end if;

  return new;
end;
$$;
