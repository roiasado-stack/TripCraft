import { describe, expect, it } from "vitest";
import { destinationFlag, flagCountryCode } from "./trip-options";

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
