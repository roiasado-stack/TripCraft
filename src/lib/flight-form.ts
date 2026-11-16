// How flight writers store a ticket (Design A, docs/plans/2026-11-16-flight-time-zones.md,
// sub-phase 5d): the wall clock as printed (`depart_local` / `arrive_local`) plus each
// airport's IANA zone. `depart_at` / `arrive_at` are never written by the client any more —
// the flights_local_times trigger (028) derives them from the locals and zones.
//
// Pure: the zone lookup is passed in (`loadZoneOf()` from the shared library), so the same
// functions run in tests with the real table and in the browser after the lazy chunk loads.

import { iataOf, instantToWall, parseWallClock, wallToInstant } from "../../supabase/functions/_shared/flight-time";
import type { Flight } from "./types";

export { loadZoneOf } from "../../supabase/functions/_shared/flight-time";

export type ZoneOf = (iata: string | null | undefined) => string | null;

/** The zone the trigger assumes when a row has none, and the one old instants were typed in. */
const FALLBACK_ZONE = "Asia/Jerusalem";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Any datetime a writer holds → the ticket's wall clock "YYYY-MM-DDTHH:MM", or null.
 * A wall-clock string (the scan's "2026-03-28T17:00:00", a datetime-local value) is kept
 * as written. A true instant ("…Z", "…+02:00": a cached older client or draft) is read in
 * Israel time — what the person who typed it saw, and what the trigger itself assumes.
 */
export function wallOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const w = parseWallClock(value);
  if (w) return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())) return null;
  return instantToWall(value, FALLBACK_ZONE);
}

/** The airport's zone from a free-text field ("Bangkok (BKK)", נתב"ג), or null when unsure. */
export function zoneOfAirport(text: string | null | undefined, zoneOf: ZoneOf): string | null {
  return zoneOf(iataOf(text));
}

/**
 * The time columns of a flight row, from a writer's airports and datetimes (scan, wizard,
 * documents tab, agency import). Each zone comes from its own airport; an unknown airport
 * leaves its zone null and the ticket time is still stored as printed.
 */
export function flightTimesRow(
  f: { from_airport?: string | null; to_airport?: string | null; depart_at?: string | null; arrive_at?: string | null },
  zoneOf: ZoneOf,
): { depart_local: string | null; arrive_local: string | null; from_tz: string | null; to_tz: string | null } {
  return {
    depart_local: wallOf(f.depart_at),
    arrive_local: wallOf(f.arrive_at),
    from_tz: zoneOfAirport(f.from_airport, zoneOf),
    to_tz: zoneOfAirport(f.to_airport, zoneOf),
  };
}

// ---- The transport tab's add/edit form ------------------------------------------------------

export const OTHER_AIRLINE = "__other__";
// A convenience shortlist, not a claim of who currently flies the route —
// routes to/from Israel shift with the news, so "אחר" always stays an option.
export const AIRLINES = [
  "אל על",
  "ישראייר",
  "ארקיע",
  "Wizz Air",
  "Ryanair",
  "easyJet",
  "Lufthansa",
  "Air France",
  "KLM",
  "British Airways",
  "SWISS",
  "Turkish Airlines",
  "Aegean Airlines",
  "LOT Polish Airlines",
  "Pegasus Airlines",
  "United Airlines",
  "Delta Air Lines",
  "American Airlines",
  "Emirates",
  "Etihad Airways",
  "flydubai",
  "Ethiopian Airlines",
  "Cyprus Airways",
];

const ISRAEL_AIRPORT = "TLV";

export type FlightFormDraft = {
  id?: string;
  direction: "outbound" | "inbound";
  airline: string;
  airlineOther: string;
  flight_number: string;
  from_airport: string;
  to_airport: string;
  depart_date: string; // YYYY-MM-DD
  depart_hour: string; // "00"–"23" or ""
  depart_minute: string;
  /** Used when both airports' zones are known: arrival = departure + duration. */
  duration_hours: string;
  duration_minutes: string;
  /** Used when a zone is unknown: the arrival as printed on the ticket. */
  arrive_date: string;
  arrive_hour: string;
  arrive_minute: string;
  baggage: string;
  notes: string;
};

export const blankFlightForm: FlightFormDraft = {
  direction: "outbound",
  airline: "",
  airlineOther: "",
  flight_number: "",
  from_airport: ISRAEL_AIRPORT,
  to_airport: "",
  depart_date: "",
  depart_hour: "",
  depart_minute: "",
  duration_hours: "",
  duration_minutes: "",
  arrive_date: "",
  arrive_hour: "",
  arrive_minute: "",
  baggage: "",
  notes: "",
};

/** The row the form edits (only the fields it reads). */
export type FlightFormRow = Pick<
  Flight,
  "id" | "direction" | "airline" | "flight_number" | "from_airport" | "to_airport" | "depart_at" | "arrive_at" | "baggage" | "notes"
> &
  Partial<Pick<Flight, "depart_local" | "arrive_local" | "from_tz" | "to_tz">>;

/** A row's ticket time; a row without locals (pre-028) falls back to its instant in Israel time. */
function rowWall(local: string | null | undefined, instant: string | null | undefined): string | null {
  return wallOf(local) ?? (instant ? instantToWall(instant, FALLBACK_ZONE) : null);
}

function splitWall(wall: string | null): { date: string; hour: string; minute: string } {
  const w = parseWallClock(wall);
  return w
    ? { date: `${w.year}-${pad(w.month)}-${pad(w.day)}`, hour: pad(w.hour), minute: pad(w.minute) }
    : { date: "", hour: "", minute: "" };
}

function joinWall(date: string, hour: string, minute: string): string | null {
  if (!date) return null;
  return wallOf(`${date}T${hour || "00"}:${minute || "00"}`);
}

/**
 * Each airport's zone for the form. The row's own zone wins while its airport text is
 * unchanged (the backfill may have set one the text alone can't tell); a changed airport,
 * or a row with no zone yet, is looked up. `zoneOf` null = the table hasn't loaded yet.
 */
export function formZones(
  d: Pick<FlightFormDraft, "from_airport" | "to_airport">,
  row: Pick<FlightFormRow, "from_airport" | "to_airport" | "from_tz" | "to_tz"> | null,
  zoneOf: ZoneOf | null,
): { from_tz: string | null; to_tz: string | null } {
  const pick = (text: string, rowText: string | null | undefined, rowZone: string | null | undefined) => {
    if (row && rowZone && text.trim() === (rowText ?? "").trim()) return rowZone;
    return zoneOf ? zoneOfAirport(text, zoneOf) : null;
  };
  return {
    from_tz: pick(d.from_airport, row?.from_airport, row?.from_tz),
    to_tz: pick(d.to_airport, row?.to_airport, row?.to_tz),
  };
}

/** Row → form. The duration is the real block time when both zones are known, else blank. */
export function flightToForm(f: FlightFormRow, zoneOf: ZoneOf | null): FlightFormDraft {
  const airline = f.airline ?? "";
  const knownAirline = AIRLINES.includes(airline);
  const dep = rowWall(f.depart_local, f.depart_at);
  const arr = rowWall(f.arrive_local, f.arrive_at);
  const base = {
    from_airport: f.from_airport ?? "",
    to_airport: f.to_airport ?? "",
  };
  const { from_tz, to_tz } = formZones(base, f, zoneOf);
  const depI = from_tz ? wallToInstant(dep, from_tz) : null;
  const arrI = to_tz ? wallToInstant(arr, to_tz) : null;
  const minutes = depI && arrI ? Math.round((arrI.getTime() - depI.getTime()) / 60_000) : NaN;
  const depParts = splitWall(dep);
  const arrParts = splitWall(arr);
  return {
    id: f.id,
    direction: f.direction === "inbound" ? "inbound" : "outbound",
    airline: knownAirline ? airline : airline ? OTHER_AIRLINE : "",
    airlineOther: knownAirline ? "" : airline,
    flight_number: f.flight_number ?? "",
    ...base,
    depart_date: depParts.date,
    depart_hour: depParts.hour,
    depart_minute: depParts.minute,
    duration_hours: minutes > 0 ? String(Math.floor(minutes / 60)) : "",
    duration_minutes: minutes > 0 ? pad(minutes % 60) : "",
    arrive_date: arrParts.date,
    arrive_hour: arrParts.hour,
    arrive_minute: arrParts.minute,
    baggage: f.baggage ?? "",
    notes: f.notes ?? "",
  };
}

/**
 * Switching הלוך/חזור on a new flight moves the prefilled TLV to the other side, as long
 * as the person hasn't typed over it. Airports already typed are never touched.
 */
export function withDirection(d: FlightFormDraft, direction: "outbound" | "inbound"): FlightFormDraft {
  if (d.id || d.direction === direction) return { ...d, direction };
  const swap =
    (direction === "inbound" && d.from_airport === ISRAEL_AIRPORT && !d.to_airport.trim()) ||
    (direction === "outbound" && d.to_airport === ISRAEL_AIRPORT && !d.from_airport.trim());
  return swap ? { ...d, direction, from_airport: d.to_airport, to_airport: d.from_airport } : { ...d, direction };
}

/** "duration": arrival from the duration (both zones known); "arrival": ask for the arrival time. */
export function arrivalMode(d: FlightFormDraft, zones: { from_tz: string | null; to_tz: string | null }): "duration" | "arrival" {
  if (!zones.from_tz || !zones.to_tz) return "arrival";
  // A known-zone row whose stored arrival gives no positive duration (a typo on the
  // ticket entry) keeps showing that arrival rather than silently dropping it.
  const noDuration = !d.duration_hours && !d.duration_minutes;
  return noDuration && d.arrive_date ? "arrival" : "duration";
}

/**
 * The arrival wall clock the form will save: departure + duration through both zones
 * (`instantToWall(wallToInstant(dep, fromTz) + dur, toTz)`), or the arrival typed directly.
 */
export function formArrival(d: FlightFormDraft, zones: { from_tz: string | null; to_tz: string | null }): string | null {
  if (arrivalMode(d, zones) === "arrival") return joinWall(d.arrive_date, d.arrive_hour, d.arrive_minute);
  const dep = joinWall(d.depart_date, d.depart_hour, d.depart_minute);
  if (!dep || (!d.duration_hours && !d.duration_minutes)) return null;
  const start = wallToInstant(dep, zones.from_tz);
  if (!start) return null;
  const minutes = (Number(d.duration_hours) || 0) * 60 + (Number(d.duration_minutes) || 0);
  return instantToWall(start.getTime() + minutes * 60_000, zones.to_tz);
}

/** "נחיתה 29.3 00:05 שעון TLV" — or null when there's nothing to preview. */
export function arrivalPreview(d: FlightFormDraft, zones: { from_tz: string | null; to_tz: string | null }): string | null {
  const arr = parseWallClock(formArrival(d, zones));
  if (!arr) return null;
  const where = iataOf(d.to_airport) ?? d.to_airport.trim();
  return `נחיתה ${arr.day}.${arr.month} ${pad(arr.hour)}:${pad(arr.minute)}${where ? ` שעון ${where}` : ""}`;
}

/** Keeps the row's own string when the minute is unchanged, so an untouched save writes it back byte for byte. */
function keepIfSame(next: string | null, original: string | null | undefined): string | null {
  if (original && next && wallOf(original) === next) return original;
  return next;
}

/**
 * Form → the columns to write. Never `depart_at` / `arrive_at`: the trigger derives them.
 * Opening a row and saving it unchanged writes back exactly the row's values.
 */
export function formToFlightRow(
  d: FlightFormDraft,
  row: FlightFormRow | null,
  zoneOf: ZoneOf | null,
): {
  direction: "outbound" | "inbound";
  airline: string | null;
  flight_number: string | null;
  from_airport: string | null;
  to_airport: string | null;
  depart_local: string | null;
  arrive_local: string | null;
  from_tz: string | null;
  to_tz: string | null;
  baggage: string | null;
  notes: string | null;
} {
  const zones = formZones(d, row, zoneOf);
  return {
    direction: d.direction,
    airline: (d.airline === OTHER_AIRLINE ? d.airlineOther : d.airline).trim() || null,
    flight_number: d.flight_number.trim() || null,
    from_airport: d.from_airport.trim() || null,
    to_airport: d.to_airport.trim() || null,
    depart_local: keepIfSame(joinWall(d.depart_date, d.depart_hour, d.depart_minute), row?.depart_local),
    arrive_local: keepIfSame(formArrival(d, zones), row?.arrive_local),
    from_tz: zones.from_tz,
    to_tz: zones.to_tz,
    baggage: d.baggage.trim() || null,
    notes: d.notes.trim() || null,
  };
}
