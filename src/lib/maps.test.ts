import { describe, expect, it } from "vitest";
import { isSafeHttpUrl, mapsUrl, resolveMapUrl, whatsappUrl } from "./maps";

describe("isSafeHttpUrl", () => {
  it("accepts http and https", () => {
    expect(isSafeHttpUrl("https://maps.google.com/x")).toBe(true);
    expect(isSafeHttpUrl("http://example.com")).toBe(true);
  });

  it("rejects script and data links that a shared trip could carry", () => {
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("JavaScript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeHttpUrl("not a url")).toBe(false);
  });
});

describe("mapsUrl / resolveMapUrl", () => {
  it("encodes Hebrew place names", () => {
    expect(mapsUrl("הכותל", "ירושלים")).toBe(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("הכותל, ירושלים")}`,
    );
  });

  it("returns null when there is nothing to search for", () => {
    expect(mapsUrl("  ", null)).toBeNull();
  });

  it("prefers an explicit map_url and otherwise builds a search", () => {
    expect(resolveMapUrl("https://maps.app.goo.gl/abc", "x")).toBe("https://maps.app.goo.gl/abc");
    expect(resolveMapUrl(null, "Colosseum", "Rome")).toContain("Colosseum%2C%20Rome");
  });
});

describe("whatsappUrl", () => {
  it("turns an Israeli mobile number into an international wa.me link", () => {
    expect(whatsappUrl("050-123 4567")).toBe("https://wa.me/972501234567");
  });

  it("keeps numbers that are already international", () => {
    expect(whatsappUrl("+39 06 1234 5678")).toBe("https://wa.me/390612345678");
  });

  it("returns null for empty or too-short input", () => {
    expect(whatsappUrl("")).toBeNull();
    expect(whatsappUrl("123")).toBeNull();
  });
});
