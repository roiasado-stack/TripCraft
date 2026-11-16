// "Duplicate as a new template": which parts of a trip are copied, and how its
// dates move. Pure, so the privacy rule is unit-tested rather than trusted.
//
// The rule (#47): a template carries the route and the hotels, never the previous
// client — no participants, flights, transfers, booking numbers, notes or
// per-person checklist items. Each table is copied by an ALLOW-list, so a column
// added later stays out of copies until someone decides it belongs in a template.

import { localDateString, parseLocalDate } from "@/lib/trip-dates";

type Row = Record<string, unknown>;

/** "2026-11-15" moved by `days` calendar days; null stays null, garbage becomes null. */
export function shiftDate(value: unknown, days: number): string | null {
  const d = parseLocalDate(typeof value === "string" ? value : null);
  if (!d) return null;
  if (days === 0) return localDateString(d);
  return localDateString(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
}

/** Days from the old start to the chosen new start; 0 when either is missing. */
export function dayShift(oldStart: string | null | undefined, newStart: string | null | undefined): number {
  const a = parseLocalDate(oldStart);
  const b = parseLocalDate(newStart);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function pick(row: Row, keys: readonly string[]): Row {
  const out: Row = {};
  for (const k of keys) if (k in row) out[k] = row[k];
  return out;
}

const TRIP_KEYS = ["destination", "trip_type", "budget_level", "cover_emoji"] as const;
const ITINERARY_KEYS = [
  "start_time", "title", "description", "category", "location", "sort_order",
  "image_url", "lat", "lng", "map_url", "google_place_id",
] as const;
const STAY_KEYS = ["hotel_name", "address", "phone", "url", "map_url"] as const;
const SUGGESTION_KEYS = [
  "kind", "title", "description", "tags", "age_min", "age_max", "price_level",
  "image_url", "lat", "lng", "location", "map_url", "google_place_id",
] as const;
const CHECKLIST_KEYS = ["title", "is_shared", "sort_order"] as const;

/** The new trip row (no notes, guide, sharing or author — those belong to the old trip). */
export function templateTrip(trip: Row, days: number): Row {
  return {
    ...pick(trip, TRIP_KEYS),
    title: `${String(trip.title ?? "")} (עותק)`,
    start_date: shiftDate(trip.start_date, days),
    end_date: shiftDate(trip.end_date, days),
  };
}

export function templateItinerary(rows: Row[], tripId: string, days: number): Row[] {
  return rows.map((r) => ({ ...pick(r, ITINERARY_KEYS), trip_id: tripId, day_date: shiftDate(r.day_date, days) }));
}

/** Hotel, address and contact stay; booking number and notes don't. */
export function templateStays(rows: Row[], tripId: string, days: number): Row[] {
  return rows.map((r) => ({
    ...pick(r, STAY_KEYS),
    trip_id: tripId,
    check_in: shiftDate(r.check_in, days),
    check_out: shiftDate(r.check_out, days),
  }));
}

export function templateSuggestions(rows: Row[], tripId: string): Row[] {
  return rows.map((r) => ({ ...pick(r, SUGGESTION_KEYS), trip_id: tripId }));
}

/** Only the group's items, unticked — an item tied to a person belongs to that person. */
export function templateChecklist(rows: Row[], tripId: string): Row[] {
  return rows
    .filter((r) => !r.participant_id)
    .map((r) => ({ ...pick(r, CHECKLIST_KEYS), trip_id: tripId, is_done: false }));
}
