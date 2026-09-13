import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface PublicHoliday {
  date: string; // YYYY-MM-DD
  localName: string;
  name: string;
}

/**
 * Calls the `public-holidays` Edge Function (a thin CORS proxy for the
 * free, keyless Nager.Date API — verified live before this was built,
 * see the function's own header comment). Keyed by country + year so
 * switching the interview timezone doesn't refetch the whole calendar
 * for a country already loaded this session; `staleTime` is generous
 * since a year's public holidays never change once published.
 */
export function usePublicHolidays(countryCode: string | null | undefined, year: number) {
  return useQuery({
    queryKey: ["public-holidays", countryCode, year],
    enabled: !!countryCode,
    staleTime: 24 * 60 * 60 * 1000,
    queryFn: async (): Promise<PublicHoliday[]> => {
      const { data, error } = await supabase.functions.invoke("public-holidays", {
        body: { countryCode, year },
      });
      if (error) throw error;
      return (data?.holidays ?? []) as PublicHoliday[];
    },
  });
}

/** The holiday landing on this exact calendar date, if any — `date` is a YYYY-MM-DD string in the zone being checked. */
export function findHolidayOnDate(holidays: PublicHoliday[] | undefined, date: string): PublicHoliday | null {
  return holidays?.find((h) => h.date === date) ?? null;
}
