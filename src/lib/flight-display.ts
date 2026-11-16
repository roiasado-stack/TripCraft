// How a flight row is shown (Design A, docs/plans/2026-11-16-flight-time-zones.md): the
// ticket's wall clock (`depart_local` / `arrive_local`) as a string, never through `Date`
// in the viewer's zone — a phone in Los Angeles shows LY84 landing "29.3 00:05" like one
// in Tel Aviv. Rows without locals (none should exist after migration 028) fall back to
// the old instant display.

import { flightMinutes, formatFlightClock, parseWallClock } from "../../supabase/functions/_shared/flight-time";
import type { Flight } from "./types";
import { formatDateTimeHeb, formatHeb, formatTimeHeb } from "./trip-options";
import { formatDateTimeEn } from "./share-english";

export type FlightTimes = Partial<
  Pick<Flight, "depart_at" | "arrive_at" | "depart_local" | "arrive_local" | "from_tz" | "to_tz">
>;

const pad = (n: number) => String(n).padStart(2, "0");

/** One end of the boarding-pass card: { time: "00:05", date: "29 במרץ 2026" }. Empty strings when unknown. */
export function flightEndHeb(local: string | null | undefined, instant: string | null | undefined): { time: string; date: string } {
  const w = parseWallClock(local);
  if (w) {
    return { time: `${pad(w.hour)}:${pad(w.minute)}`, date: formatHeb(`${w.year}-${pad(w.month)}-${pad(w.day)}`) };
  }
  return { time: formatTimeHeb(instant), date: formatHeb(instant) };
}

/** A ticket time on one line: he "29.3 00:05", en "29 Mar 00:05". "" when unknown. */
export function flightStamp(local: string | null | undefined, instant: string | null | undefined, lang: "he" | "en"): string {
  return formatFlightClock(local, lang) ?? (lang === "en" ? formatDateTimeEn : formatDateTimeHeb)(instant);
}

/**
 * Block time in minutes. From the ticket times and both airports' zones; null (hide it)
 * when only one zone is known, rather than a guess. A row with neither zone (every row
 * migration 028 backfilled, until the zone backfill runs) or without locals (pre-028)
 * uses the stored instants, as before — so durations don't vanish from existing trips.
 */
export function flightDurationMinutes(f: FlightTimes): number | null {
  const noZones = !f.from_tz && !f.to_tz;
  if ((f.depart_local || f.arrive_local) && !noZones) {
    return flightMinutes(f.depart_local, f.from_tz, f.arrive_local, f.to_tz);
  }
  if (!f.depart_at || !f.arrive_at) return null;
  const ms = new Date(f.arrive_at).getTime() - new Date(f.depart_at).getTime();
  return isFinite(ms) && ms > 0 ? Math.round(ms / 60000) : null;
}

/** 670 → "11ש 10ד", 45 → "45ד", null → null. */
export function durationHeb(minutes: number | null): string | null {
  if (minutes === null || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}ש${m ? ` ${m}ד` : ""}` : `${m}ד`;
}

/**
 * Whether a flight is still ahead of `now`. Uses the instant (`depart_at`, a true instant
 * when the zone is known); a flight with no time at all counts as ahead, as before.
 */
export function isUpcomingFlight(f: FlightTimes, now: Date): boolean {
  if (!f.depart_at) return true;
  return new Date(f.depart_at).getTime() >= now.getTime();
}
