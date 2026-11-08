/**
 * Booking context for AI generation: which days the traveller is actually at
 * the destination, where they sleep each night, and the flight times — so the
 * itinerary follows the trip's stays and flights instead of only its
 * destination. Pure (no Deno/Node imports): unit-tested from
 * src/lib/generate-bookings.test.ts.
 */

import { formatWallClock } from "../ask/prompt.ts";

export type StayRow = {
  hotel_name: string | null;
  address: string | null;
  check_in: string | null;
  check_out: string | null;
};

export type FlightRow = {
  direction: string | null;
  from_airport: string | null;
  to_airport: string | null;
  depart_at: string | null;
  arrive_at: string | null;
};

export type PartyMember = { age: number | null; age_range: string | null };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" + n calendar days, by string arithmetic on a UTC date (no zone drift). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** Every calendar day from start to end inclusive (empty for a bad or reversed range). */
export function dayRange(start: string | null, end: string | null): string[] {
  if (!start || !end || !DAY.test(start) || !DAY.test(end) || start > end) return [];
  const out: string[] = [];
  for (let d = start; d <= end && out.length < 366; d = addDays(d, 1)) out.push(d);
  return out;
}

type Clock = { day: string; time: string };

function clock(value: string | null, timeZone?: unknown): Clock | null {
  const s = formatWallClock(value, timeZone);
  return s ? { day: s.slice(0, 10), time: s.slice(11, 16) } : null;
}

/**
 * Landing at the destination (the last outbound leg's arrival, so a connection
 * counts) and take-off for home (the first inbound leg's departure), on the
 * clock the app shows them in.
 */
export function flightWindow(flights: FlightRow[], timeZone?: unknown): { arrival: Clock | null; departure: Clock | null } {
  const at = (v: string | null) => (v ? new Date(v).getTime() : NaN);
  let arrivalAt: string | null = null;
  let departureAt: string | null = null;
  for (const f of flights) {
    if (f.direction === "inbound") {
      if (f.depart_at && !isNaN(at(f.depart_at)) && (!departureAt || at(f.depart_at) < at(departureAt))) departureAt = f.depart_at;
    } else {
      const v = f.arrive_at ?? f.depart_at;
      if (v && !isNaN(at(v)) && (!arrivalAt || at(v) > at(arrivalAt))) arrivalAt = v;
    }
  }
  return { arrival: clock(arrivalAt, timeZone), departure: clock(departureAt, timeZone) };
}

/**
 * The days to plan: start_date..end_date, clipped to the landing day and the
 * return take-off day when those flights exist. Falls back to the plain range
 * when the flights contradict the dates (a clip that would leave nothing).
 */
export function tripDays(start: string | null, end: string | null, flights: FlightRow[], timeZone?: unknown): string[] {
  const { arrival, departure } = flightWindow(flights, timeZone);
  const from = start ?? arrival?.day ?? null;
  const to = end ?? departure?.day ?? null;
  const base = dayRange(from, to);
  if (!base.length) return base;
  const clipped = base.filter((d) => (!arrival || d >= arrival.day) && (!departure || d <= departure.day));
  return clipped.length ? clipped : base;
}

const KID_RANGES = new Set(["0-3", "4-8", "9-12", "13-17"]);

/** "kids" when anyone is under 18, "adults" when everyone is known to be 18+ (or it's a couple trip), else null. */
export function partyKind(participants: PartyMember[], tripType: string | null): "kids" | "adults" | null {
  const isKid = (p: PartyMember) => (p.age != null ? p.age < 18 : p.age_range != null && KID_RANGES.has(p.age_range));
  const isAdult = (p: PartyMember) => (p.age != null ? p.age >= 18 : p.age_range != null && !KID_RANGES.has(p.age_range));
  if (participants.some(isKid)) return "kids";
  if (tripType === "couple" || (participants.length > 0 && participants.every(isAdult))) return "adults";
  return null;
}

/** One prompt line on who is travelling; empty when it can't be told. */
export function partyLine(participants: PartyMember[], tripType: string | null): string {
  const kind = partyKind(participants, tripType);
  if (kind === "adults") return "הרכב: מבוגרים בלבד, אין ילדים. אל תציע תוכן שמיועד לילדים (גן חיות, פארק מים, מגרשי משחקים, עגלות וכו׳).";
  if (kind === "kids") return "הרכב: יש ילדים — התאם לגילאים שלהם.";
  return "";
}

function stayLabel(s: StayRow): string {
  return `${s.hotel_name ?? "מלון"}${s.address ? ` (${s.address})` : ""}`;
}

/** The stay whose night covers `day` (check_in <= day < check_out). */
function stayFor(stays: StayRow[], day: string): StayRow | undefined {
  return stays.find((s) => s.check_in && s.check_out && s.check_in <= day && day < s.check_out);
}

/** Days on which one stay ends and a different one begins — travel between places. */
export function moveDays(stays: StayRow[], days: string[]): { day: string; from: StayRow; to: StayRow }[] {
  const out: { day: string; from: StayRow; to: StayRow }[] = [];
  for (const day of days) {
    const from = stayFor(stays, addDays(day, -1));
    const to = stayFor(stays, day);
    if (from && to && from !== to && (from.address ?? from.hotel_name) !== (to.address ?? to.hotel_name)) out.push({ day, from, to });
  }
  return out;
}

/** Stays as a short list for the prompt, in check-in order. */
export function staysLines(stays: StayRow[]): string {
  return [...stays]
    .filter((s) => s.hotel_name || s.address)
    .sort((a, b) => ((a.check_in ?? "") < (b.check_in ?? "") ? -1 : 1))
    .map((s) => `- ${stayLabel(s)}: צ'ק-אין ${s.check_in ?? "?"}, צ'ק-אאוט ${s.check_out ?? "?"}`)
    .join("\n");
}

/**
 * The itinerary's booking block: stays, flights, and the rules they imply
 * (plan each day where the traveller sleeps, a light move day, start after
 * landing, end ~3h before the flight home). Empty when there are no bookings.
 */
export function itineraryBookingLines(stays: StayRow[], flights: FlightRow[], days: string[], timeZone?: unknown): string {
  const lines: string[] = [];
  const staysText = staysLines(stays);
  if (staysText) {
    lines.push("לינה (הזמנות):", staysText);
  }
  const fl = flights.filter((f) => f.depart_at || f.arrive_at);
  if (fl.length) {
    lines.push("טיסות (שעון מקומי):");
    for (const f of [...fl].sort((a, b) => ((a.depart_at ?? "") < (b.depart_at ?? "") ? -1 : 1))) {
      const dep = formatWallClock(f.depart_at, timeZone);
      const arr = formatWallClock(f.arrive_at, timeZone);
      lines.push(
        `- ${f.direction === "inbound" ? "חזור" : "הלוך"}: ${f.from_airport ?? "?"} → ${f.to_airport ?? "?"}` +
          `${dep ? `, המראה ${dep}` : ""}${arr ? `, נחיתה ${arr}` : ""}`,
      );
    }
  }
  if (!lines.length) return "";

  const rules: string[] = [];
  if (staysText) rules.push("- כל יום מתוכנן בעיר של המלון שבו ישנים באותו לילה; ביום האחרון — העיר של הלילה הקודם.");
  for (const m of moveDays(stays, days)) {
    rules.push(`- ${m.day} הוא יום מעבר מ-${stayLabel(m.from)} ל-${stayLabel(m.to)}: פריט transport לנסיעה ביניהן, ותוכנית קלה בלבד.`);
  }
  const { arrival, departure } = flightWindow(fl, timeZone);
  if (arrival && days.includes(arrival.day)) {
    rules.push(`- ביום ההגעה (${arrival.day}) התחל רק אחרי הנחיתה ב-${arrival.time} והגעה למלון.`);
  }
  if (departure && days.includes(departure.day)) {
    rules.push(
      `- ביום החזרה (${departure.day}) הטיסה ב-${departure.time}: סיים כ-3 שעות לפני (נסיעה לשדה), בלי שום פריט אחרי ההמראה ובלי ימים אחריה.`,
    );
  }
  return [...lines, ...rules].join("\n");
}

/**
 * Generated itinerary rows that fall outside the trip: a day not in `days`,
 * a time before landing on the arrival day, or at/after take-off on the return day.
 */
export function outsideTrip(
  row: { day_date: string; start_time: string | null },
  days: string[],
  window: { arrival: Clock | null; departure: Clock | null },
): boolean {
  if (days.length && !days.includes(row.day_date)) return true;
  const t = row.start_time ? row.start_time.slice(0, 5) : null;
  if (!t) return false;
  if (window.arrival && row.day_date === window.arrival.day && t < window.arrival.time) return true;
  if (window.departure && row.day_date === window.departure.day && t >= window.departure.time) return true;
  return false;
}

/**
 * A scanned ticket often prints the terminal inside the airport line
 * ("Hangzhou (HGH) Terminal 3", "Tel Aviv TLV T3", "Abu Dhabi (AUH) - Terminal A").
 * Pulls it out into its own field so the card can show "טרמינל 3", and leaves
 * the airport name without it. A terminal the model already returned wins.
 */
export function splitAirportTerminal(
  airport: string | null,
  terminal: string | null,
): { airport: string | null; terminal: string | null } {
  if (!airport) return { airport, terminal };
  // "Terminal 3" / "Terminal A" / "טרמינל 1", or the short "T3" (digits only, so "T" alone never matches).
  const m =
    airport.match(/[\s,\-–]*\(?\s*(?:terminal|טרמינל)\s+([0-9]{1,2}[A-Za-z]?|[A-Za-z])\s*\)?\s*$/i) ??
    airport.match(/[\s,\-–]*\(?\s*\bT([0-9]{1,2}[A-Za-z]?)\s*\)?\s*$/);
  if (!m || m.index === undefined || m.index === 0) return { airport, terminal };
  let rest = airport.slice(0, m.index).replace(/[\s,\-–]+$/, "").trim();
  // "Shanghai (PVG, Terminal 2)" → close the bracket the terminal sat in.
  if ((rest.match(/\(/g) ?? []).length > (rest.match(/\)/g) ?? []).length) rest += ")";
  return { airport: rest || airport, terminal: terminal || m[1].toUpperCase() };
}
