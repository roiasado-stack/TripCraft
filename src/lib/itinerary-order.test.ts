import { describe, expect, it } from "vitest";
import { sortItinerary } from "./itinerary-order";

const titles = (items: { title: string }[]) => items.map((i) => i.title);

describe("sortItinerary", () => {
  it("puts 12:00 after 09:45 even when it was added first (the public page's bug)", () => {
    const items = [
      { title: "noon", day_date: "2026-11-15", start_time: "12:00:00", sort_order: 0 },
      { title: "morning", day_date: "2026-11-15", start_time: "09:45:00", sort_order: 1 },
    ];
    expect(titles(sortItinerary(items))).toEqual(["morning", "noon"]);
  });

  it("puts items with no time first, like the app's query (nulls first)", () => {
    const items = [
      { title: "timed", day_date: "2026-11-15", start_time: "08:00:00", sort_order: 0 },
      { title: "untimed", day_date: "2026-11-15", start_time: null, sort_order: 5 },
      { title: "blank", day_date: "2026-11-15", start_time: "", sort_order: 6 },
    ];
    expect(titles(sortItinerary(items))).toEqual(["untimed", "blank", "timed"]);
  });

  it("orders by day before time", () => {
    const items = [
      { title: "day 2 early", day_date: "2026-11-16", start_time: "07:00:00", sort_order: 0 },
      { title: "day 1 late", day_date: "2026-11-15", start_time: "22:00:00", sort_order: 0 },
    ];
    expect(titles(sortItinerary(items))).toEqual(["day 1 late", "day 2 early"]);
  });

  it("breaks a time tie by sort_order", () => {
    const items = [
      { title: "second", day_date: "2026-11-15", start_time: "10:00:00", sort_order: 2 },
      { title: "first", day_date: "2026-11-15", start_time: "10:00:00", sort_order: 1 },
    ];
    expect(titles(sortItinerary(items))).toEqual(["first", "second"]);
  });

  it("keeps the arrival order on a tie when sort_order is absent (get_shared_trip rows)", () => {
    const items = [
      { title: "a", day_date: "2026-11-15", start_time: null },
      { title: "b", day_date: "2026-11-15", start_time: null },
    ];
    expect(titles(sortItinerary(items))).toEqual(["a", "b"]);
  });

  it("doesn't change the array it was given", () => {
    const items = [
      { title: "late", day_date: "2026-11-16", start_time: null },
      { title: "early", day_date: "2026-11-15", start_time: null },
    ];
    sortItinerary(items);
    expect(titles(items)).toEqual(["late", "early"]);
  });
});
