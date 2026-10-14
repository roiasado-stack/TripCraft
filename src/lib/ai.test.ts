import { describe, expect, it } from "vitest";
import { aiErrorMessage } from "./ai";

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
