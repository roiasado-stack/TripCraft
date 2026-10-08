// Wikipedia's "page image" for an article isn't always a photograph: a museum's
// article can lead with its logo, a country's with its flag or a locator map,
// a city's with its coat of arms (seen: "Galleria Borghese" → its logo). Those
// read as broken photos on a card, so they're treated as no photo at all.
//
// The same pattern lives in supabase/functions/generate/index.ts (Deno can't
// import from src/); `npm run rules` fails if the two copies differ.
export const NOT_A_PHOTO =
  /\.svg(\.png)?$|(^|[^a-z])(logo|logotype|emblem|coat[ _-]of[ _-]arms|flag[ _-]of|seal[ _-]of|map[ _-]of|(location|locator|relief|topographic)[ _-]?map|wappen|escudo|blason|bandera|karte)([^a-z]|$)/i;

const WIKIMEDIA_HOSTS = new Set(["upload.wikimedia.org", "thumb.wikimedia.org"]);

/** True unless the image's file name says it's a drawing (SVG), logo, flag, map, coat of arms… */
export function isPhotoUrl(url?: string | null): boolean {
  if (!url) return false;
  let name: string;
  try {
    const u = new URL(url);
    // Only Wikimedia file names are meaningful; Google photo URLs are random tokens.
    if (!WIKIMEDIA_HOSTS.has(u.hostname)) return u.protocol === "https:" || u.protocol === "http:";
    name = decodeURIComponent(u.pathname.split("/").pop() ?? "");
  } catch {
    return false;
  }
  return !NOT_A_PHOTO.test(name);
}

/**
 * The trip's own destination photo: only ever filled from Wikipedia, so anything
 * else is refused — an editor writing any URL through the API could otherwise make
 * every member's phone load a tracking pixel. Mirrors migration 021's filter.
 */
export function isTripPhotoUrl(url?: string | null): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && WIKIMEDIA_HOSTS.has(u.hostname) && isPhotoUrl(url);
  } catch {
    return false;
  }
}
