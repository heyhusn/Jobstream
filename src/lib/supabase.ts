import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Fail loudly at boot rather than surfacing as a mysterious
  // network error the first time someone tries to sign in.
  throw new Error(
    "Missing Supabase env vars. Copy .env.example to .env.local and fill in " +
      "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from your Supabase project settings."
  );
}

export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

/**
 * `supabase.channel(topic)` reuses an existing channel object if one
 * with the same topic is still registered on the client, instead of
 * creating a new one (see realtime-js's `RealtimeClient.channel()`).
 * That's fine for a normal single mount, but React's dev-mode double
 * effect invocation (mount → cleanup → mount) can call this again
 * before the first channel's `removeChannel` cleanup has finished,
 * so `.channel()` hands back the already-`subscribe()`d instance and
 * the follow-up `.on(...)` throws "cannot add postgres_changes
 * callbacks ... after subscribe()" — an unhandled error with no
 * error boundary in this app to catch it, which blanks the whole
 * page. Removing any stale channel on the same topic first guarantees
 * a fresh, not-yet-subscribed instance every time.
 */
export function freshChannel(topic: string) {
  const realtimeTopic = `realtime:${topic}`;
  const stale = supabase.getChannels().find((c) => c.topic === realtimeTopic);
  if (stale) supabase.removeChannel(stale);
  return supabase.channel(topic);
}
