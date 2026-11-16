/**
 * Booking context for AI generation: which days the traveller is actually at
 * the destination, where they sleep each night, and the flight times — so the
 * itinerary follows the trip's stays and flights instead of only its
 * destination. Pure (no Deno/Node imports): unit-tested from
 * src/lib/generate-bookings.test.ts.
 */

import { flightWallClock } from "../ask/prompt.ts";

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
  /** True instants (028 derives them from the locals and zones): ordering and gaps only. */
  depart_at: string | null;
  arrive_at: string | null;
  /** The ticket's wall clock at each airport (028): every day and time the prompt states. */
  depart_local?: string | null;
  arrive_local?: string | null;
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

/** A ticket time as a day and HH:MM: the row's local time when it has one, else the instant on the viewer's clock. */
function clock(local: string | null | undefined, instant: string | null, timeZone?: unknown): Clock | null {
  const s = flightWallClock(local, instant, timeZone);
  return s ? { day: s.slice(0, 10), time: s.slice(11, 16) } : null;
}

/** When the leg lands, or when it leaves if the landing time is missing. */
function landing(f: FlightRow, timeZone?: unknown): Clock | null {
  return f.arrive_at || f.arrive_local
    ? clock(f.arrive_local, f.arrive_at, timeZone)
    : clock(f.depart_local, f.depart_at, timeZone);
}

// A leg that leaves within this long of the previous leg's landing is a
// connection on the same journey; a later one is a flight inside the trip.
const CONNECTION_MS = 24 * 60 * 60 * 1000;

type Leg = { f: FlightRow; start: number; end: number };

function timeOf(v: string | null): number {
  return v ? new Date(v).getTime() : NaN;
}

function legsOf(flights: FlightRow[], inbound: boolean): Leg[] {
  return flights
    .filter((f) => (f.direction === "inbound") === inbound)
    .map((f) => {
      const start = timeOf(f.depart_at ?? f.arrive_at);
      const end = timeOf(f.arrive_at ?? f.depart_at);
      return { f, start, end };
    })
    .filter((l) => !isNaN(l.start) && !isNaN(l.end))
    .sort((a, b) => a.start - b.start);
}

/**
 * The flights to and from home: the first outbound leg plus every leg that
 * connects on from it, and the last inbound leg plus every leg that connects
 * into it. Anything else (a domestic flight, which the scan saves as
 * "outbound" since it doesn't land in Israel) is a move inside the trip.
 */
function homeLegs(flights: FlightRow[]): { outbound: Leg[]; inbound: Leg[] } {
  const out = legsOf(flights, false);
  const outbound = out.slice(0, 1);
  for (const l of out.slice(1)) {
    if (l.start - outbound[outbound.length - 1].end > CONNECTION_MS) break;
    outbound.push(l);
  }
  const back = legsOf(flights, true).reverse();
  const inbound = back.slice(0, 1);
  for (const l of back.slice(1)) {
    if (inbound[0].start - l.end > CONNECTION_MS) break;
    inbound.unshift(l);
  }
  return { outbound, inbound };
}

/**
 * Landing at the destination (the end of the journey from home, so a connection
 * counts but a later domestic flight doesn't) and take-off for home (the start
 * of the journey back), each on its own airport's clock as printed on the ticket
 * (rows without local times fall back to the viewer's clock).
 */
export function flightWindow(flights: FlightRow[], timeZone?: unknown): { arrival: Clock | null; departure: Clock | null } {
  const { outbound, inbound } = homeLegs(flights);
  const last = outbound[outbound.length - 1];
  const takeoff = inbound.find((l) => l.f.depart_at || l.f.depart_local)?.f;
  return {
    arrival: last ? landing(last.f, timeZone) : null,
    departure: takeoff ? clock(takeoff.depart_local, takeoff.depart_at, timeZone) : null,
  };
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
    const home = homeLegs(fl);
    const kind = (f: FlightRow) =>
      home.outbound.some((l) => l.f === f) ? "הלוך" : home.inbound.some((l) => l.f === f) ? "חזור" : "טיסת פנים";
    for (const f of [...fl].sort((a, b) => ((a.depart_at ?? "") < (b.depart_at ?? "") ? -1 : 1))) {
      const dep = flightWallClock(f.depart_local, f.depart_at, timeZone);
      const arr = flightWallClock(f.arrive_local, f.arrive_at, timeZone);
      lines.push(
        `- ${kind(f)}: ${f.from_airport ?? "?"} → ${f.to_airport ?? "?"}` +
          `${dep ? `, המראה ${dep}` : ""}${arr ? `, נחיתה ${arr}` : ""}`,
      );
    }
  }
  if (!lines.length) return "";

  const rules: string[] = [];
  if (staysText) rules.push("- כל יום מתוכנן בעיר של המלון שבו ישנים באותו לילה; ביום האחרון — העיר של הלילה הקודם.");
  const flightDays = flightDayRules(fl, days, timeZone);
  for (const m of moveDays(stays, days)) {
    // A move by plane gets the flight-day rule below instead of "a transport between the hotels".
    if (flightDays.has(m.day)) continue;
    rules.push(`- ${m.day} הוא יום מעבר מ-${stayLabel(m.from)} ל-${stayLabel(m.to)}: פריט transport לנסיעה ביניהן, ותוכנית קלה בלבד.`);
  }
  rules.push(...flightDays.values());
  const { arrival, departure } = flightWindow(fl, timeZone);
  if (arrival && days.includes(arrival.day)) {
    rules.push(`- ביום ההגעה (${arrival.day}) התחל רק אחרי הנחיתה ב-${arrival.time} והגעה למלון.`);
  }
  if (departure && days.includes(departure.day)) rules.push(departureDayRule(departure));
  return [...lines, ...rules].join("\n");
}

const hhmm = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const minutesOf = (time: string): number => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

/**
 * One rule per planned day that has flights inside the trip (domestic legs —
 * saved as "outbound" by the scan — not the flights to and from home), keyed
 * by day. Such a day came back with no items at all (the ABADA demo's 20.3,
 * DAD→DMK→CNX, local run 2026-11-16): the model read it as "all travel".
 * The rule asks for the transfer to the airport, the arrival and check-in
 * after the last landing, and an evening activity when the landing leaves time.
 */
export function flightDayRules(flights: FlightRow[], days: string[], timeZone?: unknown): Map<string, string> {
  const home = homeLegs(flights);
  const isHome = (f: FlightRow) => home.outbound.some((l) => l.f === f) || home.inbound.some((l) => l.f === f);
  const byDay = new Map<string, { from: string; to: string; dep: Clock; arr: Clock | null }[]>();
  for (const f of flights) {
    if (isHome(f)) continue;
    const dep = clock(f.depart_local, f.depart_at, timeZone);
    if (!dep || !days.includes(dep.day)) continue;
    const arr = f.arrive_at || f.arrive_local ? clock(f.arrive_local, f.arrive_at, timeZone) : null;
    byDay.set(dep.day, [...(byDay.get(dep.day) ?? []), { from: f.from_airport ?? "?", to: f.to_airport ?? "?", dep, arr }]);
  }
  const out = new Map<string, string>();
  for (const day of [...byDay.keys()].sort()) {
    const legs = byDay.get(day)!.sort((a, b) => (a.dep.time < b.dep.time ? -1 : 1));
    const first = legs[0];
    const last = legs[legs.length - 1];
    const legsText = legs.map((l) => `${l.from} → ${l.to} ${l.dep.time}${l.arr ? `–${l.arr.time}` : ""}`).join(", ");
    const airportBy = minutesOf(first.dep.time) - 120;
    const toAirport =
      airportBy >= 0
        ? `פריט transport של נסיעה לשדה התעופה שמגיעה לשדה עד ${hhmm(airportBy)} (שעתיים לפני ההמראה)`
        : "פריט transport של נסיעה לשדה התעופה";
    const landed = last.arr && last.arr.day === day ? last.arr.time : null;
    const arrival = landed ? `, פריט הגעה וצ'ק-אין במלון אחרי הנחיתה ב-${landed}` : "";
    const evening = landed && minutesOf(landed) <= 18 * 60 ? ", ואם נשאר זמן — פעילות ערב קלה ביעד" : "";
    out.set(
      day,
      `- ${day} הוא יום טיסות (${legsText}): ${toAirport}${arrival}${evening}. גם ליום הזה חייבים להיות פריטים — אל תשאיר אותו ריק.`,
    );
  }
  return out;
}

/**
 * The return day's prompt rule. The day used to come back nearly empty (only
 * "finish ~3h before"), so it now asks for what that morning really holds:
 * breakfast and check-out, then a transfer that reaches the airport 3 hours
 * before take-off (2 at the latest). An early flight leaves no time for
 * breakfast; one before 03:00 means leaving the evening before.
 */
export function departureDayRule(departure: Clock): string {
  const [h, m] = departure.time.split(":").map(Number);
  const takeoff = h * 60 + m;
  const airportBy = takeoff - 180;
  const latest = takeoff - 120;
  const head = `- ביום החזרה (${departure.day}) הטיסה ב-${departure.time}:`;
  const tail = "בלי שום פריט אחרי ההמראה ובלי ימים אחריה.";
  const transfer = (by: number, last: number) =>
    `פריט transport של נסיעה לשדה התעופה שמגיעה לשדה עד ${hhmm(by)} (3 שעות לפני ההמראה, ולכל המאוחר ${hhmm(last)}) — כתוב בתיאור שלו את שעת ההגעה לשדה`;
  if (airportBy < 0) {
    return `${head} אחרי חצות. את הצ'ק-אאוט והנסיעה לשדה תכנן בערב של ${addDays(departure.day, -1)}: ${transfer(airportBy + 1440, latest < 0 ? latest + 1440 : latest)}. ביום ${departure.day} עצמו אל תתכנן פריטים. ${tail}`;
  }
  if (airportBy < 8 * 60) {
    return `${head} טיסה מוקדמת — רק צ'ק-אאוט מהמלון ו${transfer(airportBy, latest)}. בלי ארוחת בוקר ובלי פעילויות. ${tail}`;
  }
  const extra = airportBy >= 12 * 60 ? " אם נשאר זמן לפני היציאה לשדה — פעילות קצרה וקרובה למלון בלבד." : "";
  return `${head} ארוחת בוקר וצ'ק-אאוט מהמלון, ואחריהם ${transfer(airportBy, latest)}.${extra} ${tail}`;
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
