// Flight times as printed on the ticket (Design A, docs/plans/2026-11-16-flight-time-zones.md).
//
// A ticket says "TLV 22:40 → BKK 14:50": each time is the wall clock of its own airport.
// The truth we keep is that wall-clock string ("2026-03-28T22:40") plus the airport's IANA
// zone. Converting to an instant (for durations and ordering) goes through Intl offsets, and
// displaying never goes through `Date` in the viewer's zone — so a phone set to Los Angeles
// shows the same "29.3 00:05" as one in Tel Aviv.
//
// Pure: no I/O, no globals beyond Intl. Shared by the web client (Vite/tsc) and the Edge
// Functions (Deno), hence the `.ts` extension in relative imports.

/** A parsed wall-clock time ("YYYY-MM-DDTHH:MM[:SS]", no offset). Minute precision. */
export interface WallClock {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
}

const WALL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

/**
 * Parses a wall-clock string. Rejects anything carrying an offset or "Z" — that is an
 * instant, not a ticket time — and impossible dates (31.4, 25:00). Seconds are dropped.
 */
export function parseWallClock(localIso: unknown): WallClock | null {
  if (typeof localIso !== "string") return null;
  const m = WALL.exec(localIso.trim());
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1, 6).map(Number);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || (m[6] !== undefined && Number(m[6]) > 59)) return null;
  const probe = new Date(Date.UTC(2000, month - 1, day));
  if (day < 1 || probe.getUTCMonth() !== month - 1) return null;
  if (month === 2 && day === 29 && !(year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0))) return null;
  return { year, month, day, hour, minute };
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

function wallString(w: WallClock): string {
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/** The wall clock read as if it were UTC, in ms — the arithmetic base for offsets. */
function wallAsUtcMs(w: WallClock): number {
  const d = new Date(Date.UTC(2000, w.month - 1, w.day, w.hour, w.minute));
  d.setUTCFullYear(w.year); // Date.UTC maps years 0–99 to 1900s
  return d.getTime();
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat | null {
  let f = formatters.get(zone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hourCycle: "h23",
        year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
      });
    } catch {
      return null; // not a zone this runtime knows
    }
    formatters.set(zone, f);
  }
  return f;
}

/** True when the runtime knows this IANA zone name. */
export function isValidZone(zone: unknown): zone is string {
  return typeof zone === "string" && zone.length > 0 && formatterFor(zone) !== null;
}

function wallAt(ms: number, f: Intl.DateTimeFormat): WallClock {
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(ms))) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return { year: p.year, month: p.month, day: p.day, hour: p.hour % 24, minute: p.minute };
}

/** The zone's UTC offset at an instant, in ms (Bangkok: +7h). Whole minutes only. */
function offsetMs(ms: number, f: Intl.DateTimeFormat): number {
  const floored = Math.floor(ms / 60_000) * 60_000;
  return wallAsUtcMs(wallAt(floored, f)) - floored;
}

const DAY_MS = 86_400_000;

/**
 * The instant at which `zone`'s clocks show `localIso`, or null for bad input.
 *
 * DST rule (the same as Temporal's "compatible" disambiguation and as JS `Date` itself):
 * - a time that doesn't exist (spring forward, e.g. Israel 27.3.2026 02:30) is moved forward
 *   by the length of the gap — 02:30 becomes 03:30 IDT;
 * - a time that happens twice (fall back, e.g. Israel 25.10.2026 01:30) is the FIRST of the
 *   two, i.e. still on summer time.
 * Flights are rarely scheduled inside these hours; the rule only has to be deterministic.
 */
export function wallToInstant(localIso: unknown, zone: unknown): Date | null {
  const w = parseWallClock(localIso);
  if (!w || typeof zone !== "string") return null;
  const f = formatterFor(zone);
  if (!f) return null;
  const wall = wallAsUtcMs(w);
  // Offsets a day either side: no zone changes its offset twice within 48 hours.
  const before = offsetMs(wall - DAY_MS, f);
  const after = offsetMs(wall + DAY_MS, f);
  const fits = [wall - before, wall - after].filter((t) => t + offsetMs(t, f) === wall);
  if (fits.length) return new Date(Math.min(...fits));
  // In the gap: keep the pre-transition offset, which lands the same distance past the jump.
  return new Date(wall - before);
}

/** The wall clock ("YYYY-MM-DDTHH:MM") `zone` shows at `instant`, or null for bad input. */
export function instantToWall(instant: Date | string | number, zone: unknown): string | null {
  if (typeof zone !== "string") return null;
  const f = formatterFor(zone);
  const ms = instant instanceof Date ? instant.getTime() : typeof instant === "number" ? instant : Date.parse(instant);
  if (!f || !Number.isFinite(ms)) return null;
  return wallString(wallAt(Math.floor(ms / 60_000) * 60_000, f));
}

const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Formats a ticket time exactly as printed, never through the viewer's zone.
 * he → "29.3 00:05"; en → "29 Mar 00:05". Null when the string isn't a wall-clock time.
 */
export function formatFlightClock(localIso: unknown, lang: "he" | "en"): string | null {
  const w = parseWallClock(localIso);
  if (!w) return null;
  const clock = `${pad(w.hour)}:${pad(w.minute)}`;
  return lang === "en" ? `${w.day} ${EN_MONTHS[w.month - 1]} ${clock}` : `${w.day}.${w.month} ${clock}`;
}

/**
 * Block time in minutes between two ticket times in their own zones. Null when either time
 * or zone is missing/invalid, or when the result isn't positive (a typo, not a flight) —
 * callers then hide the duration instead of showing a wrong one.
 */
export function flightMinutes(
  departLocal: unknown,
  fromZone: unknown,
  arriveLocal: unknown,
  toZone: unknown,
): number | null {
  const dep = wallToInstant(departLocal, fromZone);
  const arr = wallToInstant(arriveLocal, toZone);
  if (!dep || !arr) return null;
  const minutes = Math.round((arr.getTime() - dep.getTime()) / 60_000);
  return minutes > 0 ? minutes : null;
}

// Words the scan and agents write that look like codes but aren't airports (USA is a real
// IATA code — Concord, NC — which is exactly why a country suffix must not be read as one).
const NOT_AIRPORTS = new Set([
  "USA", "UAE", "GBR", "ISR", "THA", "VNM", "ITA", "FRA", "ESP", "DEU", "GRC", "TUR", "CHN", "JPN", "IND",
  "INT", "AIR", "NEW", "THE", "AND", "VIA",
]);

// Names the scan writes for Ben Gurion instead of a code. Explicit on purpose: city names
// alone ("Bangkok") are never guessed — Bangkok has two airports.
const ALIASES: [RegExp, string][] = [
  [/נתב["'״׳]?ג/, "TLV"],
  [/בן[\s-]*גוריון/, "TLV"],
  [/ben[\s-]*gurion/i, "TLV"],
];

/**
 * The IATA code in a free-text airport field, or null when unsure.
 * "BKK", "bkk", "Bangkok (BKK)", "Tel Aviv TLV", "TLV - Tel Aviv", נתב"ג, "בן גוריון" → a code.
 * "Bangkok", "New York, USA", "Paris CDG or ORY" → null.
 */
export function iataOf(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const t = text.trim();
  if (!t) return null;
  // Just a code, any case.
  if (/^[A-Za-z]{3}$/.test(t)) return NOT_AIRPORTS.has(t.toUpperCase()) ? null : t.toUpperCase();
  // A code in brackets wins: "Hangzhou (HGH)".
  const bracketed = [...t.matchAll(/[([]\s*([A-Za-z]{3})\s*[)\]]/g)].map((m) => m[1].toUpperCase());
  if (bracketed.length === 1) return bracketed[0];
  if (bracketed.length > 1) return null;
  // Exactly one standalone upper-case three-letter word: "Tel Aviv TLV", "BKK – Bangkok".
  const words = [...t.matchAll(/(?<![\p{L}\p{N}])([A-Z]{3})(?![\p{L}\p{N}])/gu)]
    .map((m) => m[1])
    .filter((w) => !NOT_AIRPORTS.has(w));
  const unique = [...new Set(words)];
  if (unique.length === 1) return unique[0];
  if (unique.length > 1) return null;
  for (const [re, code] of ALIASES) if (re.test(t)) return code;
  return null;
}

/**
 * Loads the airport → zone table on demand (its own chunk in the web build, ~13 KB gzipped).
 * Usage: `const zoneOf = await loadZoneOf(); zoneOf(iataOf(flight.to_airport))`.
 */
export function loadZoneOf(): Promise<(iata: string | null | undefined) => string | null> {
  return import("./airport-zones.ts").then((m) => m.zoneOf);
}
