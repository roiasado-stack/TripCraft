import { describe, expect, it } from "vitest";
import {
  atTripLimit,
  parseTripQuota,
  PRIVATE_TRIP_LIMIT_MESSAGE,
  SAMPLE_TRIP_LIMIT_MESSAGE,
  tripLimitMessage,
} from "./trip-quota";
import { TRIP_LIMIT_MESSAGE } from "./trip-drafts";

describe("parseTripQuota", () => {
  it("reads the RPC's JSON", () => {
    expect(parseTripQuota({ limit: 1, used: 0, has_sample: false })).toEqual({ limit: 1, used: 0, has_sample: false });
    expect(parseTripQuota({ limit: null, used: 7, has_sample: true })).toEqual({ limit: null, used: 7, has_sample: true });
  });
  it("rejects anything else", () => {
    expect(parseTripQuota(null)).toBeNull();
    expect(parseTripQuota([])).toBeNull();
    expect(parseTripQuota("x")).toBeNull();
    expect(parseTripQuota({ limit: 1 })).toBeNull();
    expect(parseTripQuota({ limit: "a", used: 0 })).toBeNull();
    expect(parseTripQuota({ limit: 1.5, used: 0 })).toBeNull();
  });
});

describe("atTripLimit", () => {
  it("is true only for a known, full private account", () => {
    expect(atTripLimit({ limit: 1, used: 1, has_sample: false })).toBe(true);
    expect(atTripLimit({ limit: 1, used: 2, has_sample: false })).toBe(true);
    expect(atTripLimit({ limit: 0, used: 0, has_sample: false })).toBe(true);
    expect(atTripLimit({ limit: 1, used: 0, has_sample: true })).toBe(false);
    expect(atTripLimit({ limit: 3, used: 2, has_sample: false })).toBe(false);
  });
  it("never blocks an agent, an admin, a demo visitor, or an unknown quota", () => {
    expect(atTripLimit({ limit: null, used: 40, has_sample: false })).toBe(false);
    expect(atTripLimit(null)).toBe(false);
    expect(atTripLimit(undefined)).toBe(false);
  });
});

describe("tripLimitMessage", () => {
  it("maps each trigger's error to its own message", () => {
    expect(tripLimitMessage({ message: "private_trip_limit_reached", code: "23514" })).toBe(PRIVATE_TRIP_LIMIT_MESSAGE);
    expect(tripLimitMessage(new Error("trips: sample_trip_limit_reached"))).toBe(SAMPLE_TRIP_LIMIT_MESSAGE);
    expect(tripLimitMessage({ message: "agent_trip_limit_reached", code: "23514" })).toBe(TRIP_LIMIT_MESSAGE);
  });
  it("is null for other errors", () => {
    expect(tripLimitMessage({ message: "network down" })).toBeNull();
    expect(tripLimitMessage("private_trip_limit_reached")).toBeNull();
    expect(tripLimitMessage(null)).toBeNull();
  });
  it("the private message names the contact email", () => {
    expect(PRIVATE_TRIP_LIMIT_MESSAGE).toContain("@gmail.com");
  });
});
