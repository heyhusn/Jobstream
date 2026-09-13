// Currency Conversion (roadmap minor m16), closing the gap
// migration 0012 (Salary Intelligence) deliberately left open: "no
// currency conversion — no FX feed in this codebase." Frankfurter
// (api.frankfurter.app) is a free, keyless, ECB-backed exchange-rate
// API — verified live before this function was written (a real
// EUR->USD rate pulled 2026-09-13). It only covers ~29 major
// currencies (the ECB's own reference set); a currency this doesn't
// return just never gets a fx_rates row, and 0033's views leave its
// `_usd` columns null rather than guessing — same honesty posture as
// the rest of M09.
//
// Manual invocation only, same limitation as ingest-jobs and the
// ghost-signal recompute: no pg_cron in this Supabase-only build.
// Re-run periodically (daily is plenty for a nominal reference rate)
// until a scheduler exists.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-task-secret',
};

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

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  const res = await fetch('https://api.frankfurter.app/latest?base=USD');
  if (!res.ok) {
    return new Response(JSON.stringify({ error: `Frankfurter HTTP ${res.status}` }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const data = await res.json() as { date: string; base: string; rates: Record<string, number> };

  const rows = [
    { currency: 'USD', rate_per_usd: 1, as_of: data.date },
    ...Object.entries(data.rates).map(([currency, rate]) => ({
      currency,
      rate_per_usd: rate,
      as_of: data.date,
    })),
  ];

  const { error } = await supabase.from('fx_rates').upsert(rows, { onConflict: 'currency' });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ success: true, as_of: data.date, currencies: rows.length }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
