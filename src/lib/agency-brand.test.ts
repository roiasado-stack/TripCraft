import { describe, expect, it } from "vitest";
import {
  fitWithin,
  isAgencyLogoPath,
  isAgencyLogoUrl,
  logoFileProblem,
  logoObjectPath,
  logoPathFromUrl,
  safeAgencyColor,
} from "./agency-brand";

const PREFIX = "https://proj.supabase.co/storage/v1/object/public/agency-logos/";
const UID = "00000000-0000-0000-0000-0000000000c5";

describe("safeAgencyColor", () => {
  it("keeps a #rrggbb colour in either case", () => {
    expect(safeAgencyColor("#12b3b0")).toBe("#12b3b0");
    expect(safeAgencyColor("#1A2B3C")).toBe("#1A2B3C");
  });
  it("drops anything that could be more than a colour", () => {
    for (const bad of ["red", "#fff", "#12b3b0;", "url(https://evil.example/p.gif)", "#12b3b0 url(x)", "", null, undefined]) {
      expect(safeAgencyColor(bad)).toBeNull();
    }
  });
});

describe("isAgencyLogoUrl / logoPathFromUrl", () => {
  it("accepts a file in one user's folder of our bucket", () => {
    const url = `${PREFIX}${UID}/logo-1700000000000.webp`;
    expect(isAgencyLogoUrl(url, PREFIX)).toBe(true);
    expect(logoPathFromUrl(url, PREFIX)).toBe(`${UID}/logo-1700000000000.webp`);
  });
  it("rejects another host, a path trick, a query string or the bucket root", () => {
    for (const bad of [
      `https://evil.example/storage/v1/object/public/agency-logos/${UID}/logo.png`,
      `${PREFIX}${UID}/../x.png`,
      `${PREFIX}${UID}/sub/logo.png`,
      `${PREFIX}${UID}/logo.png?track=1`,
      `${PREFIX}logo.png`,
      `${PREFIX}not-a-uuid/logo.png`,
      null,
      undefined,
    ]) {
      expect(isAgencyLogoUrl(bad, PREFIX)).toBe(false);
      expect(logoPathFromUrl(bad, PREFIX)).toBeNull();
    }
  });
  it("needs a prefix ending in a slash", () => {
    expect(isAgencyLogoUrl(`${PREFIX}${UID}/logo.png`, PREFIX.slice(0, -1))).toBe(false);
  });
  it("rejects a non-image file name in our bucket", () => {
    expect(isAgencyLogoUrl(`${PREFIX}${UID}/copied.html`, PREFIX)).toBe(false);
  });
});

describe("isAgencyLogoPath", () => {
  it("accepts an image file directly in one user's folder", () => {
    for (const ok of [`${UID}/logo-1700000000000.webp`, `${UID}/logo-1.png`, `${UID}/logo_1.jpg`, `${UID}/a.jpeg`]) {
      expect(isAgencyLogoPath(ok)).toBe(true);
    }
  });
  it("rejects URLs, other file types, nested or traversal paths and the bucket root", () => {
    for (const bad of [
      `${PREFIX}${UID}/logo.png`,
      `https://evil.example/${UID}/logo.png`,
      `//evil.example/${UID}/logo.png`,
      `${UID}/copied.html`,
      `${UID}/logo.svg`,
      `${UID}/logo.png.html`,
      `${UID}/logo.png?track=1`,
      `${UID}/../x.png`,
      `${UID}/sub/logo.png`,
      `${UID}/.png`,
      "logo.png",
      "not-a-uuid/logo.png",
      "",
      null,
      undefined,
    ]) {
      expect(isAgencyLogoPath(bad)).toBe(false);
    }
  });
});

describe("logoObjectPath", () => {
  it("puts the file in the uploader's folder with the right extension", () => {
    expect(logoObjectPath(UID, 5, "image/webp")).toBe(`${UID}/logo-5.webp`);
    expect(logoObjectPath(UID, 5, "image/png")).toBe(`${UID}/logo-5.png`);
    expect(logoObjectPath(UID, 5, "image/jpeg")).toBe(`${UID}/logo-5.jpg`);
  });
});

describe("logoFileProblem", () => {
  it("accepts PNG, JPEG and WebP", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp"]) expect(logoFileProblem({ type, size: 1000 })).toBeNull();
  });
  it("refuses SVG, GIF and non-images", () => {
    for (const type of ["image/svg+xml", "image/gif", "application/pdf", ""]) expect(logoFileProblem({ type, size: 1000 })).toBe("type");
  });
  it("refuses a huge file", () => {
    expect(logoFileProblem({ type: "image/png", size: 11 * 1024 * 1024 })).toBe("too_big");
  });
});

describe("fitWithin", () => {
  it("shrinks the longest side to the max and keeps the ratio", () => {
    expect(fitWithin(2000, 1000, 512)).toEqual({ width: 512, height: 256 });
    expect(fitWithin(300, 1200, 512)).toEqual({ width: 128, height: 512 });
  });
  it("never enlarges a small image", () => {
    expect(fitWithin(100, 50, 512)).toEqual({ width: 100, height: 50 });
  });
  it("handles a broken size", () => {
    expect(fitWithin(0, 50)).toEqual({ width: 0, height: 0 });
  });
});
