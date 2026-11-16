import { describe, expect, it } from "vitest";
import { agencyLogoPublicUrl, escapeHtml, injectShareOg, shareOgMeta, shareOgTags, shareSlug } from "./share-og";
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
const opts = { origin: ORIGIN, slug: "abc123", supabaseUrl: SUPABASE };

// The <head> of the built index.html, as Vite leaves it.
const INDEX = `<!doctype html>
<html lang="he" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <title>TripCraft · מלווה הטיולים שלך</title>
    <meta name="description" content="TripCraft — בונים, מארגנים ומלווים כל טיול." />
    <script type="module" crossorigin src="/assets/index-abc.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>`;

describe("shareOgMeta", () => {
  it("brands an agency trip with the agency only: name in the title, logo as the image", () => {
    const meta = shareOgMeta(payload({}, ABADA), opts);
    expect(meta.title).toBe("וייטנאם ותאילנד | ABADA טיולים");
    expect(meta.siteName).toBe("ABADA טיולים");
    expect(meta.image).toBe(`https://proj.supabase.co/storage/v1/object/public/agency-logos/${UID}/logo-1.png`);
    expect(meta.largeImage).toBe(false);
    expect(meta.url).toBe(`${ORIGIN}/share/abc123`);
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

describe("injectShareOg", () => {
  it("replaces the existing <title> and description instead of adding a second one", () => {
    const html = injectShareOg(INDEX, shareOgTags(shareOgMeta(payload({}, ABADA), opts)));
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html.match(/name="description"/g)).toHaveLength(1);
    expect(html).not.toContain("TripCraft");
    expect(html).toContain("<title>וייטנאם ותאילנד | ABADA טיולים</title>");
    expect(html).toContain(`<meta property="og:site_name" content="ABADA טיולים" />`);
    // The rest of the page is untouched, so the SPA still boots.
    expect(html).toContain(`<script type="module" crossorigin src="/assets/index-abc.js"></script>`);
    expect(html).toContain(`<div id="root"></div>`);
  });

  it("keeps a $& in a trip title literal", () => {
    const html = injectShareOg(INDEX, shareOgTags(shareOgMeta(payload({ title: "Cash $& $1 trip" }), opts)));
    expect(html).toContain("<title>Cash $&amp; $1 trip · וייטנאם</title>");
  });

  it("adds the tags before </head> when the page has no <title>", () => {
    const html = injectShareOg("<html><head></head><body></body></html>", "<title>x</title>");
    expect(html).toBe("<html><head><title>x</title>\n  </head><body></body></html>");
  });
});

describe("shareSlug / agencyLogoPublicUrl / escapeHtml", () => {
  it("accepts only slug-shaped values", () => {
    expect(shareSlug("119389c4581f3b2384")).toBe("119389c4581f3b2384");
    expect(shareSlug("../etc")).toBeNull();
    expect(shareSlug("a b")).toBeNull();
    expect(shareSlug("")).toBeNull();
    expect(shareSlug(null)).toBeNull();
    expect(shareSlug("x".repeat(65))).toBeNull();
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
