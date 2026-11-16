import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sanitizeScannedFlight, scanWallClock } from "../../supabase/functions/generate/scan-flight";
import { flightTimesRow } from "./flight-form";
import { zoneOf } from "../../supabase/functions/_shared/airport-zones";

function cases() {
  it("keeps the ticket's wall clock and drops any offset the model adds", () => {
    expect(scanWallClock("2026-03-28T17:00:00")).toBe("2026-03-28T17:00:00");
    expect(scanWallClock("2026-03-28T17:00")).toBe("2026-03-28T17:00:00");
    expect(scanWallClock("2026-03-28 17:00")).toBe("2026-03-28T17:00:00");
    expect(scanWallClock("2026-03-28T17:00:00+07:00")).toBe("2026-03-28T17:00:00");
    expect(scanWallClock("2026-03-28T17:00:00Z")).toBe("2026-03-28T17:00:00");
    expect(scanWallClock("28/03/2026 17:00")).toBeNull();
    expect(scanWallClock(null)).toBeNull();
  });

  it("LY84 comes out as printed, with both codes, and lands in the right zones", () => {
    const s = sanitizeScannedFlight({
      direction: "inbound",
      airline: "EL AL",
      flight_number: "LY84",
      from_airport: "Bangkok Suvarnabhumi Terminal 1",
      from_iata: "bkk",
      to_airport: "Tel Aviv (TLV) Terminal 3",
      to_iata: "TLV",
      depart_at: "2026-03-28T17:00:00+07:00",
      arrive_at: "2026-03-29T00:05:00",
    });
    expect(s).toMatchObject({
      direction: "inbound",
      from_airport: "Bangkok Suvarnabhumi (BKK)",
      from_terminal: "1",
      to_airport: "Tel Aviv (TLV)",
      to_terminal: "3",
      depart_at: "2026-03-28T17:00:00",
      arrive_at: "2026-03-29T00:05:00",
    });
    // What the import writers then store.
    expect(flightTimesRow(s, zoneOf)).toEqual({
      depart_local: "2026-03-28T17:00",
      arrive_local: "2026-03-29T00:05",
      from_tz: "Asia/Bangkok",
      to_tz: "Asia/Jerusalem",
    });
  });

  it("keeps the airport text's own code and ignores a bad one from the model", () => {
    expect(sanitizeScannedFlight({ from_airport: "Hangzhou (HGH)", from_iata: "PVG" }).from_airport).toBe("Hangzhou (HGH)");
    expect(sanitizeScannedFlight({ from_airport: "Bangkok", from_iata: "Bangkok" }).from_airport).toBe("Bangkok");
    expect(sanitizeScannedFlight({ from_airport: "Bangkok", from_iata: null }).from_airport).toBe("Bangkok");
    expect(sanitizeScannedFlight({ from_airport: null, to_iata: "CNX" }).to_airport).toBe("CNX");
  });
}

describe("scan flight sanitizer", cases);

for (const viewer of ["America/Los_Angeles", "Asia/Bangkok"]) {
  describe(`scan flight sanitizer with the process in ${viewer}`, () => {
    const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
    const saved = env.TZ;
    beforeAll(() => {
      env.TZ = viewer;
    });
    afterAll(() => {
      if (saved === undefined) delete env.TZ;
      else env.TZ = saved;
    });
    cases();
  });
}
