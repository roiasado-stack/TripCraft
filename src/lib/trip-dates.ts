// Date logic for trip screens. Trip dates are date-only strings ("2026-11-15")
// and mean the traveller's local calendar day, so they're parsed as local
// dates — `new Date("2026-11-15")` is UTC midnight and lands on the previous
// day anywhere west of Greenwich. `today` is a parameter so the rules are
// testable; callers pass `new Date()`.

/** "2026-11-15" → local midnight of that day; null for empty/invalid. */
export function parseLocalDate(value: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole calendar days from `today` to `date` (negative in the past). */
export function daysFrom(date: string | null | undefined, today: Date): number | null {
  const d = parseLocalDate(date);
  if (!d) return null;
  return Math.round((d.getTime() - startOfDay(today).getTime()) / 86400000);
}

export type TripPhase = "now" | "upcoming" | "past";

/** Which group a trip belongs in. A trip with no start date is still being planned → upcoming. */
export function tripPhase(
  trip: { start_date: string | null; end_date: string | null },
  today: Date,
): TripPhase {
  const toStart = daysFrom(trip.start_date, today);
  if (toStart === null || toStart > 0) return "upcoming";
  const toEnd = daysFrom(trip.end_date ?? trip.start_date, today) ?? toStart;
  return toEnd >= 0 ? "now" : "past";
}

/** 1 → "יום אחד", 2 → "יומיים", n → "n ימים". */
export function dayCount(n: number): string {
  if (n === 1) return "יום אחד";
  if (n === 2) return "יומיים";
  return `${n} ימים`;
}

/** Countdown to a future day: "היום", "מחר", "בעוד יומיים", "בעוד 12 ימים". */
export function countdownLabel(days: number): string {
  if (days <= 0) return "היום";
  if (days === 1) return "מחר";
  return `בעוד ${dayCount(days)}`;
}

/**
 * Compact Hebrew date range: "15–20 בנוב׳", "28 בנוב׳–3 בדצמ׳". The year shows
 * only when the range isn't entirely in the current year. "" without a start.
 */
export function dateRangeHeb(start: string | null | undefined, end: string | null | undefined, today: Date): string {
  const s = parseLocalDate(start);
  if (!s) return "";
  const e = parseLocalDate(end) ?? s;
  const year = today.getFullYear();
  const withYear = s.getFullYear() !== year || e.getFullYear() !== year;
  const fmt = new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
  return e.getTime() === s.getTime() ? fmt.format(s) : fmt.formatRange(s, e);
}
