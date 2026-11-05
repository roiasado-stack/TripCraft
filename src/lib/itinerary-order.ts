/**
 * The one itinerary order: by day, then by time with untimed items first, then
 * by sort_order. It mirrors ItineraryTab's query (day_date, start_time nulls
 * first, sort_order), so every screen that sorts on the client agrees with it.
 *
 * Dates and times are compared as text on purpose: both are zero-padded, and a
 * trip's day must never go through `new Date()`.
 */

type Orderable = {
  day_date: string;
  start_time?: string | null;
  /** get_shared_trip doesn't return it, but its rows arrive in sort_order and the sort is stable. */
  sort_order?: number | null;
};

export function compareItineraryItems(a: Orderable, b: Orderable): number {
  if (a.day_date !== b.day_date) return a.day_date < b.day_date ? -1 : 1;
  const aTime = a.start_time || null;
  const bTime = b.start_time || null;
  if (aTime !== bTime) {
    if (aTime === null) return -1;
    if (bTime === null) return 1;
    return aTime < bTime ? -1 : 1;
  }
  return (a.sort_order ?? 0) - (b.sort_order ?? 0);
}

/** A sorted copy; ties keep the order they arrived in. */
export function sortItinerary<T extends Orderable>(items: readonly T[]): T[] {
  return [...items].sort(compareItineraryItems);
}
