import { describe, expect, it } from "vitest";
import {
  addDays,
  dayRange,
  flightWindow,
  itineraryBookingLines,
  moveDays,
  outsideTrip,
  partyKind,
  partyLine,
  tripDays,
  type FlightRow,
  type StayRow,
} from "../../supabase/functions/generate/bookings";

// The production case: Krakow 13–16/11, Warsaw 16–19/11, land KRK 13/11 09:30,
// fly home from WAW 19/11 21:40 — entered in an Israeli browser (IST, UTC+2).
const TZ = "Asia/Jerusalem";
const stays: StayRow[] = [
  { hotel_name: "Hotel Warszawa", address: "Warsaw, Poland", check_in: "2026-11-16", check_out: "2026-11-19" },
  { hotel_name: "Hotel Kraków", address: "Kraków, Poland", check_in: "2026-11-13", check_out: "2026-11-16" },
];
const flights: FlightRow[] = [
  { direction: "outbound", from_airport: "TLV", to_airport: "KRK", depart_at: "2026-11-13T05:00:00+00:00", arrive_at: "2026-11-13T07:30:00+00:00" },
  { direction: "inbound", from_airport: "WAW", to_airport: "TLV", depart_at: "2026-11-19T19:40:00+00:00", arrive_at: "2026-11-20T00:10:00+00:00" },
];

describe("trip days", () => {
  it("adds calendar days across a month end", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("is empty for missing or reversed dates", () => {
    expect(dayRange(null, "2026-11-19")).toEqual([]);
    expect(dayRange("2026-11-19", "2026-11-13")).toEqual([]);
  });

  it("stops at the return flight's day — no extra day after flying home", () => {
    const days = tripDays("2026-11-13", "2026-11-20", flights, TZ);
    expect(days[0]).toBe("2026-11-13");
    expect(days[days.length - 1]).toBe("2026-11-19");
    expect(days).toHaveLength(7);
  });

  it("starts on the landing day when the trip dates begin earlier", () => {
    expect(tripDays("2026-11-12", "2026-11-19", flights, TZ)[0]).toBe("2026-11-13");
  });

  it("keeps the plain dates when there are no flights", () => {
    expect(tripDays("2026-11-13", "2026-11-15", [], TZ)).toEqual(["2026-11-13", "2026-11-14", "2026-11-15"]);
  });

  it("ignores flights that contradict the dates rather than planning nothing", () => {
    const old: FlightRow[] = [{ ...flights[1], depart_at: "2025-01-01T10:00:00+00:00" }];
    expect(tripDays("2026-11-13", "2026-11-15", old, TZ)).toHaveLength(3);
  });
});

describe("flight window", () => {
  it("reads landing and take-off on the traveller's clock, not UTC", () => {
    const w = flightWindow(flights, TZ);
    expect(w.arrival).toEqual({ day: "2026-11-13", time: "09:30" });
    expect(w.departure).toEqual({ day: "2026-11-19", time: "21:40" });
  });

  it("takes the last outbound arrival (a connection) and the first inbound departure", () => {
    const legs: FlightRow[] = [
      { direction: "outbound", from_airport: "TLV", to_airport: "WAW", depart_at: "2026-11-13T04:00:00Z", arrive_at: "2026-11-13T06:30:00Z" },
      { direction: "outbound", from_airport: "WAW", to_airport: "KRK", depart_at: "2026-11-13T08:00:00Z", arrive_at: "2026-11-13T09:00:00Z" },
      { direction: "inbound", from_airport: "FRA", to_airport: "TLV", depart_at: "2026-11-19T23:00:00Z", arrive_at: null },
      { direction: "inbound", from_airport: "WAW", to_airport: "FRA", depart_at: "2026-11-19T17:00:00Z", arrive_at: null },
    ];
    const w = flightWindow(legs, TZ);
    expect(w.arrival?.time).toBe("11:00");
    expect(w.departure?.time).toBe("19:00");
  });
});

describe("booking lines for the itinerary prompt", () => {
  const days = tripDays("2026-11-13", "2026-11-20", flights, TZ);
  const text = itineraryBookingLines(stays, flights, days, TZ);

  it("finds the city-change day", () => {
    const moves = moveDays(stays, days);
    expect(moves).toHaveLength(1);
    expect(moves[0].day).toBe("2026-11-16");
    expect(moves[0].from.hotel_name).toBe("Hotel Kraków");
    expect(moves[0].to.hotel_name).toBe("Hotel Warszawa");
  });

  it("lists stays in check-in order and the rules they imply", () => {
    expect(text.indexOf("Hotel Kraków")).toBeLessThan(text.indexOf("Hotel Warszawa"));
    expect(text).toContain("2026-11-16 הוא יום מעבר");
    expect(text).toContain("ביום ההגעה (2026-11-13) התחל רק אחרי הנחיתה ב-09:30");
    expect(text).toContain("ביום החזרה (2026-11-19) הטיסה ב-21:40");
    expect(text).toContain("המראה 2026-11-19 21:40");
    expect(text).not.toContain("19:40");
  });

  it("is empty when the trip has no bookings", () => {
    expect(itineraryBookingLines([], [], days, TZ)).toBe("");
  });

  it("has no move day for one hotel", () => {
    expect(moveDays([stays[1]], days)).toEqual([]);
  });
});

describe("rows outside the trip", () => {
  const days = tripDays("2026-11-13", "2026-11-20", flights, TZ);
  const w = flightWindow(flights, TZ);

  it("drops a day after the flight home", () => {
    expect(outsideTrip({ day_date: "2026-11-20", start_time: "10:00" }, days, w)).toBe(true);
  });

  it("drops items before landing and from take-off on", () => {
    expect(outsideTrip({ day_date: "2026-11-13", start_time: "08:00" }, days, w)).toBe(true);
    expect(outsideTrip({ day_date: "2026-11-19", start_time: "22:00" }, days, w)).toBe(true);
    expect(outsideTrip({ day_date: "2026-11-19", start_time: "21:40:00" }, days, w)).toBe(true);
  });

  it("keeps ordinary items", () => {
    expect(outsideTrip({ day_date: "2026-11-13", start_time: "12:00" }, days, w)).toBe(false);
    expect(outsideTrip({ day_date: "2026-11-19", start_time: "15:00" }, days, w)).toBe(false);
    expect(outsideTrip({ day_date: "2026-11-15", start_time: null }, days, w)).toBe(false);
  });
});

describe("party", () => {
  it("two adults on a 'family' trip get no kids content", () => {
    const adults = [{ age: 45, age_range: null }, { age: null, age_range: "30-49" }];
    expect(partyKind(adults, "family")).toBe("adults");
    expect(partyLine(adults, "family")).toContain("אין ילדים");
  });

  it("a child anywhere means kids", () => {
    expect(partyKind([{ age: 40, age_range: null }, { age: null, age_range: "4-8" }], "couple")).toBe("kids");
    expect(partyKind([{ age: 12, age_range: null }], "family")).toBe("kids");
  });

  it("a couple trip with no participants listed is adults", () => {
    expect(partyKind([], "couple")).toBe("adults");
  });

  it("says nothing when it can't tell", () => {
    expect(partyKind([], "family")).toBeNull();
    expect(partyKind([{ age: 40, age_range: null }, { age: null, age_range: null }], "family")).toBeNull();
    expect(partyLine([], "family")).toBe("");
  });
});
