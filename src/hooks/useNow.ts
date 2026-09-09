import { useEffect, useState } from "react";

/**
 * A clock the render can read. "Overdue" is the one thing on this
 * board that changes without anyone touching it, so reading
 * `Date.now()` inline would leave a tab open overnight showing
 * yesterday's answer — and it makes render impure besides.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, intervalMs);
    // A laptop that was asleep comes back with a stale clock.
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [intervalMs]);

  return now;
}
