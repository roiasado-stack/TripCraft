import { describe, expect, it, vi } from "vitest";
import { formatDateEn, formatDateTimeEn, formatDayEn, isEnglishShare, SHARE_EN, SUGGESTION_KINDS_EN } from "./share-english";
import { SUGGESTION_KINDS } from "./trip-options";

describe("isEnglishShare", () => {
  it("is English only for lang=en", () => {
    expect(isEnglishShare("?lang=en")).toBe(true);
    expect(isEnglishShare("?utm=x&lang=EN")).toBe(true);
    expect(isEnglishShare("")).toBe(false);
    expect(isEnglishShare("?lang=he")).toBe(false);
    expect(isEnglishShare("?lang=english")).toBe(false);
  });
});

describe("English dates", () => {
  it("shows the stored calendar day even on a phone west of Greenwich", () => {
    vi.stubEnv("TZ", "America/New_York");
    try {
      expect(formatDateEn("2026-11-15")).toBe("15 Nov 2026");
      expect(formatDayEn("2026-11-15")).toBe("Sunday 15 November");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("returns nothing for a missing or broken value", () => {
    expect(formatDateEn(null)).toBe("");
    expect(formatDateTimeEn("not a date")).toBe("");
  });
});

describe("SHARE_EN", () => {
  it("has an English label for every suggestion kind", () => {
    for (const k of SUGGESTION_KINDS) expect(SUGGESTION_KINDS_EN[k.value]).toBeTruthy();
  });

  it("contains no Hebrew", () => {
    const text = JSON.stringify(SHARE_EN) + SHARE_EN.days(5) + SHARE_EN.day(2) + SHARE_EN.showAllUpdates(4);
    expect(text).not.toMatch(/[֐-׿]/);
  });
});
