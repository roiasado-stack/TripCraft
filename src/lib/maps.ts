/**
 * Link builders for places, transport and flights.
 *
 * Everything here produces a *search* or *official* URL rather than a stored
 * coordinate, so links keep working as venues move or close. Nothing is
 * fabricated: a query is only ever built from data the user (or the trip)
 * already contains.
 */

/** Google Maps search for a free-text place, optionally scoped to a city. */
export function mapsUrl(place?: string | null, near?: string | null): string | null {
  const q = [place, near].map((s) => (s ?? "").trim()).filter(Boolean).join(", ");
  if (!q) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** Turn-by-turn directions to a place. */
export function directionsUrl(place?: string | null, near?: string | null): string | null {
  const q = [place, near].map((s) => (s ?? "").trim()).filter(Boolean).join(", ");
  if (!q) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
}

/** IATA code (e.g. "TLV") → the airport on the map. */
export function airportMapUrl(code?: string | null): string | null {
  const c = (code ?? "").trim();
  if (!c) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c} airport`)}`;
}

/**
 * Live flight status. Uses Google's flight-status search, which resolves
 * airline + number without needing a paid API key.
 */
export function flightStatusUrl(airline?: string | null, number?: string | null): string | null {
  const n = (number ?? "").trim();
  if (!n) return null;
  const q = `${(airline ?? "").trim()} ${n} flight status`.trim();
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

/** Where to find taxis / ride-hailing at the destination. */
export function taxiSearchUrl(destination?: string | null): string | null {
  const d = (destination ?? "").trim();
  if (!d) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`taxi ${d}`)}`;
}

/** Car-rental desks, typically at the arrival airport. */
export function carRentalSearchUrl(place?: string | null): string | null {
  const p = (place ?? "").trim();
  if (!p) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`car rental ${p}`)}`;
}

/**
 * Kosher food near a place. Deliberately a live search rather than a stored
 * list — kosher venues and their certification change often, and a stale
 * hard-coded address is worse than no address.
 */
export function kosherSearchUrl(destination?: string | null): string | null {
  const d = (destination ?? "").trim();
  if (!d) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`kosher restaurant ${d}`)}`;
}

/** Chabad centres — the most reliable kosher/Jewish-services directory abroad. */
export function chabadSearchUrl(destination?: string | null): string | null {
  const d = (destination ?? "").trim();
  if (!d) return null;
  return `https://www.chabad.org/centers/default_cdo/jewish/directory.htm?searchQuery=${encodeURIComponent(d)}`;
}

/** Vegetarian / vegan options near a place. */
export function vegetarianSearchUrl(destination?: string | null): string | null {
  const d = (destination ?? "").trim();
  if (!d) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`vegetarian vegan restaurant ${d}`)}`;
}

/** Best-effort place link for a saved row: explicit map_url wins. */
export function resolveMapUrl(
  explicit: string | null | undefined,
  place: string | null | undefined,
  near?: string | null,
): string | null {
  const e = (explicit ?? "").trim();
  if (e) return e;
  return mapsUrl(place, near);
}

/** True for links we are willing to open in a new tab. */
export function isSafeHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
