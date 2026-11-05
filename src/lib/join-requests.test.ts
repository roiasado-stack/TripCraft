import { describe, expect, it } from "vitest";
import {
  joinPushLanding,
  pendingRequestsLabel,
  pendingRequestsTotal,
  planAddTraveller,
  travellerNameKey,
} from "./join-requests";

describe("travellerNameKey", () => {
  it("ignores surrounding spaces and case", () => {
    expect(travellerNameKey("  Dana Levi ")).toBe(travellerNameKey("dana LEVI"));
  });

  it("keeps different names apart", () => {
    expect(travellerNameKey("דנה לוי")).not.toBe(travellerNameKey("דנה כהן"));
  });
});

describe("planAddTraveller", () => {
  it("inserts the trimmed name when the trip doesn't have it", () => {
    expect(planAddTraveller("  דנה לוי ", ["יוסי כהן"])).toEqual({ kind: "insert", name: "דנה לוי" });
  });

  it("inserts into a trip with no travellers", () => {
    expect(planAddTraveller("Dana", [])).toEqual({ kind: "insert", name: "Dana" });
  });

  it("adds nothing when the name exists, whatever its spacing or case", () => {
    expect(planAddTraveller("דנה לוי", [" דנה לוי  "])).toEqual({ kind: "exists" });
    expect(planAddTraveller("  dana LEVI", ["Dana Levi"])).toEqual({ kind: "exists" });
  });

  it("has nothing to add without a display name", () => {
    expect(planAddTraveller(null, [])).toEqual({ kind: "no_name" });
    expect(planAddTraveller(undefined, [])).toEqual({ kind: "no_name" });
    expect(planAddTraveller("   ", ["דנה"])).toEqual({ kind: "no_name" });
  });
});

describe("pendingRequestsTotal", () => {
  it("sums the board rows", () => {
    expect(pendingRequestsTotal([{ members_pending: 2 }, { members_pending: 0 }, { members_pending: 1 }])).toBe(3);
  });

  it("is zero on an empty board, which hides the link", () => {
    expect(pendingRequestsTotal([])).toBe(0);
  });
});

describe("pendingRequestsLabel", () => {
  it("has a singular form", () => {
    expect(pendingRequestsLabel(1)).toBe("בקשת הצטרפות אחת ממתינה לאישור");
  });

  it("counts the plural form", () => {
    expect(pendingRequestsLabel(3)).toBe("3 בקשות הצטרפות ממתינות לאישור");
  });
});

describe("joinPushLanding", () => {
  it("sends an agent who owns the trip to the requests screen", () => {
    expect(joinPushLanding(true, true)).toBe("agent_requests");
  });

  it("keeps an ordinary owner on the trip's members sheet", () => {
    expect(joinPushLanding(true, false)).toBe("members_sheet");
  });

  it("does nothing for someone who can't manage the trip, agent or not", () => {
    expect(joinPushLanding(false, false)).toBe("none");
    expect(joinPushLanding(false, true)).toBe("none");
  });
});
