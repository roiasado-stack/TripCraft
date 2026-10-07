// Wikipedia's "page image" for an article isn't always a photograph: a museum's
// article can lead with its logo, a country's with its flag or a locator map,
// a city's with its coat of arms (seen: "Galleria Borghese" → its logo). Those
// read as broken photos on a card, so they're treated as no photo at all.
//
// The same pattern lives in supabase/functions/generate/index.ts (Deno can't
// import from src/); `npm run rules` fails if the two copies differ.
export const NOT_A_PHOTO =
  /\.svg(\.png)?$|(^|[^a-z])(logo|logotype|emblem|coat[ _-]of[ _-]arms|seal|flag|map|locator|signature|icon)s?([^a-z]|$)/i;

/** True unless the image's file name says it's a drawing (SVG), logo, flag, map, coat of arms… */
export function isPhotoUrl(url?: string | null): boolean {
  if (!url) return false;
  let name: string;
  try {
    name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
  } catch {
    return false;
  }
  return !NOT_A_PHOTO.test(name);
}
