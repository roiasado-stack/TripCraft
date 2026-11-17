// Link-preview card for the public brochure (/share/:slug). WhatsApp, Facebook
// and friends don't run JavaScript, so api/share-og/[slug].ts serves index.html
// with these tags already in its <head>, built from the public
// get_shared_trip(slug) payload. On an agency's trip the card carries only the
// agency's brand.
//
// Imported by the Vercel function too (Node ESM), hence the explicit .js
// extensions and no "@/" alias.
import { AGENCY_LOGO_BUCKET, imageMimeOf, isAgencyLogoPath } from "./agency-brand.js";
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
  /** Home-screen label (apple-mobile-web-app-title) on an agency trip; null keeps index.html's. */
  appTitle: string | null;
  /** The page's own absolute URL. */
  url: string;
}

// Origins -------------------------------------------------------------------------
// The request's host can't be trusted: the Node runtime builds request.url from
// headers a client can send (x-forwarded-host). So the page URL in the card is
// always the canonical one, and index.html is fetched only from one of our own
// deployment hosts.

/**
 * The live production domain (client share links are on it). The card's
 * canonical origin when VERCEL_PROJECT_PRODUCTION_URL isn't set.
 */
export const PRODUCTION_HOST = "tripcraft.co.il";

/**
 * Hosts that serve this project's production build. The fallback for an
 * unknown host is VERCEL_URL, which deployment protection may guard, so every
 * public production host must be listed here or prod shares would get a 502.
 */
// www.tripcraft.co.il is left out: Vercel redirects it (308) before the function runs,
// and the index.html fetch refuses redirects.
const PRODUCTION_HOSTS = [PRODUCTION_HOST, "tripcraft-lac.vercel.app"];

/** The Vercel system env vars this reads (all bare hosts, no protocol). */
export interface ShareOgEnv {
  VERCEL_URL?: string;
  VERCEL_BRANCH_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
}

function normalizeHost(host: string | null | undefined): string | null {
  const h = host?.trim().toLowerCase().replace(/\.$/, "");
  return h && /^[a-z0-9.-]+(:\d{1,5})?$/.test(h) ? h : null;
}

/** https, except for a local `vercel dev` / script host. */
function originOf(host: string): string {
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? `http://${host}` : `https://${host}`;
}

/** Where the card's page URL and default image point: production, never the request. */
export function canonicalOrigin(env: ShareOgEnv): string {
  return originOf(normalizeHost(env.VERCEL_PROJECT_PRODUCTION_URL) ?? PRODUCTION_HOST);
}

/**
 * Where to fetch index.html from. The request's host only when it is one of
 * this project's own hosts (the production domain or this deployment's URLs);
 * anything else — a forged x-forwarded-host included — falls back to this
 * deployment's own URL, then to production.
 */
export function trustedFetchOrigin(requestHost: string | null | undefined, env: ShareOgEnv): string {
  const own = [...PRODUCTION_HOSTS, env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_URL, env.VERCEL_BRANCH_URL]
    .map(normalizeHost)
    .filter((h): h is string => Boolean(h));
  const host = normalizeHost(requestHost);
  if (host && own.includes(host)) return originOf(host);
  const deployment = normalizeHost(env.VERCEL_URL);
  return deployment ? originOf(deployment) : canonicalOrigin(env);
}

// Slug ----------------------------------------------------------------------------

/** The share slug as the app makes it (18 hex chars today), or null for anything else. */
export function shareSlug(value: string | null | undefined): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{12,64}$/.test(value) ? value : null;
}

/**
 * The slug from the request's path — `/share/<slug>` as the visitor typed it, or
 * `/api/share-og/<slug>` after the rewrite. Never from the query string, which
 * the visitor controls and Vercel merges with the rewrite's own parameters.
 */
export function slugFromPath(pathname: string): string | null {
  const m = /^\/(?:share|api\/share-og)\/([^/]+)\/?$/.exec(pathname);
  return m ? shareSlug(m[1]) : null;
}

// Card ----------------------------------------------------------------------------

/** Public URL of an agency logo — what supabase.storage.getPublicUrl builds on the share page. */
export function agencyLogoPublicUrl(supabaseUrl: string, logoPath: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${AGENCY_LOGO_BUCKET}/${logoPath}`;
}

/** The trip's title, or its destination when it has none. */
function tripTitle(trip: SharedTripPayload["trip"]): string {
  return trip.title?.trim() || trip.destination?.trim() || "טיול";
}

/**
 * The page title on an agency's trip ("<trip> | <agency>", or the trip alone for
 * a logo-only agency), or null when the trip isn't an agency's. Same test as
 * the share page: an agency trip is one with a name or a valid logo.
 */
export function agencyPageTitle(payload: Pick<SharedTripPayload, "trip" | "agency">): string | null {
  const name = payload.agency?.name?.trim() || null;
  if (!name && !isAgencyLogoPath(payload.agency?.logo_path)) return null;
  const title = tripTitle(payload.trip);
  return name ? `${title} | ${name}` : title;
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
 * What the card shows. `origin` is the canonical origin (canonicalOrigin), for
 * the page URL and the default image; `supabaseUrl` is the project the logo lives in.
 */
export function shareOgMeta(
  payload: SharedTripPayload,
  opts: { origin: string; slug: string; supabaseUrl: string },
): ShareOgMeta {
  const { trip, agency } = payload;
  const origin = opts.origin.replace(/\/+$/, "");
  const url = `${origin}/share/${opts.slug}`;
  const title = tripTitle(trip);
  const destination = trip.destination?.trim() || null;
  const dates = dateRange(trip.start_date, trip.end_date);
  const description = [destination, dates].filter(Boolean).join(" · ") || title;
  const photo = isTripPhotoUrl(trip.image_url) ? (trip.image_url as string) : null;

  const agencyTitle = agencyPageTitle(payload);
  if (agencyTitle) {
    const agencyName = agency?.name?.trim() || null;
    const logo = isAgencyLogoPath(agency?.logo_path) ? agencyLogoPublicUrl(opts.supabaseUrl, agency!.logo_path!) : null;
    return {
      title: agencyTitle,
      description,
      image: logo ?? photo,
      largeImage: !logo && Boolean(photo),
      siteName: agencyName,
      appTitle: agencyName ?? title,
      url,
    };
  }

  return {
    title: destination && !title.includes(destination) ? `${title} · ${destination}` : title,
    description,
    image: photo ?? `${origin}/icon-512.png`,
    largeImage: Boolean(photo),
    siteName: "TripCraft",
    appTitle: null,
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
  if (meta.image) {
    prop("og:image", meta.image);
    const type = imageMimeOf(meta.image);
    if (type) prop("og:image:type", type);
  }
  name("twitter:card", meta.largeImage ? "summary_large_image" : "summary");
  name("twitter:title", meta.title);
  name("twitter:description", meta.description);
  if (meta.image) name("twitter:image", meta.image);
  return tags.join("\n    ");
}

/**
 * index.html with its <title> and description replaced by the card's tags, and
 * on an agency trip its home-screen label too. Functions are used as
 * replacements so a "$&" in a trip title stays literal text.
 */
export function injectShareOg(html: string, meta: ShareOgMeta): string {
  const tags = shareOgTags(meta);
  let out = html.replace(/[ \t]*<meta\s+name=["']description["'][^>]*>\r?\n?/i, () => "");
  if (meta.appTitle) {
    const label = `<meta name="apple-mobile-web-app-title" content="${escapeHtml(meta.appTitle)}" />`;
    out = out.replace(/<meta\s+name=["']apple-mobile-web-app-title["'][^>]*>/i, () => label);
  }
  if (/<title>[\s\S]*?<\/title>/i.test(out)) return out.replace(/<title>[\s\S]*?<\/title>/i, () => tags);
  return out.replace(/<\/head>/i, () => `${tags}\n  </head>`);
}
