import { afterEach, describe, expect, it, vi } from "vitest";
import { durationHeb, flightDurationMinutes, flightEndHeb, flightStamp, isUpcomingFlight, type FlightTimes } from "./flight-display";

// Rows as migration 028 stores them: the ticket's wall clock, the airports' zones, and the
// instants the trigger derives from them.
const tlvBkk: FlightTimes = {
  depart_local: "2026-03-14T22:40:00",
  arrive_local: "2026-03-15T14:50:00",
  from_tz: "Asia/Jerusalem",
  to_tz: "Asia/Bangkok",
  depart_at: "2026-03-14T20:40:00+00:00", // IST, UTC+2
  arrive_at: "2026-03-15T07:50:00+00:00", // UTC+7
};
// LY84 lands just after midnight, on Israeli summer time (from 27.3.2026).
const ly84: FlightTimes = {
  depart_local: "2026-03-28T17:00:00",
  arrive_local: "2026-03-29T00:05:00",
  from_tz: "Asia/Bangkok",
  to_tz: "Asia/Jerusalem",
  depart_at: "2026-03-28T10:00:00+00:00",
  arrive_at: "2026-03-28T21:05:00+00:00",
};

const ZONES = ["Asia/Jerusalem", "America/Los_Angeles", "Asia/Bangkok", "UTC"];

afterEach(() => vi.unstubAllEnvs());

describe("flight display from the ticket's local times", () => {
  it.each(ZONES)("shows the same text on a phone in %s", (tz) => {
    vi.stubEnv("TZ", tz);
    expect(flightEndHeb(tlvBkk.depart_local, tlvBkk.depart_at).time).toBe("22:40");
    expect(flightEndHeb(tlvBkk.arrive_local, tlvBkk.arrive_at).time).toBe("14:50");
    expect(flightEndHeb(tlvBkk.arrive_local, tlvBkk.arrive_at).date).toContain("15");
    const landing = flightEndHeb(ly84.arrive_local, ly84.arrive_at);
    expect(landing.time).toBe("00:05");
    expect(landing.date).toContain("29");
    expect(flightStamp(ly84.arrive_local, ly84.arrive_at, "he")).toBe("29.3 00:05");
    expect(flightStamp(ly84.arrive_local, ly84.arrive_at, "en")).toBe("29 Mar 00:05");
    expect(durationHeb(flightDurationMinutes(tlvBkk))).toBe("11ש 10ד");
    expect(flightDurationMinutes(ly84)).toBe(11 * 60 + 5);
  });

  it("hides the duration when an airport's zone is unknown", () => {
    expect(flightDurationMinutes({ ...tlvBkk, to_tz: null })).toBeNull();
    expect(flightDurationMinutes({ ...tlvBkk, from_tz: null })).toBeNull();
  });

  it("still shows the ticket time when the zone is unknown", () => {
    expect(flightStamp(tlvBkk.arrive_local, tlvBkk.arrive_at, "he")).toBe("15.3 14:50");
  });

  it("falls back to the stored instant for a row without local times (pre-028)", () => {
    vi.stubEnv("TZ", "Asia/Jerusalem");
    const old: FlightTimes = { depart_at: "2026-11-13T05:00:00+00:00", arrive_at: "2026-11-13T07:30:00+00:00" };
    expect(flightEndHeb(old.depart_local, old.depart_at).time).toBe("07:00");
    expect(flightEndHeb(old.depart_local, old.depart_at).date).toContain("13");
    expect(flightStamp(old.depart_local, old.depart_at, "he")).not.toBe("");
    expect(durationHeb(flightDurationMinutes(old))).toBe("2ש 30ד");
    expect(flightEndHeb(null, null)).toEqual({ time: "", date: "" });
    expect(flightStamp(null, null, "he")).toBe("");
  });

  it("formats durations", () => {
    expect(durationHeb(45)).toBe("45ד");
    expect(durationHeb(120)).toBe("2ש");
    expect(durationHeb(null)).toBeNull();
    expect(durationHeb(0)).toBeNull();
  });
});

describe("next flight", () => {
  it("compares instants, whatever the phone's zone", () => {
    for (const tz of ZONES) {
      vi.stubEnv("TZ", tz);
      // 20:30 UTC on 28.3: LY84 has already left (10:00 UTC); TLV→BKK the year after hasn't.
      const now = new Date("2026-03-28T20:30:00Z");
      expect(isUpcomingFlight(ly84, now)).toBe(false);
      expect(isUpcomingFlight({ ...tlvBkk, depart_at: "2027-03-14T20:40:00+00:00" }, now)).toBe(true);
      expect(isUpcomingFlight({}, now)).toBe(true);
    }
  });
});
