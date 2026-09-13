import { useEffect, useState } from "react";
import type { ApplicationItem, ApplicationPatch } from "@/hooks/useApplications";
import {
  zonedTimeToUtc,
  utcToZonedLocal,
  formatInZone,
  listTimeZones,
  browserTimeZone,
} from "@/lib/timezone";
import { usePublicHolidays, findHolidayOnDate } from "@/hooks/usePublicHolidays";

const ZONES = listTimeZones();
const MY_ZONE = browserTimeZone();

/** Minor m22 — see lib/timezone.ts for the conversion approach and its limits. */
export function InterviewSchedulePanel({
  item,
  onPatch,
}: {
  item: ApplicationItem;
  onPatch: (patch: ApplicationPatch) => void;
}) {
  const [zone, setZone] = useState(item.interview_timezone ?? MY_ZONE);
  const [localValue, setLocalValue] = useState(
    item.interview_at ? utcToZonedLocal(new Date(item.interview_at), item.interview_timezone ?? MY_ZONE) : ""
  );

  useEffect(() => {
    setZone(item.interview_timezone ?? MY_ZONE);
    setLocalValue(
      item.interview_at ? utcToZonedLocal(new Date(item.interview_at), item.interview_timezone ?? MY_ZONE) : ""
    );
  }, [item.interview_at, item.interview_timezone]);

  function save(nextLocalValue: string, nextZone: string) {
    if (!nextLocalValue) {
      onPatch({ interview_at: null, interview_timezone: null });
      return;
    }
    const utc = zonedTimeToUtc(nextLocalValue, nextZone);
    onPatch({ interview_at: utc.toISOString(), interview_timezone: nextZone });
  }

  const utcInstant = item.interview_at ? new Date(item.interview_at) : null;

  // Company hq_country (from ingestion) is a real, stored ISO code —
  // unlike the freeform IANA zone above, it doesn't need guessing at.
  // Silently skipped when unknown, same "never present a guess" rule
  // as everywhere else in this app (see 0012/0025's own callouts).
  const countryCode = item.job.company?.hq_country ?? null;
  const dateOnly = localValue ? localValue.slice(0, 10) : null;
  const year = dateOnly ? Number(dateOnly.slice(0, 4)) : new Date().getFullYear();
  const { data: holidays } = usePublicHolidays(countryCode, year);
  const holiday = dateOnly ? findHolidayOnDate(holidays, dateOnly) : null;

  return (
    <section className="border-t border-rule pt-5">
      <h3 className="mb-2 text-sm font-semibold">Interview schedule</h3>
      <div className="flex flex-wrap gap-2">
        <input
          type="datetime-local"
          value={localValue}
          onChange={(e) => {
            setLocalValue(e.target.value);
            save(e.target.value, zone);
          }}
          className="rounded-app border border-rule bg-raised px-3 py-2 text-sm outline-none focus:border-ink"
        />
        <select
          value={zone}
          onChange={(e) => {
            setZone(e.target.value);
            save(localValue, e.target.value);
          }}
          className="rounded-app border border-rule bg-raised px-3 py-2 text-sm outline-none focus:border-ink"
        >
          {ZONES.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </div>
      {utcInstant && (
        <p className="mt-2 text-xs text-ink-70">
          {formatInZone(utcInstant, zone)} ({zone})
          {zone !== MY_ZONE && (
            <>
              {" "}
              — that's <strong>{formatInZone(utcInstant, MY_ZONE)}</strong> your time.
            </>
          )}
        </p>
      )}

      {holiday && (
        <p className="mt-2 rounded-app border border-ghost/30 bg-ghost-wash px-3 py-2 text-xs text-ghost">
          Heads up — {holiday.date} is <strong>{holiday.name}</strong> in {countryCode}, based on{" "}
          {item.job.company?.canonical_name ?? "this company"}'s HQ country. Their office may be
          closed that day.
        </p>
      )}
    </section>
  );
}
