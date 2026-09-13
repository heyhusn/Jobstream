// Public holiday awareness (roadmap minor m22 extension) — a thin
// CORS proxy for Nager.Date (date.nager.at), a free, keyless public
// holidays API verified live before this function was written (real
// 2026 US/DE holiday data pulled, ~110 countries covered). Nager.Date
// sends no Access-Control-Allow-Origin header of its own, so the
// browser can't call it directly — this function exists only to add
// CORS, nothing else. No `tasks` row, no service-role client, no
// TASK_DISPATCH_SECRET: like parse-search-query, this reads and
// writes nothing of ours, so there's no state to protect. Auth is
// the platform's default JWT verification (verify_jwt on) — enough
// to stop an anonymous stranger from burning this project's own
// quota against an upstream free API, nothing more.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const COUNTRY_CODE_RE = /^[A-Z]{2}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "POST only." }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "Not authenticated." }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const year = Number(body?.year);
  const countryCode = typeof body?.countryCode === "string" ? body.countryCode.toUpperCase() : "";

  if (!Number.isInteger(year) || year < 1975 || year > 2100) {
    return json({ error: "Invalid year." }, 400);
  }
  if (!COUNTRY_CODE_RE.test(countryCode)) {
    return json({ error: "Invalid ISO country code." }, 400);
  }

  const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`);
  // Nager.Date returns 404 for a country code it doesn't recognise at
  // all, and 204 (empty body) for a recognised country it just has no
  // holiday data for (confirmed live for PK, among others) — both are
  // an honest empty list, not an error, so the client renders "no
  // data" instead of "something broke."
  if (res.status === 404 || res.status === 204) {
    return json({ holidays: [] });
  }
  if (!res.ok) {
    return json({ error: `Nager.Date HTTP ${res.status}` }, 502);
  }

  const holidays = await res.json();
  return json({ holidays });
});
