/**
 * Worldwide kosher layer for the `ask` Edge Function (approvals #16 + #18,
 * business/product/kosher-architecture.md). Three sources, three trust tiers:
 *
 *   verified    the hand-curated knowledge_chunks (3 destinations), each with
 *               a source and a date — but only while that date is under six
 *               months old; after that the same item drops to "unverified".
 *   unverified  places tagged kosher on OpenStreetMap (Overpass) or found by a
 *               Google Places "kosher" search. A map tag or a business name is
 *               not a hechsher, so these are never presented as kosher.
 *   none        nothing found — said explicitly, with live search links.
 *
 * Shabbat / yom tov times come from Hebcal (CC BY 4.0) for the trip's dates at
 * the destination's coordinates. They are a calculation, never "verified".
 *
 * Only coordinates (plus the trip dates, for Hebcal) leave our servers — never
 * a name, user id or trip id. OSM, Nominatim and Hebcal answers are cached in
 * kosher_cache (migration 020); Google answers never are (Google's terms).
 *
 * Plain fetch + Intl only, no Deno APIs: the database and the Google key are
 * passed in, so this stays testable outside the Edge runtime.
 */

export type Tier = "verified" | "unverified" | "none";

export const TIER_LABEL: Record<Tier, string> = {
  verified: "מאומת",
  unverified: "נמצא במפה — לא מאומת, יש לוודא השגחה",
  none: "אין מידע",
};

/** Curated items older than this drop from "verified" to "unverified". */
const VERIFIED_MAX_AGE_DAYS = 183;

const USER_AGENT = "TripCraft/1.0 (kosher lookup; https://tripcraft-lac.vercel.app)";
// The main public Overpass server answers 504 when busy; the second (VK's
// public instance, listed on the OSM wiki) is tried only when the first fails.
const OVERPASS_URLS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const HEBCAL_URL = "https://www.hebcal.com/hebcal";
const GOOGLE_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

const DAY_MS = 86_400_000;
const TTL = {
  geocode: 90 * DAY_MS,
  geocodeMiss: 3 * DAY_MS,
  osm: 14 * DAY_MS,
  osmEmpty: 3 * DAY_MS,
  hebcal: 30 * DAY_MS,
};

/** A country or region is too vague to search around its centre — the caller
 *  asks for a city instead. Nominatim's addresstype says which it is; the span
 *  is a backstop for anything else that big (a city's own box, e.g. Rome's
 *  municipality, can be ~70 km across). */
const WIDE_ADDRESS_TYPES = ["country", "state", "region", "province", "county", "state_district", "continent", "archipelago"];
const MAX_SEARCHABLE_SPAN_KM = 150;
/** Results further than this from the centre are dropped (Google's location
 *  bias is a preference, not a filter). */
const MAX_RESULT_DISTANCE_KM = 25;
const MAX_PLACES = 20;
/** Hebcal is asked for the trip's dates only, and never more than this. */
const MAX_TRIP_DAYS = 60;

// deno-lint-ignore no-explicit-any
type Db = any;

/* ------------------------------------------------------------------ types */

export type GeoPoint = {
  lat: number;
  lng: number;
  /** What Nominatim matched, e.g. "Milano, Lombardia, Italia". */
  label: string;
  /** Bounding-box diagonal, km. */
  span_km: number;
  /** Nominatim's addresstype: "city", "country", "state"… */
  kind: string;
};

export type KosherPlace = {
  tier: Exclude<Tier, "none">;
  name: string;
  kind: "restaurant" | "shop" | "synagogue" | "other";
  address: string | null;
  lat: number;
  lng: number;
  distance_km: number;
  source: "osm" | "google";
  /** Hebrew, shown verbatim: where this came from. */
  source_label: string;
  source_url: string;
  /** OSM check_date, when a mapper recorded one. */
  checked_on: string | null;
  maps_url: string;
  /** "only" = the map says fully kosher; "yes" = has kosher options. */
  osm_diet: "yes" | "only" | null;
};

export type CuratedItem = {
  tier: Exclude<Tier, "none">;
  title: string;
  content: string;
  category: string;
  source_url: string;
  source_verified_on: string;
  label: string;
};

export type ShabbatDay = {
  date: string;
  /** Local time "HH:MM" at the destination. */
  candles: string | null;
  havdalah: string | null;
  /** Hebrew name of a yom tov falling on this date. */
  holiday: string | null;
  /** Shabbat or yom tov (work-restricted until havdalah). */
  restricted: boolean;
};

export type ShabbatInfo = {
  tzid: string | null;
  days: ShabbatDay[];
  source_label: string;
  source_url: string;
};

/* ---------------------------------------------------------------- helpers */

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const round = (n: number, digits: number) => Number(n.toFixed(digits));

function formatMonthYear(isoDate: string): string {
  const [y, m] = isoDate.split("-");
  return `${m}/${y}`;
}

function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

async function cacheGet(db: Db | null, key: string): Promise<unknown | undefined> {
  if (!db) return undefined;
  try {
    const { data } = await db
      .from("kosher_cache")
      .select("payload, expires_at")
      .eq("cache_key", key)
      .maybeSingle();
    if (!data || new Date(data.expires_at).getTime() < Date.now()) return undefined;
    return data.payload;
  } catch {
    return undefined;
  }
}

async function cachePut(db: Db | null, key: string, source: string, payload: unknown, ttlMs: number) {
  if (!db) return;
  try {
    // Awaited on purpose: an un-awaited write can be cut off when the function returns.
    await db.from("kosher_cache").upsert({
      cache_key: key,
      source,
      payload,
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + ttlMs).toISOString(),
    });
  } catch {
    // A failed cache write only costs a repeat lookup next time.
  }
}

/* --------------------------------------------------------------- geocode */

const geoKey = (q: string) => "geo:" + q.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200);

async function nominatim(query: string): Promise<GeoPoint | null> {
  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=jsonv2&limit=1`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  const hit = (await res.json())?.[0];
  const lat = Number(hit?.lat);
  const lng = Number(hit?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const bb = (hit.boundingbox ?? []).map(Number);
  const span = bb.length === 4 && bb.every(Number.isFinite) ? haversineKm(bb[0], bb[2], bb[1], bb[3]) : 0;
  return { lat, lng, label: String(hit.display_name ?? query), span_km: round(span, 1), kind: String(hit.addresstype ?? "") };
}

/**
 * Google Places Text Search as a geocoder — the fallback when Nominatim fails
 * (its public server refuses some cloud IP ranges, which is what happened in
 * production on 2026-10-05). The viewport gives the span and the types say
 * country/region vs city. Never cached: Google's terms limit stored
 * coordinates, so each use is a live, budget-counted call.
 */
export async function googleGeocode(apiKey: string, query: string): Promise<GeoPoint | null> {
  const res = await fetch(GOOGLE_TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.location,places.viewport,places.formattedAddress,places.types",
    },
    body: JSON.stringify({ textQuery: query, pageSize: 1 }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`google geocode ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const p = (await res.json())?.places?.[0];
  const lat = Number(p?.location?.latitude);
  const lng = Number(p?.location?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const lo = p.viewport?.low;
  const hi = p.viewport?.high;
  const span = lo && hi ? haversineKm(lo.latitude, lo.longitude, hi.latitude, hi.longitude) : 0;
  const types: string[] = Array.isArray(p.types) ? p.types : [];
  const kind = types.includes("country")
    ? "country"
    : types.includes("administrative_area_level_1")
    ? "state"
    : types.includes("administrative_area_level_2")
    ? "county"
    : "city";
  return { lat, lng, label: String(p.formattedAddress ?? query), span_km: round(span, 1), kind };
}

export type GeocodeResult = { point: GeoPoint | null; via: "cache" | "nominatim" | "google" | "none"; error?: string };

// Per-isolate memory of Google geocodes. The agent often calls find_kosher
// twice for one question; without this each call paid a second Google
// lookup. Lives only as long as the isolate (minutes), so it isn't storage in
// the sense of Google's terms.
const googleGeoMemo = new Map<string, GeoPoint>();

/**
 * Coordinates for a free-text destination ("מילאנו", "רודוס, יוון"). Nominatim
 * reads most Hebrew city names; `translate` (an LLM call the caller pays for)
 * is only tried when the Hebrew query misses. Nominatim answers — hits and
 * misses — are cached. If Nominatim fails or misses, `fallback` (Google, when
 * the caller has a key and budget) gets one try; its answer isn't cached.
 */
export async function geocodeDestination(
  db: Db | null,
  destination: string,
  translate: (q: string) => Promise<string>,
  fallback?: (q: string) => Promise<GeoPoint | null>,
): Promise<GeocodeResult> {
  const query = destination.trim().slice(0, 200);
  if (!query) return { point: null, via: "none" };
  const key = geoKey(query);
  const cached = await cacheGet(db, key);
  if (cached !== undefined) {
    const point = (cached as { point: GeoPoint | null }).point;
    if (point || !fallback) return { point, via: "cache" };
  }

  let error: string | undefined;
  if (cached === undefined) {
    try {
      let point = await nominatim(query);
      if (!point && /[֐-׿]/.test(query)) {
        const english = (await translate(query)).trim();
        if (english && english !== query) point = await nominatim(english);
      }
      await cachePut(db, key, "nominatim", { point }, point ? TTL.geocode : TTL.geocodeMiss);
      if (point) return { point, via: "nominatim" };
    } catch (e) {
      error = String(e).slice(0, 120);
      console.error("kosher geocode failed", e);
    }
  }

  if (fallback) {
    const remembered = googleGeoMemo.get(key);
    if (remembered) return { point: remembered, via: "google", error: error ?? "memo" };
    try {
      const point = await fallback(query);
      if (point) {
        if (googleGeoMemo.size > 200) googleGeoMemo.clear();
        googleGeoMemo.set(key, point);
        return { point, via: "google", error };
      }
    } catch (e) {
      error = `${error ?? ""} | ${String(e).slice(0, 120)}`;
      console.error("kosher google geocode failed", e);
    }
  }
  return { point: null, via: "none", error };
}

/** Search radius around the destination's centre, in metres. */
export function searchRadiusM(point: GeoPoint): number {
  const half = (point.span_km / 2) * 1000;
  return half <= 5000 ? 5000 : half <= 10000 ? 10000 : 15000;
}

export const isTooWide = (point: GeoPoint) =>
  WIDE_ADDRESS_TYPES.includes(point.kind) || point.span_km > MAX_SEARCHABLE_SPAN_KM;

/* ------------------------------------------------------------ OSM layer */

function osmKind(tags: Record<string, string>): KosherPlace["kind"] {
  if (tags.amenity === "place_of_worship") return "synagogue";
  if (["restaurant", "cafe", "fast_food", "bar", "pub", "food_court", "ice_cream"].includes(tags.amenity)) return "restaurant";
  if (tags.shop) return "shop";
  return "other";
}

function osmAddress(tags: Record<string, string>): string | null {
  const street = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ");
  const parts = [street, tags["addr:city"]].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/**
 * Kosher-tagged places (diet:kosher=yes|only) plus synagogues around a point,
 * from the public Overpass API. Cached per ~1 km cell and radius; an empty
 * answer is cached for a shorter time. (cuisine=kosher is deprecated on the
 * OSM wiki in favour of diet:kosher and was ~0 in every city measured, while
 * its regex made the query several times slower — so it isn't asked.)
 */
export async function searchOsmKosher(db: Db | null, lat: number, lng: number, radiusM: number): Promise<KosherPlace[]> {
  const cLat = round(lat, 2);
  const cLng = round(lng, 2);
  const key = `osm:${cLat},${cLng}:${radiusM}`;
  const cached = await cacheGet(db, key);
  let elements: { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[];

  if (cached !== undefined) {
    elements = (cached as { elements: typeof elements }).elements;
  } else {
    const around = `(around:${radiusM},${cLat},${cLng})`;
    const query =
      `[out:json][timeout:15];(` +
      `nwr["diet:kosher"~"^(yes|only)$"]${around};` +
      `nwr["amenity"="place_of_worship"]["religion"="jewish"]${around};` +
      `);out center tags 400;`;
    try {
      let data: { elements?: typeof elements } | null = null;
      let lastError = "";
      for (const url of OVERPASS_URLS) {
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
            body: `data=${encodeURIComponent(query)}`,
            signal: AbortSignal.timeout(15000),
          });
          if (res.ok) {
            data = await res.json();
            break;
          }
          lastError = `${url} ${res.status}`;
        } catch (e) {
          lastError = `${url} ${e}`;
        }
      }
      if (!data) throw new Error(`overpass: ${lastError}`);
      // Keep only what we render — the cache holds facts, not whole OSM objects.
      elements = (data?.elements ?? []).map((e: typeof elements[number]) => ({
        type: e.type,
        id: e.id,
        lat: e.lat ?? e.center?.lat,
        lon: e.lon ?? e.center?.lon,
        tags: Object.fromEntries(
          Object.entries(e.tags ?? {}).filter(([k]) =>
            ["name", "name:he", "name:en", "amenity", "shop", "cuisine", "diet:kosher", "check_date", "religion",
              "addr:street", "addr:housenumber", "addr:city", "website", "contact:website"].includes(k)
          ),
        ),
      }));
      await cachePut(db, key, "osm", { elements }, elements.length ? TTL.osm : TTL.osmEmpty);
    } catch (e) {
      // Not cached: Overpass being busy is not the same as "no kosher here".
      console.error("overpass failed", e);
      throw e;
    }
  }

  const places: KosherPlace[] = [];
  for (const e of elements) {
    const tags = e.tags ?? {};
    // Hebrew, then English, then the local script (Georgian, Greek…).
    const name = tags["name:he"] || tags["name:en"] || tags.name;
    if (!name || e.lat == null || e.lon == null) continue;
    const diet = tags["diet:kosher"] === "only" ? "only" : tags["diet:kosher"] === "yes" ? "yes" : null;
    const osmUrl = `https://www.openstreetmap.org/${e.type}/${e.id}`;
    places.push({
      tier: "unverified",
      name,
      kind: osmKind(tags),
      address: osmAddress(tags),
      lat: e.lat,
      lng: e.lon,
      distance_km: round(haversineKm(lat, lng, e.lat, e.lon), 1),
      source: "osm",
      source_label: "OpenStreetMap",
      source_url: osmUrl,
      checked_on: tags.check_date ?? null,
      maps_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${e.lat},${e.lon}`)}`,
      osm_diet: diet,
    });
  }
  return places;
}

/* --------------------------------------------------------- Google layer */

/**
 * Google Places (New) Text Search for "kosher restaurant" near a point. The
 * field mask stays inside the "Text Search Pro" SKU (no rating, hours or
 * reviews). Nothing here is stored — Google's terms allow keeping place IDs
 * only — so each call is live and the caller enforces the budget cap.
 */
export async function searchGoogleKosher(apiKey: string, lat: number, lng: number, radiusM: number): Promise<KosherPlace[]> {
  const res = await fetch(GOOGLE_TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.businessStatus,places.primaryType",
    },
    body: JSON.stringify({
      textQuery: "kosher restaurant",
      pageSize: 15,
      locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: Math.min(radiusM, 50000) } },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`google places ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const data = await res.json();
  const places: KosherPlace[] = [];
  for (const p of data?.places ?? []) {
    const pLat = Number(p?.location?.latitude);
    const pLng = Number(p?.location?.longitude);
    const name = String(p?.displayName?.text ?? "").trim();
    if (!name || !Number.isFinite(pLat) || !Number.isFinite(pLng)) continue;
    if (p.businessStatus === "CLOSED_PERMANENTLY") continue;
    const mapsUrl = typeof p.googleMapsUri === "string" ? p.googleMapsUri : `https://www.google.com/maps/place/?q=place_id:${p.id}`;
    places.push({
      tier: "unverified",
      name,
      kind: String(p.primaryType ?? "").includes("store") || String(p.primaryType ?? "").includes("market") ? "shop" : "restaurant",
      address: typeof p.formattedAddress === "string" ? p.formattedAddress : null,
      lat: pLat,
      lng: pLng,
      distance_km: round(haversineKm(lat, lng, pLat, pLng), 1),
      source: "google",
      source_label: "Google Maps",
      source_url: mapsUrl,
      checked_on: null,
      maps_url: mapsUrl,
      osm_diet: null,
    });
  }
  return places;
}

const normName = (s: string) => s.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * One list, nearest first: OSM and Google merged, the same venue from both
 * kept once (OSM's copy, which links to its map object). Synagogues are kept
 * apart by the caller's kind filter; everything stays tier "unverified".
 */
export function mergePlaces(osm: KosherPlace[], google: KosherPlace[]): KosherPlace[] {
  const out = [...osm];
  for (const g of google) {
    const dup = osm.some((o) => {
      const near = haversineKm(o.lat, o.lng, g.lat, g.lng) < 0.15;
      const a = normName(o.name);
      const b = normName(g.name);
      return near && (a.includes(b) || b.includes(a) || a.slice(0, 6) === b.slice(0, 6));
    });
    if (!dup) out.push(g);
  }
  return out
    .filter((p) => p.distance_km <= MAX_RESULT_DISTANCE_KM)
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, MAX_PLACES);
}

/* -------------------------------------------------------- curated layer */

/** "verified" while the source date is under six months old, then "unverified". */
export function curatedTier(sourceVerifiedOn: string, now = new Date()): CuratedItem["tier"] {
  const age = (now.getTime() - new Date(`${sourceVerifiedOn}T00:00:00Z`).getTime()) / DAY_MS;
  return Number.isFinite(age) && age <= VERIFIED_MAX_AGE_DAYS ? "verified" : "unverified";
}

export function toCuratedItem(row: {
  title: string;
  content: string;
  category: string;
  source_url: string;
  source_verified_on: string;
}): CuratedItem {
  const tier = curatedTier(row.source_verified_on);
  const when = formatMonthYear(String(row.source_verified_on));
  const label =
    tier === "verified"
      ? `מאומת · מקור: ${sourceHost(row.source_url)} · נבדק ${when}`
      : `מידע מ-${when} שלא נבדק מחדש — לא מאומת, יש לוודא השגחה`;
  return { tier, ...row, source_verified_on: String(row.source_verified_on), label };
}

/* ------------------------------------------------------------- Hebcal */

function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  for (let d = s; d <= e && out.length < MAX_TRIP_DAYS; d = new Date(d.getTime() + DAY_MS)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Candle lighting, havdalah and yom tov for every date of the trip at the
 * destination (diaspora calendar — two-day yom tov). Hebcal infers the time
 * zone from the coordinates. Cached 30 days: it's a calculation, it doesn't
 * go stale, but the cache keeps us polite to a free service.
 */
export async function shabbatTimes(
  db: Db | null,
  lat: number,
  lng: number,
  startDate: string,
  endDate: string,
): Promise<ShabbatInfo | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate) return null;
  const dates = datesBetween(startDate, endDate);
  const last = dates[dates.length - 1];
  const cLat = round(lat, 2);
  const cLng = round(lng, 2);
  const key = `hebcal:${cLat},${cLng}:${startDate}:${last}`;

  let payload = (await cacheGet(db, key)) as
    | { tzid: string | null; items: { date: string; category: string; yomtov?: boolean; hebrew?: string }[] }
    | undefined;
  if (!payload) {
    const params = new URLSearchParams({
      v: "1", cfg: "json", maj: "on", min: "off", mod: "off", nx: "off", ss: "off", mf: "off",
      c: "on", M: "on", s: "off", geo: "pos",
      latitude: String(cLat), longitude: String(cLng), start: startDate, end: last,
    });
    try {
      const res = await fetch(`${HEBCAL_URL}?${params}`, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`hebcal ${res.status}`);
      const data = await res.json();
      payload = {
        tzid: data?.location?.tzid ?? null,
        items: (data?.items ?? [])
          .filter((i: { category?: string; yomtov?: boolean }) =>
            i.category === "candles" || i.category === "havdalah" || (i.category === "holiday" && i.yomtov)
          )
          .map((i: { date: string; category: string; yomtov?: boolean; hebrew?: string }) => ({
            date: i.date, category: i.category, yomtov: i.yomtov === true, hebrew: i.hebrew,
          })),
      };
      await cachePut(db, key, "hebcal", payload, TTL.hebcal);
    } catch (e) {
      console.error("hebcal failed", e);
      return null;
    }
  }

  const byDate = new Map<string, ShabbatDay>(
    dates.map((d) => [d, { date: d, candles: null, havdalah: null, holiday: null, restricted: new Date(`${d}T00:00:00Z`).getUTCDay() === 6 }]),
  );
  for (const i of payload.items) {
    const day = byDate.get(i.date.slice(0, 10));
    if (!day) continue;
    if (i.category === "candles") day.candles = i.date.slice(11, 16);
    else if (i.category === "havdalah") day.havdalah = i.date.slice(11, 16);
    else if (i.category === "holiday") {
      day.holiday = i.hebrew ?? null;
      day.restricted = true;
    }
  }
  return {
    tzid: payload.tzid,
    days: [...byDate.values()].filter((d) => d.candles || d.havdalah || d.restricted),
    source_label: "Hebcal.com (CC BY 4.0) — חישוב אוטומטי, יש לבדוק מול בית חב״ד או רב מקומי",
    source_url: "https://www.hebcal.com",
  };
}
