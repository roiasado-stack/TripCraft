import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  flightMinutes,
  formatFlightClock,
  iataOf,
  instantToWall,
  isValidZone,
  loadZoneOf,
  parseWallClock,
  wallToInstant,
} from "../../supabase/functions/_shared/flight-time";
import { zoneOf } from "../../supabase/functions/_shared/airport-zones";
import { AIRPORT_ZONES } from "../../supabase/functions/_shared/airport-zones.data";

const J = "Asia/Jerusalem";
const iso = (d: Date | null) => d?.toISOString() ?? null;

describe("iataOf", () => {
  it.each([
    ["BKK", "BKK"],
    ["bkk", "BKK"],
    ["  tlv ", "TLV"],
    ["Bangkok (BKK)", "BKK"],
    ["Hangzhou (HGH)", "HGH"],
    ["bangkok (bkk)", "BKK"],
    ["Hanoi [HAN]", "HAN"],
    ["Tel Aviv TLV", "TLV"],
    ["TLV - Tel Aviv", "TLV"],
    ["BKK – Bangkok Suvarnabhumi", "BKK"],
    ["תל אביב (TLV)", "TLV"],
    ['נתב"ג', "TLV"],
    ["נתב״ג", "TLV"],
    ["נתבג", "TLV"],
    ["בן גוריון", "TLV"],
    ["נמל התעופה בן-גוריון", "TLV"],
    ["Ben Gurion Airport", "TLV"],
    ["Ben-Gurion", "TLV"],
    ["Hanoi (HAN), Vietnam", "HAN"],
  ])("%s → %s", (text, code) => {
    expect(iataOf(text)).toBe(code);
  });

  it.each([
    ["Bangkok"], // two airports — never guessed from a city
    ["Tel Aviv"],
    ["Chiang Mai"],
    ["New York, USA"],
    ["USA"],
    ["Paris CDG or ORY"],
    ["Bangkok (BKK) (DMK)"],
    ["tel aviv tlv"], // lower-case words inside text are not codes
    ["BKKK"],
    [""],
    ["   "],
  ])("%s → null", (text) => {
    expect(iataOf(text)).toBeNull();
  });

  it("ignores non-strings", () => {
    expect(iataOf(null)).toBeNull();
    expect(iataOf(undefined)).toBeNull();
    expect(iataOf(42)).toBeNull();
  });
});

describe("zoneOf", () => {
  it.each([
    ["TLV", "Asia/Jerusalem"],
    ["ETM", "Asia/Jerusalem"], // mwgg says Asia/Amman; the generator corrects it by country
    ["BKK", "Asia/Bangkok"],
    ["DMK", "Asia/Bangkok"],
    ["CNX", "Asia/Bangkok"],
    ["HKT", "Asia/Bangkok"],
    ["HAN", "Asia/Ho_Chi_Minh"], // mwgg says Asia/Bangkok; Vietnam's own zone wins
    ["SGN", "Asia/Ho_Chi_Minh"],
    ["DAD", "Asia/Ho_Chi_Minh"],
    ["WAW", "Europe/Warsaw"],
    ["LHR", "Europe/London"],
    ["JFK", "America/New_York"],
    ["HGH", "Asia/Shanghai"],
  ])("%s → %s", (code, zone) => {
    expect(zoneOf(code)).toBe(zone);
  });

  it("is case-insensitive and null when unknown", () => {
    expect(zoneOf("bkk")).toBe("Asia/Bangkok");
    expect(zoneOf("QQQ")).toBeNull();
    expect(zoneOf("Bangkok")).toBeNull();
    expect(zoneOf(null)).toBeNull();
    expect(zoneOf(iataOf("Bangkok (BKK)"))).toBe("Asia/Bangkok");
  });

  it("loads lazily through loadZoneOf", async () => {
    const lazy = await loadZoneOf();
    expect(lazy("TLV")).toBe(J);
  });

  it("data: every zone is valid, every code three letters and listed once", () => {
    const seen = new Set<string>();
    for (const [zone, codes] of Object.entries(AIRPORT_ZONES)) {
      expect(isValidZone(zone), zone).toBe(true);
      for (const c of codes.split(" ")) {
        expect(c).toMatch(/^[A-Z]{3}$/);
        expect(seen.has(c), c).toBe(false);
        seen.add(c);
      }
    }
    expect(seen.size).toBeGreaterThan(3500);
  });
});

describe("parseWallClock", () => {
  it("accepts ticket times and rejects instants and impossible dates", () => {
    expect(parseWallClock("2026-03-29T00:05")).toEqual({ year: 2026, month: 3, day: 29, hour: 0, minute: 5 });
    expect(parseWallClock("2026-03-29 00:05:00")).toEqual({ year: 2026, month: 3, day: 29, hour: 0, minute: 5 });
    expect(parseWallClock("2026-03-28T21:05:00+00:00")).toBeNull();
    expect(parseWallClock("2026-03-28T21:05:00Z")).toBeNull();
    expect(parseWallClock("2026-04-31T10:00")).toBeNull();
    expect(parseWallClock("2026-02-29T10:00")).toBeNull();
    expect(parseWallClock("2028-02-29T10:00")).not.toBeNull();
    expect(parseWallClock("2026-03-29T24:00")).toBeNull();
    expect(parseWallClock("2026-03-29")).toBeNull();
  });
});

describe("wallToInstant / instantToWall", () => {
  it("converts ordinary times", () => {
    expect(iso(wallToInstant("2026-03-12T22:40", J))).toBe("2026-03-12T20:40:00.000Z");
    expect(iso(wallToInstant("2026-03-13T14:50", "Asia/Bangkok"))).toBe("2026-03-13T07:50:00.000Z");
    expect(instantToWall("2026-03-28T21:05:00+00:00", J)).toBe("2026-03-29T00:05");
    expect(instantToWall(new Date("2026-03-13T07:50:00Z"), "Asia/Bangkok")).toBe("2026-03-13T14:50");
  });

  it("rejects bad input", () => {
    expect(wallToInstant("2026-03-12T22:40", "Mars/Olympus")).toBeNull();
    expect(wallToInstant("2026-03-12T22:40", null)).toBeNull();
    expect(wallToInstant("yesterday", J)).toBeNull();
    expect(instantToWall("not a date", J)).toBeNull();
    expect(instantToWall(Date.now(), "Mars/Olympus")).toBeNull();
  });

  describe("Israel DST (2026: forward Fri 27.3 02:00, back Sun 25.10 02:00)", () => {
    it("spring forward: last minute before, first after, and the gap moves forward", () => {
      expect(iso(wallToInstant("2026-03-27T01:59", J))).toBe("2026-03-26T23:59:00.000Z");
      expect(iso(wallToInstant("2026-03-27T03:00", J))).toBe("2026-03-27T00:00:00.000Z");
      // 02:30 never happens; it becomes 03:30 IDT.
      expect(iso(wallToInstant("2026-03-27T02:30", J))).toBe("2026-03-27T00:30:00.000Z");
      expect(instantToWall(wallToInstant("2026-03-27T02:30", J)!, J)).toBe("2026-03-27T03:30");
    });

    it("fall back: an hour that happens twice resolves to the first (summer) one", () => {
      expect(iso(wallToInstant("2026-10-25T01:30", J))).toBe("2026-10-24T22:30:00.000Z");
      expect(instantToWall("2026-10-24T23:30:00Z", J)).toBe("2026-10-25T01:30"); // the second 01:30
      expect(iso(wallToInstant("2026-10-25T02:30", J))).toBe("2026-10-25T00:30:00.000Z");
    });
  });

  describe("Europe DST (Warsaw, 2026: 29.3 and 25.10)", () => {
    const W = "Europe/Warsaw";
    it("gap and overlap", () => {
      expect(iso(wallToInstant("2026-03-29T01:59", W))).toBe("2026-03-29T00:59:00.000Z");
      expect(iso(wallToInstant("2026-03-29T02:30", W))).toBe("2026-03-29T01:30:00.000Z");
      expect(iso(wallToInstant("2026-03-29T03:00", W))).toBe("2026-03-29T01:00:00.000Z");
      expect(iso(wallToInstant("2026-10-25T02:30", W))).toBe("2026-10-25T00:30:00.000Z");
      expect(iso(wallToInstant("2026-10-25T03:30", W))).toBe("2026-10-25T02:30:00.000Z");
    });
  });

  describe("US DST (New York, 2026: 8.3 and 1.11)", () => {
    const NY = "America/New_York";
    it("gap and overlap", () => {
      expect(iso(wallToInstant("2026-03-08T01:59", NY))).toBe("2026-03-08T06:59:00.000Z");
      expect(iso(wallToInstant("2026-03-08T02:30", NY))).toBe("2026-03-08T07:30:00.000Z");
      expect(iso(wallToInstant("2026-11-01T01:30", NY))).toBe("2026-11-01T05:30:00.000Z");
      expect(iso(wallToInstant("2026-11-01T02:30", NY))).toBe("2026-11-01T07:30:00.000Z");
    });
  });

  it("round-trips ordinary ticket times", () => {
    const cases: [string, string][] = [
      ["2026-03-12T22:40", J],
      ["2026-03-29T00:05", J],
      ["2026-03-13T14:50", "Asia/Bangkok"],
      ["2026-07-01T06:15", "Asia/Ho_Chi_Minh"],
      ["2026-12-31T23:59", "America/Los_Angeles"],
      ["2026-06-15T12:00", "Asia/Kolkata"],
      ["2026-01-01T00:00", "Pacific/Chatham"],
    ];
    for (const [wall, zone] of cases) {
      expect(instantToWall(wallToInstant(wall, zone)!, zone)).toBe(wall);
    }
  });

  it("wall → instant → wall is stable for every half hour of 2026 in Jerusalem, Warsaw and New York", () => {
    for (const zone of [J, "Europe/Warsaw", "America/New_York"]) {
      for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 30 * 60_000) {
        const wall = instantToWall(t, zone)!;
        expect(instantToWall(wallToInstant(wall, zone)!, zone)).toBe(wall);
      }
    }
  });
});

describe("formatFlightClock", () => {
  it("formats the ticket time as printed", () => {
    expect(formatFlightClock("2026-03-29T00:05", "he")).toBe("29.3 00:05");
    expect(formatFlightClock("2026-03-29T00:05:00", "en")).toBe("29 Mar 00:05");
    expect(formatFlightClock("2026-12-01T23:59", "he")).toBe("1.12 23:59");
    expect(formatFlightClock("2026-03-28T21:05:00+00:00", "he")).toBeNull();
    expect(formatFlightClock(null, "he")).toBeNull();
  });

  it("LY84: BKK → TLV landing 29.3 00:05 local shows 29.3 00:05", () => {
    // The row's instant is 28.3 21:05 UTC; the ticket time comes from the arrival zone.
    const local = instantToWall("2026-03-28T21:05:00+00:00", zoneOf("TLV"));
    expect(local).toBe("2026-03-29T00:05");
    expect(formatFlightClock(local, "he")).toBe("29.3 00:05");
  });
});

describe("flightMinutes", () => {
  const m = (dep: string, from: string, arr: string, to: string) =>
    flightMinutes(dep, zoneOf(from), arr, zoneOf(to));

  it("TLV 22:40 → BKK 14:50 next day (March, before Israeli DST) is 11h10", () => {
    expect(m("2026-03-12T22:40", "TLV", "2026-03-13T14:50", "BKK")).toBe(11 * 60 + 10);
  });

  it("the same ticket after Israel moved to summer time is an hour longer", () => {
    expect(m("2026-03-27T22:40", "TLV", "2026-03-28T14:50", "BKK")).toBe(12 * 60 + 10);
  });

  it("a flight that departs before Israel's clock change and lands after it", () => {
    // 26.3 23:00 IST = 21:00Z; 11h10 later is 27.3 08:10Z = 15:10 in Bangkok.
    expect(m("2026-03-26T23:00", "TLV", "2026-03-27T15:10", "BKK")).toBe(11 * 60 + 10);
  });

  it("Vietnam + Thailand legs (illustrative block times)", () => {
    expect(m("2026-03-14T10:00", "BKK", "2026-03-14T11:10", "CNX")).toBe(70); // domestic, same zone
    expect(m("2026-03-16T12:30", "CNX", "2026-03-16T14:25", "HAN")).toBe(115); // TH → VN, both UTC+7
    expect(m("2026-03-19T08:00", "HAN", "2026-03-19T09:20", "DAD")).toBe(80);
    expect(m("2026-03-22T11:10", "DAD", "2026-03-22T12:35", "SGN")).toBe(85);
    expect(m("2026-03-24T09:40", "SGN", "2026-03-24T11:10", "HKT")).toBe(90);
    expect(m("2026-03-27T13:00", "HKT", "2026-03-27T14:25", "BKK")).toBe(85);
    // LY84 home: BKK 28.3 16:05 (+7) → TLV 29.3 00:05 (+3 after 27.3) = 12h00.
    expect(m("2026-03-28T16:05", "BKK", "2026-03-29T00:05", "TLV")).toBe(12 * 60);
  });

  it("WAW 21:40 → TLV crosses a one-hour zone difference", () => {
    // Warsaw CET (+1) until 29.3; Israel IST (+2) until 27.3 → 20:40Z to 00:30Z.
    expect(m("2026-03-10T21:40", "WAW", "2026-03-11T02:30", "TLV")).toBe(3 * 60 + 50);
  });

  it("hides the duration when a zone is unknown or the result is nonsense", () => {
    expect(flightMinutes("2026-03-12T22:40", null, "2026-03-13T14:50", "Asia/Bangkok")).toBeNull();
    expect(flightMinutes("2026-03-12T22:40", J, "2026-03-13T14:50", zoneOf("QQQ"))).toBeNull();
    expect(flightMinutes("2026-03-12T22:40", J, "2026-03-12T21:40", J)).toBeNull();
    expect(flightMinutes("bad", J, "2026-03-12T21:40", J)).toBeNull();
  });
});

// The device zone must never leak in. Node honours a runtime change of process.env.TZ, so
// re-run the bug cases with the viewer in Los Angeles and in Bangkok.
for (const viewer of ["America/Los_Angeles", "Asia/Bangkok"]) {
  describe(`with the process in ${viewer}`, () => {
    const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
    const saved = env.TZ;
    beforeAll(() => {
      env.TZ = viewer;
    });
    afterAll(() => {
      if (saved === undefined) delete env.TZ;
      else env.TZ = saved;
    });

    it("the process zone really changed", () => {
      // Mid-winter offset: LA is UTC-8 (480), Bangkok UTC+7 (-420).
      expect(new Date(Date.UTC(2026, 0, 15, 12)).getTimezoneOffset()).toBe(viewer === "Asia/Bangkok" ? -420 : 480);
    });

    it("LY84 still shows 29.3 00:05 and TLV → BKK is still 11h10", () => {
      expect(formatFlightClock(instantToWall("2026-03-28T21:05:00+00:00", J), "he")).toBe("29.3 00:05");
      expect(iso(wallToInstant("2026-03-29T00:05", J))).toBe("2026-03-28T21:05:00.000Z");
      expect(flightMinutes("2026-03-12T22:40", J, "2026-03-13T14:50", "Asia/Bangkok")).toBe(670);
      expect(iso(wallToInstant("2026-03-27T02:30", J))).toBe("2026-03-27T00:30:00.000Z");
    });
  });
}
