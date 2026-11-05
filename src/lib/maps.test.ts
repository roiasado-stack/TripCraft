import { describe, expect, it } from "vitest";
import { isSafeHttpUrl, mapsUrl, resolveMapUrl, stayDirectionsUrl, stayMapUrl, taxiSearchUrl, whatsappUrl } from "./maps";

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

const query = (url: string | null) => new URL(url!).searchParams.get("query");

// The real trip from the live demo: two cities in one destination field.
const MULTI_CITY = "קרקוב וורשה, פולין";
const HOLIDAY_INN = { hotel_name: "Holiday Inn Krakow City Centre", address: "Wielopole 4, Kraków" };

describe("stayMapUrl", () => {
  it("searches for the hotel and its address, without the multi-city destination", () => {
    expect(query(stayMapUrl(HOLIDAY_INN, MULTI_CITY))).toBe("Holiday Inn Krakow City Centre, Wielopole 4, Kraków");
  });

  it("doesn't repeat a hotel name the address already contains", () => {
    const stay = { hotel_name: "Holiday Inn", address: "holiday inn, Wielopole 4, Kraków" };
    expect(query(stayMapUrl(stay, MULTI_CITY))).toBe("holiday inn, Wielopole 4, Kraków");
  });

  it("scopes a hotel with no address to the destination, as before", () => {
    expect(query(stayMapUrl({ hotel_name: "Hotel Roma", address: "" }, "רומא, איטליה"))).toBe("Hotel Roma, רומא, איטליה");
    expect(query(stayMapUrl({ hotel_name: "Hotel Roma", address: null }, null))).toBe("Hotel Roma");
  });

  it("uses a blank-name address alone", () => {
    expect(query(stayMapUrl({ hotel_name: " ", address: "Wielopole 4, Kraków" }, MULTI_CITY))).toBe("Wielopole 4, Kraków");
  });

  it("still prefers an explicit map_url", () => {
    expect(stayMapUrl({ ...HOLIDAY_INN, map_url: "https://maps.app.goo.gl/abc" }, MULTI_CITY)).toBe("https://maps.app.goo.gl/abc");
  });

  it("returns null when the stay has nothing to search for", () => {
    expect(stayMapUrl({ hotel_name: "", address: "" }, null)).toBeNull();
  });
});

describe("stayDirectionsUrl", () => {
  it("navigates to the same place the map shows", () => {
    const url = new URL(stayDirectionsUrl(HOLIDAY_INN, MULTI_CITY)!);
    expect(url.searchParams.get("destination")).toBe("Holiday Inn Krakow City Centre, Wielopole 4, Kraków");
  });
});

describe("taxiSearchUrl", () => {
  it("searches near the first stay's address on a multi-city trip", () => {
    const stays = [HOLIDAY_INN, { hotel_name: "Marriott Warsaw", address: "Aleje Jerozolimskie 65/79, Warszawa" }];
    expect(query(taxiSearchUrl({ stays, arrivalAirport: "KRK", destination: MULTI_CITY }))).toBe("taxi near Wielopole 4, Kraków");
  });

  it("uses the arrival airport on a stay-less trip", () => {
    expect(query(taxiSearchUrl({ stays: [], arrivalAirport: "KRK", destination: MULTI_CITY }))).toBe("taxi near KRK airport");
  });

  it("prefers the airport over a hotel with no address", () => {
    const stays = [{ hotel_name: "Holiday Inn", address: null }];
    expect(query(taxiSearchUrl({ stays, arrivalAirport: "KRK", destination: MULTI_CITY }))).toBe("taxi near KRK airport");
  });

  it("scopes a hotel name to the destination when there is nothing better", () => {
    const stays = [{ hotel_name: "Hotel Roma", address: "" }];
    expect(query(taxiSearchUrl({ stays, destination: "רומא, איטליה" }))).toBe("taxi near Hotel Roma, רומא, איטליה");
  });

  it("falls back to the destination, and to null with nothing at all", () => {
    expect(query(taxiSearchUrl({ destination: "רומא, איטליה" }))).toBe("taxi רומא, איטליה");
    expect(taxiSearchUrl({ stays: [], arrivalAirport: " ", destination: "" })).toBeNull();
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
