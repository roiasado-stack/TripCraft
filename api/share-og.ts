// GET /share/:slug (vercel.json rewrites it here, before the SPA catch-all).
//
// Link previews (WhatsApp, Facebook, Telegram…) don't run JavaScript, so the
// SPA's index.html alone always shows the generic TripCraft card. This returns
// the same index.html with the trip's <title> and og:* tags in its <head>,
// built from the public get_shared_trip(slug) RPC with the publishable key —
// exactly what an anonymous visitor's browser can already read. The page then
// boots as usual.
//
// index.html is fetched from this deployment's own origin: /index.html is a
// static file, which Vercel serves before any rewrite, so it is always the
// build that matches this function. The visitor's cookies go along so a
// preview deployment behind Vercel Authentication still answers.
//
// Anything wrong with the trip (unknown slug, sharing off, RPC or env missing)
// returns the plain index.html with 200, and the SPA shows its not-found state.
import { injectShareOg, shareOgMeta, shareOgTags, shareSlug } from "../src/lib/share-og.js";
import type { SharedTripPayload } from "../src/lib/types";

// Vercel exposes the project's env vars to functions at runtime. Declared here
// rather than pulling in @types/node for one property.
declare const process: { env: Record<string, string | undefined> };

const HTML_HEADERS = { "Content-Type": "text/html; charset=utf-8" };
const FOUND_CACHE = "public, max-age=0, s-maxage=300, stale-while-revalidate=60";
const PLAIN_CACHE = "public, max-age=0, s-maxage=60";

async function sharedTrip(slug: string): Promise<SharedTripPayload | null> {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/rpc/get_shared_trip`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ p_slug: slug }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as SharedTripPayload | null;
    return data && typeof data === "object" && data.trip ? data : null;
  } catch {
    return null;
  }
}

async function indexHtml(origin: string, cookie: string | null): Promise<string | null> {
  try {
    const res = await fetch(`${origin}/index.html`, {
      headers: cookie ? { cookie } : {},
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    return /<\/head>/i.test(html) && html.includes('id="root"') ? html : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  // The rewrite passes ?slug=; the path is the fallback if it ever arrives unrewritten.
  const slug = shareSlug(url.searchParams.get("slug") ?? /^\/share\/([^/]+)\/?$/.exec(url.pathname)?.[1]);

  const [html, payload] = await Promise.all([
    indexHtml(url.origin, request.headers.get("cookie")),
    slug ? sharedTrip(slug) : Promise.resolve(null),
  ]);
  if (!html) return new Response("Service unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  if (!slug || !payload || !supabaseUrl)
    return new Response(html, { status: 200, headers: { ...HTML_HEADERS, "Cache-Control": PLAIN_CACHE } });

  const meta = shareOgMeta(payload, { origin: url.origin, slug, supabaseUrl });
  return new Response(injectShareOg(html, shareOgTags(meta)), {
    status: 200,
    headers: { ...HTML_HEADERS, "Cache-Control": FOUND_CACHE },
  });
}

// Some crawlers check a link with HEAD first; Node drops the body.
export const HEAD = GET;
