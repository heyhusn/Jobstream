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

  try {
    const { record } = await req.json();
    
    if (record.task_type !== 'parse_resume') {
      return new Response(JSON.stringify({ error: 'Wrong task type' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const taskId = record.id;

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) {
      throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set in this function\'s environment.');
    }
    const supabase = createClient(supabaseUrl, serviceKey);

    // Re-read the task rather than trusting the request body: the
    // posted `user_id` used to be taken at face value, so anyone who
    // could reach this URL could act as any user through the
    // service-role client below.
    const { data: taskRow } = await supabase
      .from('tasks').select('id, user_id, task_type, status').eq('id', taskId).single();
    if (!taskRow || taskRow.task_type !== 'parse_resume') {
      return new Response(JSON.stringify({ error: 'No such task.' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    await supabase.from('tasks').update({ status: 'running' }).eq('id', taskId);

    const extractedText = record.input?.extracted_text;
    if (!extractedText || extractedText.length < 20) {
      await supabase.from('tasks').update({ status: 'failed', error: 'Could not read enough text from that file.' }).eq('id', taskId);
      return new Response(JSON.stringify({ error: 'Not enough text' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Call DeepSeek
    // Was a literal committed to the repo. Rotate that key.
    const deepSeekKey = Deno.env.get('DEEPSEEK_API_KEY');
    if (!deepSeekKey) {
      await supabase.from('tasks').update({ status: 'failed', error: 'DEEPSEEK_API_KEY is not configured in Edge Function secrets.' }).eq('id', taskId);
      throw new Error('DEEPSEEK_API_KEY is not configured in Edge Function secrets.');
    }

    const prompt = `You are an expert resume parser. Extract the following information from the resume text:
1. A list of technical skills.
2. The total years of professional experience (as a number).
3. A confidence score between 0.0 and 1.0 indicating how confident you are in this extraction.

Return ONLY a JSON object with this exact structure:
{
  "skills": ["skill1", "skill2"],
  "years_experience": 5,
  "confidence": 0.9,
  "note": "Extracted via DeepSeek AI"
}

Resume Text:
${extractedText.substring(0, 8000)}
`;

    const dsResponse = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${deepSeekKey}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "You are a helpful assistant that outputs only valid JSON." },
          { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" }
      })
    });

    if (!dsResponse.ok) {
      const errorText = await dsResponse.text();
      throw new Error(`DeepSeek API error: ${dsResponse.status} ${errorText}`);
    }

    const dsData = await dsResponse.json();
    let result;
    try {
      let content = dsData.choices[0].message.content;
      content = content.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
      result = JSON.parse(content);
    } catch (e) {
      throw new Error('Failed to parse DeepSeek response as JSON: ' + dsData.choices[0].message.content);
    }

    // Default missing fields
    result = {
      skills: Array.isArray(result.skills) ? result.skills : [],
      years_experience: typeof result.years_experience === 'number' ? result.years_experience : 0,
      confidence: typeof result.confidence === 'number' ? result.confidence : 0.5,
      note: 'DeepSeek LLM extraction'
    };

    // FIX: no write to `profiles` here — removed entirely. The
    // confirm screen in OnboardingPage.tsx reads this from the
    // task's own `result` field. Nothing should touch the live
    // profile until it's been reviewed and confirmed on screen.

    // Finish task
    await supabase.from('tasks').update({ status: 'done', result }).eq('id', taskId);

    return new Response(JSON.stringify({ success: true, result }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
