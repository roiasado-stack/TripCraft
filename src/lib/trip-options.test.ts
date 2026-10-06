import { describe, expect, it } from "vitest";
import { destinationFlag, flagCountryCode, formatDayHeb, formatHeb } from "./trip-options";

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
    const saved = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      // new Date("2026-11-15") is UTC midnight, i.e. Nov 14 in New York.
      expect(formatHeb("2026-11-15")).toContain("15");
      expect(formatDayHeb("2026-11-15")).toContain("15");
    } finally {
      process.env.TZ = saved;
    }
  });
});
