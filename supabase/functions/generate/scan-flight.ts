// One scanned flight segment, cleaned up (the `voucher` kind of generate).
//
// Times stay the ticket's wall clock at each airport ("2026-03-28T17:00:00", no offset):
// the client stores them as `depart_local` / `arrive_local` with each airport's zone
// (Design A, docs/plans/2026-11-16-flight-time-zones.md). An offset or "Z" the model adds
// anyway is dropped, never applied — the printed time is the truth.
//
// The model also returns `from_iata` / `to_iata`. When the airport text carries no code of
// its own ("Bangkok"), the code is appended ("Bangkok (BKK)") so every writer can find the
// airport's zone from the text alone. Pure: unit-tested from src/lib.

import { splitAirportTerminal } from "./bookings.ts";
import { iataOf } from "../_shared/flight-time.ts";

const str = (v: unknown, max = 300): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
};

/** "YYYY-MM-DDTHH:MM…" → "YYYY-MM-DDTHH:MM:00", the wall clock as printed; null otherwise. */
export function scanWallClock(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s) ? `${s.slice(0, 10)}T${s.slice(11, 16)}:00` : null;
}

/** A three-letter airport code the model gave, upper-cased; null for anything else. */
function codeOf(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return /^[A-Z]{3}$/.test(s) ? s : null;
}

/** The airport text, with the model's code appended when the text has none of its own. */
function withCode(airport: string | null, code: string | null): string | null {
  if (!code) return airport;
  if (!airport) return code;
  if (iataOf(airport)) return airport;
  return `${airport} (${code})`.slice(0, 90);
}

export function sanitizeScannedFlight(raw: Record<string, unknown>) {
  // Airport names were capped at 10 characters, which cut "Hangzhou (HGH)
  // Terminal 3" to "Hangzhou (" and lost the terminal with it.
  const from = splitAirportTerminal(str(raw.from_airport, 80), str(raw.from_terminal, 20));
  const to = splitAirportTerminal(str(raw.to_airport, 80), str(raw.to_terminal, 20));
  return {
    direction: raw.direction === "inbound" ? "inbound" : "outbound",
    airline: str(raw.airline, 120),
    flight_number: str(raw.flight_number, 20),
    from_airport: withCode(from.airport, codeOf(raw.from_iata)),
    to_airport: withCode(to.airport, codeOf(raw.to_iata)),
    depart_at: scanWallClock(raw.depart_at),
    arrive_at: scanWallClock(raw.arrive_at),
    from_terminal: from.terminal,
    to_terminal: to.terminal,
    seats: str(raw.seats, 60),
    baggage: str(raw.baggage, 120),
    booking_ref: str(raw.booking_ref, 60),
    notes: str(raw.notes, 500),
  };
}
