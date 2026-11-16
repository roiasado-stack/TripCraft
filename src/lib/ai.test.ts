import { describe, expect, it } from "vitest";
import { aiErrorMessage, itineraryFailureMessage } from "./ai";
import { daysBetween } from "./trip-options";

describe("itineraryFailureMessage", () => {
  const days = daysBetween("2027-03-11", "2027-03-28");

  it("names the missing days and says the rest were saved", () => {
    const m = itineraryFailureMessage({ ok: false, inserted: 60, failed: [[6, 10]], error: "llm_failed" }, days);
    expect(m).toContain("המסלול לא נבנה לימים 6–10 (16.3–20.3).");
    expect(m).toContain("שאר הימים נשמרו");
  });

  it("explains a cap that stopped the run", () => {
    const m = itineraryFailureMessage(
      { ok: false, inserted: 20, failed: [[6, 10], [11, 14], [15, 18]], error: "daily_cap_reached" },
      days,
    );
    expect(m).toContain("לימים 6–18");
    expect(m).toContain("מחר");
  });

  it("invites another press when a window just failed", () => {
    expect(itineraryFailureMessage({ ok: false, inserted: 0, failed: [[18, 18]], error: "bad_window" }, days)).toContain(
      "ליום 18 (28.3). אפשר ללחוץ שוב",
    );
  });

  it("keeps the usual message for a single call", () => {
    expect(itineraryFailureMessage({ ok: false, inserted: 0, failed: [], error: "llm_failed" }, [])).toContain("ה-AI לא זמין");
  });
});

describe("aiErrorMessage", () => {
  it("tells an agent the monthly budget is used up, not to try tomorrow", () => {
    const m = aiErrorMessage("monthly_cap_reached", "");
    expect(m).toContain("החודשית");
    expect(m).not.toContain("מחר");
  });

  it("keeps the daily message for the daily cap", () => {
    expect(aiErrorMessage("daily_cap_reached", "")).toContain("מחר");
  });

  // ImportBookings shows only codes that map to a non-empty message.
  it("returns the fallback for unknown codes", () => {
    expect(aiErrorMessage("something_else", "")).toBe("");
    expect(aiErrorMessage(undefined, "x")).toBe("x");
  });
});
