import { describe, expect, it } from "vitest";
import {
  chunkPromptLines,
  itineraryScope,
  partsWithinBudget,
  planItineraryChunks,
  type ItineraryChunk,
} from "../../supabase/functions/generate/chunks";
import { addDays, dayRange, moveDays, tripDays, type FlightRow, type StayRow } from "../../supabase/functions/generate/bookings";

const TZ = "Asia/Jerusalem";
const days = (c: ItineraryChunk[]) => c.map((x) => x.days);
const sizes = (c: ItineraryChunk[]) => c.map((x) => x.days.length);
const breaksFor = (stays: StayRow[], all: string[]) => moveDays(stays, all).map((m) => m.day);

describe("which days the AI plans", () => {
  const trip = dayRange("2027-02-01", "2027-02-05");

  it("plans every day when the itinerary is empty", () => {
    expect(itineraryScope(trip, [])).toEqual({ planDays: trip, allPlanned: false });
  });

  it("plans only the days without items", () => {
    expect(itineraryScope(trip, ["2027-02-02", "2027-02-02", "2027-02-04"])).toEqual({
      planDays: ["2027-02-01", "2027-02-03", "2027-02-05"],
      allPlanned: false,
    });
  });

  it("switches to adding a few items when every day is taken", () => {
    expect(itineraryScope(trip, trip)).toEqual({ planDays: [], allPlanned: true });
  });

  it("items without a day don't count as a planned day", () => {
    expect(itineraryScope(trip, [null, undefined])).toEqual({ planDays: trip, allPlanned: false });
  });

  it("keeps today's rule for trips without dates", () => {
    expect(itineraryScope([], ["2027-02-01"])).toEqual({ planDays: [], allPlanned: true });
    expect(itineraryScope([], [])).toEqual({ planDays: [], allPlanned: false });
  });
});

describe("splitting a long itinerary", () => {
  it("leaves a week or less as one call", () => {
    const week = dayRange("2027-02-01", "2027-02-07");
    expect(planItineraryChunks(week, ["2027-02-04"])).toEqual({
      chunks: [{ days: week, stayFromPrevious: false, stayIntoNext: false }],
      deferred: [],
    });
    expect(planItineraryChunks([], [])).toEqual({ chunks: [], deferred: [] });
  });

  // The pilot trip (PR #42): Phuket 7 nights, Samui 4, Pattaya 3, Bangkok 3, home on day 18.
  it("cuts the 18-day Thailand trip only where the hotel changes", () => {
    const leg = (direction: string, depart: string, arrive: string): FlightRow => ({
      direction,
      from_airport: null,
      to_airport: null,
      depart_at: `${depart}:00+02:00`,
      arrive_at: `${arrive}:00+02:00`,
    });
    const flights = [
      leg("outbound", "2027-02-01T08:40", "2027-02-01T17:55"),
      leg("outbound", "2027-02-08T12:55", "2027-02-08T13:50"),
      leg("outbound", "2027-02-12T11:10", "2027-02-12T12:20"),
      leg("inbound", "2027-02-18T20:50", "2027-02-19T00:40"),
    ];
    const stays: StayRow[] = [
      { hotel_name: "Beach Phuket", address: "Patong", check_in: "2027-02-01", check_out: "2027-02-08" },
      { hotel_name: "Resort Samui", address: "Koh Samui", check_in: "2027-02-08", check_out: "2027-02-12" },
      { hotel_name: "Hotel Pattaya", address: "Pattaya", check_in: "2027-02-12", check_out: "2027-02-15" },
      { hotel_name: "Hotel Bangkok", address: "Bangkok", check_in: "2027-02-15", check_out: "2027-02-18" },
    ];
    const all = tripDays("2027-02-01", "2027-02-19", flights, TZ);
    expect(all).toHaveLength(18);
    const { chunks, deferred } = planItineraryChunks(all, breaksFor(stays, all));
    expect(days(chunks)).toEqual([
      dayRange("2027-02-01", "2027-02-07"), // Phuket
      dayRange("2027-02-08", "2027-02-14"), // Samui + Pattaya
      dayRange("2027-02-15", "2027-02-18"), // Bangkok
    ]);
    expect(chunks.every((c) => !c.stayFromPrevious && !c.stayIntoNext)).toBe(true);
    expect(deferred).toEqual([]);
  });

  it("gives each of 4 stays on a 21-day trip its own part", () => {
    const stays: StayRow[] = [
      { hotel_name: "A", address: "Chiang Mai", check_in: "2027-03-01", check_out: "2027-03-07" },
      { hotel_name: "B", address: "Bangkok", check_in: "2027-03-07", check_out: "2027-03-12" },
      { hotel_name: "C", address: "Krabi", check_in: "2027-03-12", check_out: "2027-03-17" },
      { hotel_name: "D", address: "Phuket", check_in: "2027-03-17", check_out: "2027-03-21" },
    ];
    const all = dayRange("2027-03-01", "2027-03-21");
    const { chunks } = planItineraryChunks(all, breaksFor(stays, all));
    expect(sizes(chunks)).toEqual([6, 5, 5, 5]);
    expect(chunks.map((c) => c.days[0])).toEqual(["2027-03-01", "2027-03-07", "2027-03-12", "2027-03-17"]);
  });

  it("splits one long stay evenly and marks the parts as the same place", () => {
    const { chunks } = planItineraryChunks(dayRange("2027-04-01", "2027-04-15"), []);
    expect(sizes(chunks)).toEqual([5, 5, 5]);
    expect(chunks.map((c) => [c.stayFromPrevious, c.stayIntoNext])).toEqual([
      [false, true],
      [true, true],
      [true, false],
    ]);
    expect(sizes(planItineraryChunks(dayRange("2027-04-01", "2027-04-10"), []).chunks)).toEqual([5, 5]);
  });

  it("cuts at the next day to plan when the hotel changes on a day that's already planned", () => {
    const plan = dayRange("2027-05-01", "2027-05-10").filter((d) => d !== "2027-05-05");
    const { chunks } = planItineraryChunks(plan, ["2027-05-05"]);
    expect(days(chunks)).toEqual([
      ["2027-05-01", "2027-05-02", "2027-05-03", "2027-05-04"],
      ["2027-05-06", "2027-05-07", "2027-05-08", "2027-05-09", "2027-05-10"],
    ]);
    expect(chunks[1].stayFromPrevious).toBe(false);
  });

  it("packs short stays together but never splits one to fill a part", () => {
    // Four stays of 3 days: 12 days → two parts of two whole stays each.
    const all = dayRange("2027-06-01", "2027-06-12");
    const breaks = ["2027-06-04", "2027-06-07", "2027-06-10"];
    const { chunks } = planItineraryChunks(all, breaks);
    expect(sizes(chunks)).toEqual([6, 6]);
    expect(chunks.every((c) => !c.stayFromPrevious && !c.stayIntoNext)).toBe(true);
  });

  it("plans at most 5 parts per request and hands the rest back", () => {
    const all = dayRange("2027-07-01", "2027-08-09"); // 40 days, one stay
    const { chunks, deferred } = planItineraryChunks(all, []);
    expect(chunks).toHaveLength(5);
    expect(chunks.every((c) => c.days.length <= 7)).toBe(true);
    expect([...chunks.flatMap((c) => c.days), ...deferred]).toEqual(all);
    expect(deferred[deferred.length - 1]).toBe("2027-08-09");
    expect(chunks[4].stayIntoNext).toBe(true);
  });

  it("covers every day exactly once, in order, whatever the input order", () => {
    const all = dayRange("2027-09-01", "2027-09-23");
    const shuffled = [...all].reverse().concat(all.slice(0, 3));
    const { chunks, deferred } = planItineraryChunks(shuffled, ["2027-09-09", addDays("2027-09-09", 6)]);
    expect([...chunks.flatMap((c) => c.days), ...deferred]).toEqual(all);
    expect(chunks.every((c) => c.days.length <= 7)).toBe(true);
  });
});

describe("parts within the caller's remaining budget", () => {
  it("gives a demo visitor (0.10 $ a day) one part", () => {
    expect(partsWithinBudget(0.1, 0.06)).toBe(1);
  });

  it("gives a fresh user all 5 and a nearly-spent one fewer", () => {
    expect(partsWithinBudget(2, 0.06)).toBe(5);
    expect(partsWithinBudget(0.13, 0.06)).toBe(2);
    expect(partsWithinBudget(0.01, 0.06)).toBe(1);
  });

  it("fails closed on an unreadable budget", () => {
    expect(partsWithinBudget(NaN, 0.06)).toBe(1);
    expect(partsWithinBudget(Infinity, 0.06)).toBe(5);
  });

  it("one part with days left over plans only its own days", () => {
    const { chunks, deferred } = planItineraryChunks(dayRange("2027-03-01", "2027-03-21"), [], { maxChunks: 1 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].days).toHaveLength(7);
    expect(deferred).toHaveLength(14);
  });
});

describe("prompt lines for one part", () => {
  const part = (stayFromPrevious: boolean, stayIntoNext: boolean): ItineraryChunk => ({
    days: ["2027-04-06", "2027-04-07"],
    stayFromPrevious,
    stayIntoNext,
  });

  it("names only this part's days", () => {
    const text = chunkPromptLines(part(false, false));
    expect(text).toContain("תכנן רק את הימים: 2027-04-06, 2027-04-07");
    expect(text.split("\n")).toHaveLength(1);
  });

  it("gives a split stay's parts different kinds of places", () => {
    expect(chunkPromptLines(part(false, true))).toContain("התמקד באטרקציות המרכזיות");
    expect(chunkPromptLines(part(true, false))).toContain("העדף טיולי יום");
    expect(chunkPromptLines(part(true, true))).toContain("שכונות, שווקים ומקומות פחות מוכרים");
  });
});
