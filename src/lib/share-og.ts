// Link-preview card for the public brochure (/share/:slug). WhatsApp, Facebook
// and friends don't run JavaScript, so api/share-og.ts serves index.html with
// these tags already in its <head>, built from the public get_shared_trip(slug)
// payload. On an agency's trip the card carries only the agency's brand.
//
// Imported by the Vercel function too (Node ESM), hence the explicit .js
// extensions and no "@/" alias.
import { AGENCY_LOGO_BUCKET, isAgencyLogoPath } from "./agency-brand.js";
import { isTripPhotoUrl } from "./photo-url.js";
import type { SharedTripPayload } from "./types";

export interface ShareOgMeta {
  title: string;
  description: string;
  /** Absolute URL, or null when there's nothing worth showing. */
  image: string | null;
  /** True when `image` is the destination photo (a wide card); a logo or icon is a small square. */
  largeImage: boolean;
  /** The agency's name on an agency trip (or nothing when it has none), else TripCraft. */
  siteName: string | null;
  /** The page's own absolute URL. */
  url: string;
}

/** The share slug as the app makes it, or null for anything else. */
export function shareSlug(value: string | null | undefined): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null;
}

/** Public URL of an agency logo — what supabase.storage.getPublicUrl builds on the share page. */
export function agencyLogoPublicUrl(supabaseUrl: string, logoPath: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${AGENCY_LOGO_BUCKET}/${logoPath}`;
}

/** "11.3–28.3.2027" from two YYYY-MM-DD days, without going through Date. */
function dateRange(start: string | null, end: string | null): string | null {
  const parse = (d: string | null) => {
    const m = d ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(d) : null;
    return m ? { y: m[1], m: String(Number(m[2])), d: String(Number(m[3])) } : null;
  };
  const s = parse(start);
  const e = parse(end);
  if (s && e) return s.y === e.y ? `${s.d}.${s.m}–${e.d}.${e.m}.${e.y}` : `${s.d}.${s.m}.${s.y}–${e.d}.${e.m}.${e.y}`;
  if (s) return `${s.d}.${s.m}.${s.y}`;
  return null;
}

/**
 * What the card shows. `origin` is the site's own origin (for the page URL and
 * the default image); `supabaseUrl` is the project the logo lives in.
 */
export function shareOgMeta(
  payload: SharedTripPayload,
  opts: { origin: string; slug: string; supabaseUrl: string },
): ShareOgMeta {
  const { trip, agency } = payload;
  const origin = opts.origin.replace(/\/+$/, "");
  const url = `${origin}/share/${opts.slug}`;
  const title = trip.title?.trim() || trip.destination?.trim() || "טיול";
  const destination = trip.destination?.trim() || null;
  const dates = dateRange(trip.start_date, trip.end_date);
  const description = [destination, dates].filter(Boolean).join(" · ") || title;
  const photo = isTripPhotoUrl(trip.image_url) ? (trip.image_url as string) : null;

  // Same test as the share page: an agency trip is one with a name or a logo.
  const agencyName = agency?.name?.trim() || null;
  const logo = isAgencyLogoPath(agency?.logo_path) ? agencyLogoPublicUrl(opts.supabaseUrl, agency!.logo_path!) : null;
  if (agencyName || logo) {
    return {
      title: agencyName ? `${title} | ${agencyName}` : title,
      description,
      image: logo ?? photo,
      largeImage: !logo && Boolean(photo),
      siteName: agencyName,
      url,
    };
  }

  return {
    title: destination && !title.includes(destination) ? `${title} · ${destination}` : title,
    description,
    image: photo ?? `${origin}/icon-512.png`,
    largeImage: Boolean(photo),
    siteName: "TripCraft",
    url,
  };
}

/** Escapes text for an HTML attribute value or element content. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The <title> and meta tags for the card, every value escaped. */
export function shareOgTags(meta: ShareOgMeta): string {
  const tags: string[] = [`<title>${escapeHtml(meta.title)}</title>`];
  const prop = (p: string, v: string) => tags.push(`<meta property="${p}" content="${escapeHtml(v)}" />`);
  const name = (n: string, v: string) => tags.push(`<meta name="${n}" content="${escapeHtml(v)}" />`);
  name("description", meta.description);
  prop("og:type", "website");
  prop("og:url", meta.url);
  prop("og:title", meta.title);
  prop("og:description", meta.description);
  if (meta.siteName) prop("og:site_name", meta.siteName);
  if (meta.image) prop("og:image", meta.image);
  name("twitter:card", meta.largeImage ? "summary_large_image" : "summary");
  name("twitter:title", meta.title);
  name("twitter:description", meta.description);
  if (meta.image) name("twitter:image", meta.image);
  return tags.join("\n    ");
}

/**
 * index.html with its <title> and description replaced by `tags`. Functions are
 * used as replacements so a "$&" in a trip title stays literal text.
 */
export function injectShareOg(html: string, tags: string): string {
  const withoutDescription = html.replace(/[ \t]*<meta\s+name=["']description["'][^>]*>\r?\n?/i, () => "");
  if (/<title>[\s\S]*?<\/title>/i.test(withoutDescription))
    return withoutDescription.replace(/<title>[\s\S]*?<\/title>/i, () => tags);
  return withoutDescription.replace(/<\/head>/i, () => `${tags}\n  </head>`);
}
