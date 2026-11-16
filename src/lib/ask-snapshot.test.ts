import { describe, expect, it } from "vitest";
import { buildSnapshot, flightWallClock, formatWallClock } from "../../supabase/functions/ask/prompt";

// A voucher's 07:40 departure, saved from an Israeli browser, is stored as UTC.
const SUMMER = "2026-10-04T04:40:00+00:00"; // IDT, UTC+3
const WINTER = "2026-11-15T05:40:00+00:00"; // IST, UTC+2

const snapshot = (depart_at: string | null, timeZone?: unknown) =>
  buildSnapshot(
    { destination: "רומא", trip_type: "family", start_date: "2026-10-04", end_date: "2026-10-09" },
    [],
    [],
    [],
    [{ direction: "outbound", from_airport: "TLV", to_airport: "FCO", depart_at }],
    [],
    0,
    timeZone,
  );

describe("agent snapshot flight times", () => {
  it("shows the traveller's wall clock, not UTC (summer)", () => {
    const s = snapshot(SUMMER, "Asia/Jerusalem");
    expect(s).toContain("ביציאה 2026-10-04 07:40");
    expect(s).not.toContain("04:40");
  });

  it("follows the winter offset too", () => {
    expect(snapshot(WINTER, "Asia/Jerusalem")).toContain("ביציאה 2026-11-15 07:40");
  });

  it("uses the zone the client sent", () => {
    expect(snapshot(SUMMER, "Europe/Rome")).toContain("ביציאה 2026-10-04 06:40");
  });

  it("falls back to Israel time for a missing or invalid zone", () => {
    expect(snapshot(SUMMER)).toContain("ביציאה 2026-10-04 07:40");
    expect(snapshot(SUMMER, "Not/AZone")).toContain("ביציאה 2026-10-04 07:40");
  });

  it("leaves out a flight with no time", () => {
    expect(snapshot(null)).not.toContain("ביציאה");
    expect(formatWallClock("garbage")).toBeNull();
  });
});

// Migration 028: each flight carries the ticket's wall clock at its own airport. The agent
// quotes that, whatever zone the asking phone is in.
describe("agent snapshot with the ticket's local times", () => {
  const ly84 = {
    direction: "inbound",
    from_airport: "BKK",
    to_airport: "TLV",
    depart_at: "2026-03-28T10:00:00+00:00",
    arrive_at: "2026-03-28T21:05:00+00:00",
    depart_local: "2026-03-28T17:00:00",
    arrive_local: "2026-03-29T00:05:00",
  };
  const withFlight = (timeZone: unknown) =>
    buildSnapshot({ destination: "תאילנד", trip_type: "couple" }, [], [], [], [ly84], [], 0, timeZone);

  it.each(["Asia/Jerusalem", "America/Los_Angeles", "Asia/Bangkok"])("quotes the ticket times from %s", (tz) => {
    expect(withFlight(tz)).toContain("BKK → TLV ביציאה 2026-03-28 17:00, נחיתה 2026-03-29 00:05");
  });

  it("prefers the local time and falls back to the instant without one", () => {
    expect(flightWallClock("2026-03-29T00:05:00", "2026-03-28T21:05:00+00:00", "America/Los_Angeles")).toBe("2026-03-29 00:05");
    expect(flightWallClock(null, "2026-03-28T21:05:00+00:00", "Asia/Jerusalem")).toBe("2026-03-29 00:05");
    expect(flightWallClock(null, null)).toBeNull();
  });
});
