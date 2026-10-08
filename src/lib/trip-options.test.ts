import { describe, expect, it, vi } from "vitest";
import { daysBetween, destinationFlag, flagCountryCode, formatDayHeb, formatHeb } from "./trip-options";

describe("destinationFlag", () => {
  it("matches a city or a country anywhere in the text", () => {
    expect(destinationFlag("רומא, איטליה")).toBe("🇮🇹");
    expect(destinationFlag("סופ\"ש בבודפשט")).toBe("🇭🇺");
  });

  it("uses the place the user wrote first, not the first entry in the table", () => {
    expect(destinationFlag("מילאנו, אגם קומו, לוצרן, אינטרלאקן, ציריך וחזרה דרך מינכן")).toBe("🇮🇹");
    expect(destinationFlag("מינכן ואז מילאנו")).toBe("🇩🇪");
  });

  it("prefers the longer key when two start at the same spot", () => {
    expect(destinationFlag("סיני")).toBe("🇪🇬");
  });

  it("returns null when nothing matches", () => {
    expect(destinationFlag("יעד לא מוכר")).toBeNull();
    expect(destinationFlag("   ")).toBeNull();
    expect(destinationFlag(null)).toBeNull();
  });
});

describe("flagCountryCode", () => {
  it("decodes a flag emoji into its country code", () => {
    expect(flagCountryCode("🇮🇹")).toBe("IT");
    expect(flagCountryCode("🇺🇸")).toBe("US");
  });

  it("returns null for anything that isn't a flag", () => {
    expect(flagCountryCode("🌴")).toBeNull();
    expect(flagCountryCode("IT")).toBeNull();
    expect(flagCountryCode("")).toBeNull();
    expect(flagCountryCode(null)).toBeNull();
  });
});

describe("formatHeb / formatDayHeb", () => {
  it("shows the stored calendar day even on a phone west of Greenwich", () => {
    vi.stubEnv("TZ", "America/New_York");
    try {
      // new Date("2026-11-15") is UTC midnight, i.e. Nov 14 in New York.
      expect(formatHeb("2026-11-15")).toContain("15");
      expect(formatDayHeb("2026-11-15")).toContain("15");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("daysBetween", () => {
  it("lists every calendar day of the trip, whatever the phone's time zone", () => {
    for (const tz of ["Asia/Jerusalem", "America/New_York", "Asia/Bangkok", "Africa/Cairo"]) {
      vi.stubEnv("TZ", tz);
      try {
        expect(daysBetween("2026-10-23", "2026-10-27")).toEqual([
          "2026-10-23",
          "2026-10-24",
          "2026-10-25",
          "2026-10-26",
          "2026-10-27",
        ]);
      } finally {
        vi.unstubAllEnvs();
      }
    }
  });
});

describe("daysBetween across a daylight-saving change at midnight", () => {
  it("keeps the last day where midnight doesn't exist (Cairo, Apr 24 2026)", () => {
    vi.stubEnv("TZ", "Africa/Cairo");
    try {
      expect(daysBetween("2026-04-23", "2026-04-26")).toEqual(["2026-04-23", "2026-04-24", "2026-04-25", "2026-04-26"]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
