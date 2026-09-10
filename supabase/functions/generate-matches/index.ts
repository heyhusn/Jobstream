import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-task-secret',
};

// Shared secret, required. These functions hold a service-role
// client, so a caller who can shape the request body is acting as
// whichever user they name. Set TASK_DISPATCH_SECRET as a function
// secret and seed the same value into private.app_config — see
// supabase/migrations/0005_cover_letters.sql.
function checkSecret(req: Request): Response | null {
  const expected = Deno.env.get('TASK_DISPATCH_SECRET');
  if (!expected) {
    console.error('TASK_DISPATCH_SECRET is not set; refusing every request.');
    return new Response(JSON.stringify({ error: 'This function is not configured.' }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const got = req.headers.get('x-task-secret') ?? '';
  const enc = new TextEncoder();
  const a = enc.encode(got), b = enc.encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  if (diff !== 0) {
    return new Response(JSON.stringify({ error: 'Not authorised.' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  return null;
}


serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const denied = checkSecret(req);
  if (denied) return denied;

  let taskId = null;
  let supabase = null;

  try {
    const { record } = await req.json();
    
    // We only care about generate_matches tasks
    if (record.task_type !== 'generate_matches') {
      return new Response(JSON.stringify({ error: 'Wrong task type' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    taskId = record.id;

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) {
      throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set in this function\'s environment.');
    }
    supabase = createClient(supabaseUrl, serviceKey);

    // Re-read the task rather than trusting the request body: the
    // posted `user_id` used to be taken at face value, so anyone who
    // could reach this URL could act as any user through the
    // service-role client below.
    const { data: taskRow } = await supabase
      .from('tasks').select('id, user_id, task_type, status').eq('id', taskId).single();
    if (!taskRow || taskRow.task_type !== 'generate_matches') {
      return new Response(JSON.stringify({ error: 'No such task.' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const userId = taskRow.user_id;

    // Update task to running
    await supabase.from('tasks').update({ status: 'running' }).eq('id', taskId);

    // Get user profile
    const { data: profile, error: profileErr } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (profileErr || !profile || !profile.parsed) {
      await supabase.from('tasks').update({ status: 'failed', error: 'No profile to match against yet.' }).eq('id', taskId);
      return new Response(JSON.stringify({ error: 'No profile' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Import the Supabase AI session (Deno edge function environment supports this natively when running in Supabase)
    // The correct model name in Supabase is passed as the first parameter
    const session = new (globalThis as any).Supabase.ai.Session('gte-small');

    let profileEmbeddingRaw = profile.embedding;
    let profileEmbedding = typeof profileEmbeddingRaw === 'string' ? JSON.parse(profileEmbeddingRaw) : profileEmbeddingRaw;

    // If profile has no embedding, create it
    if (!profileEmbedding) {
      const skillsStr = (profile.parsed.skills || []).join(', ');
      const textToEmbed = `Skills: ${skillsStr}. Experience: ${profile.parsed.years_experience} years.`;
      const pEmbedding = await session.run(textToEmbed, { mean_pool: true, normalize: true });
      
      // Flatten or convert Float32Array to normal Array for JSON stringification
      if (Array.isArray(pEmbedding) && Array.isArray(pEmbedding[0])) {
        profileEmbedding = pEmbedding[0];
      } else {
        profileEmbedding = Array.from(pEmbedding);
      }

      // Update profile
      await supabase.from('profiles').update({ embedding: JSON.stringify(profileEmbedding) }).eq('id', userId);
    }

    // Get all active jobs
    const { data: jobs, error: jobsErr } = await supabase.from('jobs').select('*, ghost_signals(risk_band)').eq('is_active', true);
    if (jobsErr) throw jobsErr;

    let createdCount = 0;

    for (const job of jobs) {
      let jobEmbeddingRaw = job.embedding;
      let jobEmbedding = typeof jobEmbeddingRaw === 'string' ? JSON.parse(jobEmbeddingRaw) : jobEmbeddingRaw;
      if (!jobEmbedding) {
        const jobText = `${job.title} ${job.description}`;
        const jEmbedding = await session.run(jobText, { mean_pool: true, normalize: true });
        
        if (Array.isArray(jEmbedding) && Array.isArray(jEmbedding[0])) {
          jobEmbedding = jEmbedding[0];
        } else {
          jobEmbedding = Array.from(jEmbedding);
        }

        await supabase.from('jobs').update({ embedding: JSON.stringify(jobEmbedding) }).eq('id', job.id);
      }

      // Compute cosine similarity (vector inner product since they are normalized)
      let similarity = 0;
      for (let i = 0; i < profileEmbedding.length; i++) {
        similarity += profileEmbedding[i] * jobEmbedding[i];
      }

      // Base score on similarity [0-1] scaled to [0-100]
      let score = Math.max(0, Math.min(100, Math.round(similarity * 100)));
      
      // If similarity resulted in NaN (e.g. invalid embedding arrays), fallback to 0
      if (isNaN(score)) {
        score = 0;
      }
      
      let breakdown = [];

      breakdown.push({
        label: `Semantic similarity score: ${score}%`,
        delta: score,
        direction: score > 50 ? 'pass' : 'fail'
      });

      // Apply other heuristics like remote preference, salary, risk band
      if (profile.remote_preference && profile.remote_preference !== 'no_preference') {
        if (profile.remote_preference === job.remote_type) {
          score = Math.min(100, score + 12);
          breakdown.push({ label: 'Work arrangement matches your preference', delta: 12, direction: 'pass' });
        } else {
          score = Math.max(0, score - 10);
          breakdown.push({ label: `Not your preferred work arrangement (${job.remote_type || 'unspecified'})`, delta: -10, direction: 'fail' });
        }
      }

      if (profile.salary_floor && job.salary_max) {
        if (job.salary_max >= profile.salary_floor) {
          score = Math.min(100, score + 10);
          breakdown.push({ label: 'Salary range meets your stated floor', delta: 10, direction: 'pass' });
        } else {
          score = Math.max(0, score - 15);
          breakdown.push({ label: 'Salary range is below your stated floor', delta: -15, direction: 'fail' });
        }
      }

      const riskBand = job.ghost_signals?.[0]?.risk_band;
      if (riskBand === 'high') {
        score = Math.max(0, score - 20);
        breakdown.push({ label: 'High ghost-risk posting', delta: -20, direction: 'fail' });
      }

      // Cap final score
      score = Math.max(5, Math.min(99, score));

      // Upsert match
      await supabase.from('matches').upsert({
        user_id: userId,
        job_id: job.id,
        score: score,
        score_breakdown: breakdown,
        explanation: 'Real embedding similarity match using Supabase/gte-small.',
        computed_at: new Date().toISOString()
      }, { onConflict: 'user_id, job_id' });

      createdCount++;
    }

    // Finish task
    await supabase.from('tasks').update({ 
      status: 'done', 
      result: { matches_created: createdCount } 
    }).eq('id', taskId);

    return new Response(JSON.stringify({ success: true, created: createdCount }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    if (taskId && supabase) {
      await supabase.from('tasks').update({ status: 'failed', error: message }).eq('id', taskId);
    }
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
