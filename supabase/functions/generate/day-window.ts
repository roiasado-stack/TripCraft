/**
 * The optional `days: [from, to]` window of an itinerary request. A long trip
 * planned in one call ran past the Edge Function's 150s wall clock (an 18-day
 * agency trip: one model call of ~13k output tokens, 131-150s, nothing saved),
 * so the client asks for about 5 days per call. Day numbers count calendar days
 * from the trip's start_date (day 1). Pure (no Deno imports): unit-tested from
 * src/lib/generate-day-window.test.ts.
 */

import { addDays, dayRange } from "./bookings.ts";

/** Longest window one call may plan. The client sends ~5; a little slack, never a whole long trip. */
export const MAX_WINDOW_DAYS = 7;

export type DayWindow = [number, number];

/**
 * Validates the request's window against the trip's real dates (read from the
 * database, not the request): two integers, 1 <= from <= to <= trip length,
 * at most MAX_WINDOW_DAYS long. `undefined`/`null` means "the whole trip" (the
 * call made before windows existed). Anything else is rejected, so a crafted
 * window can't plan more than MAX_WINDOW_DAYS per capped call.
 */
export function parseDayWindow(
  raw: unknown,
  start: string | null,
  end: string | null,
): { ok: true; window: DayWindow | null } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, window: null };
  if (!Array.isArray(raw) || raw.length !== 2) return { ok: false };
  const [from, to] = raw;
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to)) return { ok: false };
  const length = dayRange(start, end).length;
  if (!length) return { ok: false };
  if (from < 1 || to > length || from > to || to - from + 1 > MAX_WINDOW_DAYS) return { ok: false };
  return { ok: true, window: [from, to] };
}

/** The window's calendar dates, inclusive ("YYYY-MM-DD"). */
export function windowRange(start: string, window: DayWindow): { first: string; last: string } {
  return { first: addDays(start, window[0] - 1), last: addDays(start, window[1] - 1) };
}

/** The days to plan, clipped to the window (all of them when there is none). */
export function clipToWindow(days: string[], start: string | null, window: DayWindow | null): string[] {
  if (!window || !start) return days;
  const { first, last } = windowRange(start, window);
  return days.filter((d) => d >= first && d <= last);
}
