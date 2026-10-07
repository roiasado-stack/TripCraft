import { describe, expect, it, vi } from "vitest";
import { normDate, normTime } from "./import-itinerary";
import { normAge, normPreferences, parseParticipants } from "./import-participants";

describe("normDate", () => {
  it("reads Israeli day-first dates", () => {
    expect(normDate("05/10/2026")).toBe("2026-10-05");
    expect(normDate("5.10.26")).toBe("2026-10-05");
  });

  it("keeps ISO dates", () => {
    expect(normDate("2026-10-05")).toBe("2026-10-05");
  });

  it("rejects impossible dates", () => {
    expect(normDate("32/01/2026")).toBeNull();
    expect(normDate("01/13/2026")).toBeNull();
    expect(normDate("")).toBeNull();
  });
});

describe("normTime", () => {
  it("reads common formats and takes the start of a range", () => {
    expect(normTime("9:30")).toBe("09:30");
    expect(normTime("0930")).toBe("09:30");
    expect(normTime("09:30-11:00")).toBe("09:30");
  });

  it("rejects impossible times", () => {
    expect(normTime("25:00")).toBeNull();
    expect(normTime("10:75")).toBeNull();
  });
});

describe("participants import", () => {
  it("maps Hebrew preference words", () => {
    expect(normPreferences("כשר, צמחונות")).toEqual(["kosher", "vegetarian"]);
  });

  it("rejects ages that are not plain numbers in range", () => {
    expect(normAge("40")).toBe(40);
    expect(normAge("121")).toBeNull();
    expect(normAge("forty")).toBeNull();
  });

  it("reports empty input in Hebrew instead of throwing", () => {
    const r = parseParticipants("   ");
    expect(r.items).toEqual([]);
    expect(r.errors[0]).toMatch(/[֐-׿]/);
  });
});

describe("normDate in Israel", () => {
  it("keeps the written day for formats the browser parses as local midnight", () => {
    vi.stubEnv("TZ", "Asia/Jerusalem");
    try {
      // Local midnight Nov 15 in Israel is Nov 14 in UTC.
      expect(normDate("Nov 15 2026")).toBe("2026-11-15");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
