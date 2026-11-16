import { describe, expect, it } from "vitest";
import {
  dayShift,
  shiftDate,
  templateChecklist,
  templateItinerary,
  templateStays,
  templateSuggestions,
  templateTrip,
} from "./trip-template";

describe("shiftDate", () => {
  it("moves across month and year ends", () => {
    expect(shiftDate("2026-12-20", 15)).toBe("2027-01-04");
    expect(shiftDate("2027-03-01", -1)).toBe("2027-02-28");
    expect(shiftDate("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("keeps the day at 0 and returns null for empty or invalid", () => {
    expect(shiftDate("2026-11-15", 0)).toBe("2026-11-15");
    expect(shiftDate(null, 5)).toBeNull();
    expect(shiftDate("", 5)).toBeNull();
    expect(shiftDate("not a date", 5)).toBeNull();
  });
});

describe("dayShift", () => {
  it("counts calendar days, including across DST", () => {
    expect(dayShift("2026-11-15", "2026-12-15")).toBe(30);
    expect(dayShift("2027-03-20", "2027-04-03")).toBe(14);
    expect(dayShift("2026-11-15", "2026-11-01")).toBe(-14);
  });
  it("is 0 when either date is missing", () => {
    expect(dayShift(null, "2026-12-15")).toBe(0);
    expect(dayShift("2026-11-15", "")).toBe(0);
  });
});

const T = "new-trip";

describe("templateTrip", () => {
  it("drops notes, guide, sharing and owner; shifts dates", () => {
    const out = templateTrip(
      {
        id: "old", user_id: "u1", title: "קרקוב", destination: "Krakow", start_date: "2026-11-13",
        end_date: "2026-11-19", trip_type: "couple", budget_level: "mid", cover_emoji: "🏰",
        notes: "דרכון של משה בכספת", guide_name: "Anna", guide_phone: "+48", is_shared: true,
        share_slug: "abc", is_showcase: true,
      },
      7,
    );
    expect(out).toEqual({
      title: "קרקוב (עותק)", destination: "Krakow", trip_type: "couple", budget_level: "mid",
      cover_emoji: "🏰", start_date: "2026-11-20", end_date: "2026-11-26",
    });
  });
});

describe("templateStays", () => {
  it("keeps the hotel, drops booking ref, notes and ids", () => {
    const [s] = templateStays(
      [{ id: "s1", trip_id: "old", hotel_name: "Hilton", address: "Main 1", phone: "1", url: "u",
         map_url: "m", check_in: "2026-11-13", check_out: "2026-11-16", booking_ref: "ABC123",
         notes: "חדר למשפחת כהן", created_at: "x" }],
      T, 30,
    );
    expect(s).toEqual({
      hotel_name: "Hilton", address: "Main 1", phone: "1", url: "u", map_url: "m",
      trip_id: T, check_in: "2026-12-13", check_out: "2026-12-16",
    });
  });
});

describe("templateItinerary / templateSuggestions", () => {
  it("copies content with shifted days and no ids or authors", () => {
    const [i] = templateItinerary(
      [{ id: "i1", trip_id: "old", day_date: "2026-11-14", start_time: "09:00", title: "וויליצ'קה",
         created_by: "u9", created_at: "x", sort_order: 2 }],
      T, -1,
    );
    expect(i).toEqual({ start_time: "09:00", title: "וויליצ'קה", sort_order: 2, trip_id: T, day_date: "2026-11-13" });
    const [g] = templateSuggestions([{ id: "g", trip_id: "old", title: "מוזיאון", liked: true }], T);
    expect(g).toEqual({ title: "מוזיאון", trip_id: T });
  });
});

describe("templateChecklist", () => {
  it("keeps group items only, unticked", () => {
    const out = templateChecklist(
      [
        { id: "a", trip_id: "old", title: "מתאם חשמל", is_shared: true, is_done: true, participant_id: null },
        { id: "b", trip_id: "old", title: "דרכון של דנה", is_shared: false, is_done: false, participant_id: "p1" },
      ],
      T,
    );
    expect(out).toEqual([{ title: "מתאם חשמל", is_shared: true, trip_id: T, is_done: false }]);
  });
});
