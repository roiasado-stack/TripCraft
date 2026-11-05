import { describe, expect, it } from "vitest";
import { stepAfterWaitingCheck, stepForMemberStatus } from "./join-waiting";

describe("stepForMemberStatus", () => {
  it("opens the trip for an approved member or the owner", () => {
    expect(stepForMemberStatus("active")).toBe("open_trip");
    expect(stepForMemberStatus("owner")).toBe("open_trip");
  });

  it("keeps waiting while pending", () => {
    expect(stepForMemberStatus("pending")).toBe("wait");
  });

  it("tells a removed member apart from a row that is gone", () => {
    expect(stepForMemberStatus("removed")).toBe("removed");
    expect(stepForMemberStatus(null)).toBe("gone");
    expect(stepForMemberStatus(undefined)).toBe("gone");
  });

  it("keeps waiting on a status it doesn't know", () => {
    expect(stepForMemberStatus("something_new")).toBe("wait");
  });
});

describe("stepAfterWaitingCheck", () => {
  it("retries a failed check, even though no row came back", () => {
    expect(stepAfterWaitingCheck(true, null)).toBe("retry");
    expect(stepAfterWaitingCheck(true, undefined)).toBe("retry");
  });

  it("follows the row when the check worked", () => {
    expect(stepAfterWaitingCheck(false, "active")).toBe("open_trip");
    expect(stepAfterWaitingCheck(false, "pending")).toBe("wait");
    expect(stepAfterWaitingCheck(false, "removed")).toBe("removed");
    expect(stepAfterWaitingCheck(false, null)).toBe("gone");
  });
});
