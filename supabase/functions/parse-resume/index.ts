import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { record } = await req.json();
    
    if (record.task_type !== 'parse_resume') {
      return new Response(JSON.stringify({ error: 'Wrong task type' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const taskId = record.id;
    const userId = record.user_id;

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'https://wtkmrkhaokrcxvkrfyop.supabase.co';
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') || 'sb_publishable_gQprN2Jov1dCxyaVJlJufQ_XcxMaVVM';
    const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || supabaseKey);

    await supabase.from('tasks').update({ status: 'running' }).eq('id', taskId);

    const extractedText = record.input?.extracted_text;
    if (!extractedText || extractedText.length < 20) {
      await supabase.from('tasks').update({ status: 'failed', error: 'Could not read enough text from that file.' }).eq('id', taskId);
      return new Response(JSON.stringify({ error: 'Not enough text' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Call DeepSeek
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

    // Update profile
    await supabase.from('profiles').update({
      parsed: result,
      onboarding_stage: 'confirm_parse'
    }).eq('id', userId);

    // Finish task
    await supabase.from('tasks').update({ status: 'done', result }).eq('id', taskId);

    return new Response(JSON.stringify({ success: true, result }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
