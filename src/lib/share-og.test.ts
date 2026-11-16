import { describe, expect, it } from "vitest";
import INDEX from "../../index.html?raw";
import {
  agencyLogoPublicUrl,
  agencyPageTitle,
  canonicalOrigin,
  escapeHtml,
  injectShareOg,
  shareOgMeta,
  shareOgTags,
  shareSlug,
  slugFromPath,
  trustedFetchOrigin,
} from "./share-og";
import type { SharedTripPayload } from "./types";

const SUPABASE = "https://proj.supabase.co/";
const ORIGIN = "https://tripcraft.example";
const UID = "00000000-0000-0000-0000-0000000000c5";
const PHOTO = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Hanoi_Old_Quarter.jpg/960px-Hanoi_Old_Quarter.jpg";

function payload(over: Partial<SharedTripPayload["trip"]> = {}, agency: SharedTripPayload["agency"] = null): SharedTripPayload {
  return {
    trip: {
      id: "t1",
      title: "וייטנאם ותאילנד",
      destination: "וייטנאם",
      start_date: "2027-03-11",
      end_date: "2027-03-28",
      cover_emoji: null,
      guide_name: null,
      guide_phone: null,
      photos_album_url: null,
      image_url: PHOTO,
      ...over,
    } as SharedTripPayload["trip"],
    agency,
    flights: [],
    stays: [],
    itinerary: [],
    suggestions: [],
    updates: [],
  };
}

const ABADA = { name: "ABADA טיולים", color: "#123456", logo_path: `${UID}/logo-1.png` };
const opts = { origin: ORIGIN, slug: "abc123def456", supabaseUrl: SUPABASE };

describe("shareOgMeta", () => {
  it("brands an agency trip with the agency only: name in the title, logo as the image", () => {
    const meta = shareOgMeta(payload({}, ABADA), opts);
    expect(meta.title).toBe("וייטנאם ותאילנד | ABADA טיולים");
    expect(meta.siteName).toBe("ABADA טיולים");
    expect(meta.image).toBe(`https://proj.supabase.co/storage/v1/object/public/agency-logos/${UID}/logo-1.png`);
    expect(meta.largeImage).toBe(false);
    expect(meta.url).toBe(`${ORIGIN}/share/abc123def456`);
    expect(meta.appTitle).toBe("ABADA טיולים");
    expect(meta.description).toBe("וייטנאם · 11.3–28.3.2027");
    expect(JSON.stringify(meta)).not.toContain("TripCraft");
  });

  it("falls back to the destination photo when the agency has no logo, never to TripCraft", () => {
    const meta = shareOgMeta(payload({}, { name: "ABADA", color: null, logo_path: null }), opts);
    expect(meta.image).toBe(PHOTO);
    expect(meta.largeImage).toBe(true);
    expect(meta.siteName).toBe("ABADA");

    const bare = shareOgMeta(payload({ image_url: null }, { name: "ABADA", color: null, logo_path: null }), opts);
    expect(bare.image).toBeNull();
    expect(JSON.stringify(bare)).not.toContain("TripCraft");
  });

  it("refuses a logo path that isn't one of ours (no foreign URL in the card)", () => {
    const meta = shareOgMeta(payload({ image_url: null }, { name: "X", color: null, logo_path: "https://evil.test/p.png" }), opts);
    expect(meta.image).toBeNull();
  });

  it("treats a logo-only agency as an agency trip", () => {
    const meta = shareOgMeta(payload({}, { name: "  ", color: null, logo_path: `${UID}/logo-2.webp` }), opts);
    expect(meta.title).toBe("וייטנאם ותאילנד");
    expect(meta.siteName).toBeNull();
    expect(meta.image).toContain("/agency-logos/");
  });

  it("gives an ordinary trip TripCraft defaults: title + destination and its cover photo", () => {
    const meta = shareOgMeta(payload({ title: "החופשה שלנו" }), opts);
    expect(meta.title).toBe("החופשה שלנו · וייטנאם");
    expect(meta.siteName).toBe("TripCraft");
    expect(meta.image).toBe(PHOTO);
    expect(meta.largeImage).toBe(true);
  });

  it("uses the app icon when an ordinary trip has no usable photo", () => {
    const meta = shareOgMeta(payload({ image_url: "https://tracker.test/pixel.jpg" }), opts);
    expect(meta.image).toBe(`${ORIGIN}/icon-512.png`);
    expect(meta.largeImage).toBe(false);
  });

  it("doesn't repeat the destination already in the title", () => {
    expect(shareOgMeta(payload(), opts).title).toBe("וייטנאם ותאילנד");
  });
});

describe("shareOgTags", () => {
  it("escapes quotes, angle brackets, ampersands and apostrophes in a title", () => {
    const meta = shareOgMeta(payload({ title: `"Tom & Jerry's" <script>` }, ABADA), opts);
    const tags = shareOgTags(meta);
    expect(tags).toContain(
      `<meta property="og:title" content="&quot;Tom &amp; Jerry&#39;s&quot; &lt;script&gt; | ABADA טיולים" />`,
    );
    expect(tags).toContain(`<title>&quot;Tom &amp; Jerry&#39;s&quot; &lt;script&gt; | ABADA טיולים</title>`);
    expect(tags).not.toContain("<script>");
  });

  it("leaves out og:site_name and og:image when there are none", () => {
    const tags = shareOgTags(shareOgMeta(payload({ image_url: null }, { name: null, color: null, logo_path: `${UID}/l.png` }), opts));
    expect(tags).not.toContain("og:site_name");
    const none = shareOgTags(shareOgMeta(payload({ image_url: null }, { name: "A", color: null, logo_path: null }), opts));
    expect(none).not.toContain("og:image");
    expect(none).toContain(`<meta name="twitter:card" content="summary" />`);
  });
});

describe("injectShareOg (on the real index.html)", () => {
  it("starts from a page that does say TripCraft, so the agency checks below mean something", () => {
    expect(INDEX).toContain("TripCraft");
    expect(INDEX).toContain('<meta name="apple-mobile-web-app-title" content="TripCraft" />');
  });

  it("leaves no TripCraft in an agency page: title, description and home-screen label replaced", () => {
    const html = injectShareOg(INDEX, shareOgMeta(payload({}, ABADA), opts));
    expect(html).not.toContain("TripCraft");
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html.match(/name="description"/g)).toHaveLength(1);
    expect(html).toContain("<title>וייטנאם ותאילנד | ABADA טיולים</title>");
    expect(html).toContain(`<meta property="og:site_name" content="ABADA טיולים" />`);
    expect(html).toContain(`<meta name="apple-mobile-web-app-title" content="ABADA טיולים" />`);
    // The rest of the page is untouched, so the SPA still boots.
    expect(html).toContain(`<div id="root"></div>`);
    expect(html).toContain(`<script type="module" src="/src/main.tsx"></script>`);
  });

  it("uses the trip title as the home-screen label of a logo-only agency", () => {
    const html = injectShareOg(INDEX, shareOgMeta(payload({}, { name: null, color: null, logo_path: `${UID}/l.png` }), opts));
    expect(html).not.toContain("TripCraft");
    expect(html).toContain(`<meta name="apple-mobile-web-app-title" content="וייטנאם ותאילנד" />`);
  });

  it("keeps the TripCraft home-screen label on an ordinary trip", () => {
    const html = injectShareOg(INDEX, shareOgMeta(payload({ title: "החופשה שלנו" }), opts));
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="TripCraft" />');
    expect(html).toContain("<title>החופשה שלנו · וייטנאם</title>");
    expect(html.match(/<title>/g)).toHaveLength(1);
  });

  it("keeps a $& in a trip title literal", () => {
    const html = injectShareOg(INDEX, shareOgMeta(payload({ title: "Cash $& $1 trip" }), opts));
    expect(html).toContain("<title>Cash $&amp; $1 trip · וייטנאם</title>");
  });

  it("adds the tags before </head> when the page has no <title>", () => {
    const html = injectShareOg("<html><head></head><body></body></html>", shareOgMeta(payload(), opts));
    expect(html.startsWith("<html><head><title>וייטנאם ותאילנד</title>")).toBe(true);
    expect(html.endsWith("\n  </head><body></body></html>")).toBe(true);
  });
});

describe("agencyPageTitle", () => {
  it("names the trip and the agency, the trip alone for a logo-only agency, nothing otherwise", () => {
    expect(agencyPageTitle(payload({}, ABADA))).toBe("וייטנאם ותאילנד | ABADA טיולים");
    expect(agencyPageTitle(payload({}, { name: null, color: null, logo_path: `${UID}/l.png` }))).toBe("וייטנאם ותאילנד");
    expect(agencyPageTitle(payload({}, { name: " ", color: null, logo_path: "https://evil.test/x.png" }))).toBeNull();
    expect(agencyPageTitle(payload())).toBeNull();
  });
});

describe("trusted origins", () => {
  const ENV = {
    VERCEL_URL: "tripcraft-abc123-team.vercel.app",
    VERCEL_BRANCH_URL: "tripcraft-git-feature-team.vercel.app",
    VERCEL_PROJECT_PRODUCTION_URL: "tripcraft-lac.vercel.app",
  };

  it("fetches index.html from the request host only when it is one of ours", () => {
    expect(trustedFetchOrigin("tripcraft-lac.vercel.app", ENV)).toBe("https://tripcraft-lac.vercel.app");
    expect(trustedFetchOrigin("TRIPCRAFT-GIT-FEATURE-TEAM.vercel.app", ENV)).toBe("https://tripcraft-git-feature-team.vercel.app");
    expect(trustedFetchOrigin("tripcraft-abc123-team.vercel.app", ENV)).toBe("https://tripcraft-abc123-team.vercel.app");
  });

  it("ignores a forged host and falls back to this deployment, then production", () => {
    expect(trustedFetchOrigin("evil.example", ENV)).toBe("https://tripcraft-abc123-team.vercel.app");
    expect(trustedFetchOrigin("tripcraft-lac.vercel.app.evil.example", ENV)).toBe("https://tripcraft-abc123-team.vercel.app");
    expect(trustedFetchOrigin("evil.example/@x", ENV)).toBe("https://tripcraft-abc123-team.vercel.app");
    expect(trustedFetchOrigin(null, ENV)).toBe("https://tripcraft-abc123-team.vercel.app");
    expect(trustedFetchOrigin("evil.example", {})).toBe("https://tripcraft-lac.vercel.app");
    // localhost only when this deployment says it is localhost (vercel dev / the local script).
    expect(trustedFetchOrigin("localhost:5181", ENV)).toBe("https://tripcraft-abc123-team.vercel.app");
    expect(trustedFetchOrigin("localhost:5181", { VERCEL_URL: "localhost:5181" })).toBe("http://localhost:5181");
  });

  it("builds the card's URLs from production, never from the request", () => {
    expect(canonicalOrigin(ENV)).toBe("https://tripcraft-lac.vercel.app");
    expect(canonicalOrigin({ VERCEL_PROJECT_PRODUCTION_URL: "trips.example.co.il" })).toBe("https://trips.example.co.il");
    expect(canonicalOrigin({})).toBe("https://tripcraft-lac.vercel.app");
    const meta = shareOgMeta(payload(), { ...opts, origin: canonicalOrigin({}) });
    expect(meta.url).toBe("https://tripcraft-lac.vercel.app/share/abc123def456");
    expect(meta.image).toBe(PHOTO);
  });
});

describe("shareSlug / agencyLogoPublicUrl / escapeHtml", () => {
  it("accepts only slug-shaped values", () => {
    expect(shareSlug("119389c4581f3b2384")).toBe("119389c4581f3b2384");
    expect(shareSlug("abc123")).toBeNull(); // shorter than 12: no RPC call
    expect(shareSlug("../etc/passwd")).toBeNull();
    expect(shareSlug("a b")).toBeNull();
    expect(shareSlug("")).toBeNull();
    expect(shareSlug(null)).toBeNull();
    expect(shareSlug("x".repeat(65))).toBeNull();
  });

  it("reads the slug from the path only, before or after the rewrite", () => {
    expect(slugFromPath("/share/119389c4581f3b2384")).toBe("119389c4581f3b2384");
    expect(slugFromPath("/api/share-og/119389c4581f3b2384")).toBe("119389c4581f3b2384");
    expect(slugFromPath("/share/119389c4581f3b2384/")).toBe("119389c4581f3b2384");
    expect(slugFromPath("/share/short")).toBeNull();
    expect(slugFromPath("/share/119389c4581f3b2384/extra")).toBeNull();
    expect(slugFromPath("/other/119389c4581f3b2384")).toBeNull();
  });

  it("builds the bucket's public URL without a double slash", () => {
    expect(agencyLogoPublicUrl("http://127.0.0.1:54321", `${UID}/l.png`)).toBe(
      `http://127.0.0.1:54321/storage/v1/object/public/agency-logos/${UID}/l.png`,
    );
  });

  it("escapes all five characters", () => {
    expect(escapeHtml(`"<&'>`)).toBe("&quot;&lt;&amp;&#39;&gt;");
  });
});
