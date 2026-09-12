/**
 * Minor m22's timezone half. No dependency for this — modern
 * `Intl.DateTimeFormat` is enough to convert a wall-clock time in an
 * arbitrary IANA zone to a real UTC instant and back, which is all
 * "what's that interview time in my zone" needs. This is a
 * reasonably accurate conversion, not a calendar-grade one — DST
 * transition edge cases (the specific hour a clock skips or repeats)
 * aren't specially handled, which is an acceptable approximation for
 * a scheduling note, not a legally binding invite.
 */

/** Converts a `YYYY-MM-DDTHH:mm` wall-clock string, interpreted in `timeZone`, to a real UTC instant. */
export function zonedTimeToUtc(dateTimeLocal: string, timeZone: string): Date {
  const naiveUtc = new Date(`${dateTimeLocal}:00Z`);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(naiveUtc).map((p) => [p.type, p.value]));
  const hour = parts.hour === "24" ? "00" : parts.hour;
  const asIfZoneWereUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(hour),
    Number(parts.minute),
    Number(parts.second)
  );
  const offsetMs = asIfZoneWereUtc - naiveUtc.getTime();
  return new Date(naiveUtc.getTime() - offsetMs);
}

/** The inverse — a UTC instant's wall-clock date/time in `timeZone`, as `YYYY-MM-DDTHH:mm` for a datetime-local input. */
export function utcToZonedLocal(utc: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(utc).map((p) => [p.type, p.value]));
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}`;
}

export function formatInZone(utc: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(utc);
}

const FALLBACK_ZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
];

/** Full IANA list where the browser supports it, else a reasonable curated fallback. */
export function listTimeZones(): string[] {
  const supportedValuesOf = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
    .supportedValuesOf;
  try {
    if (supportedValuesOf) return supportedValuesOf("timeZone");
  } catch {
    // fall through
  }
  return FALLBACK_ZONES;
}

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
