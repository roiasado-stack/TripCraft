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

type StayPlace = { hotel_name?: string | null; address?: string | null };

/**
 * What to search for to find a stay. A specific address is enough on its own:
 * adding the trip's destination to it can break the match, because on a
 * multi-city trip that text names several places ("קרקוב וורשה, פולין"). Only a
 * bare hotel name is scoped to the destination, since it could be anywhere.
 */
function stayPlace(stay: StayPlace, destination?: string | null): { place: string; near: string | null } {
  const name = (stay.hotel_name ?? "").trim();
  const address = (stay.address ?? "").trim();
  if (!address) return { place: name, near: destination ?? null };
  const repeatsName = name && address.toLowerCase().includes(name.toLowerCase());
  return { place: name && !repeatsName ? `${name}, ${address}` : address, near: null };
}

/** A stay on the map: explicit map_url wins, then the hotel and its address. */
export function stayMapUrl(stay: StayPlace & { map_url?: string | null }, destination?: string | null): string | null {
  const { place, near } = stayPlace(stay, destination);
  return resolveMapUrl(stay.map_url, place, near);
}

/** Turn-by-turn directions to a stay. */
export function stayDirectionsUrl(stay: StayPlace, destination?: string | null): string | null {
  const { place, near } = stayPlace(stay, destination);
  return directionsUrl(place, near);
}

/**
 * Where to find taxis / ride-hailing. Searches around the first real place the
 * trip knows, because a multi-city destination is no place at all: a stay's
 * address, then the arrival airport, then a stay's name, and only then the
 * destination text. Stays are taken in the order given (the earliest first).
 */
export function taxiSearchUrl(where: {
  stays?: readonly StayPlace[];
  arrivalAirport?: string | null;
  destination?: string | null;
}): string | null {
  const stays = where.stays ?? [];
  const address = stays.map((s) => (s.address ?? "").trim()).find(Boolean);
  const airport = (where.arrivalAirport ?? "").trim();
  const hotel = stays.map((s) => (s.hotel_name ?? "").trim()).find(Boolean);
  const destination = (where.destination ?? "").trim();
  const q = address
    ? `taxi near ${address}`
    : airport
      ? `taxi near ${airport} airport`
      : hotel
        ? `taxi near ${[hotel, destination].filter(Boolean).join(", ")}`
        : destination && `taxi ${destination}`;
  if (!q) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
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

/**
 * A tap-to-chat WhatsApp link for a guide/contact phone number. Accepts local
 * Israeli formats (05X-XXXXXXX, with or without spaces/dashes) and anything
 * already in international form — wa.me needs digits only, country code first.
 */
export function whatsappUrl(phone?: string | null): string | null {
  const digits = (phone ?? "").replace(/[^\d+]/g, "");
  if (!digits) return null;
  const withCountryCode = digits.startsWith("0") ? `972${digits.slice(1)}` : digits.replace(/^\+/, "");
  if (withCountryCode.length < 8) return null;
  return `https://wa.me/${withCountryCode}`;
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
