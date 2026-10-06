import { describe, expect, it } from "vitest";
import {
  countdownLabel,
  dateRangeHeb,
  dayCount,
  daysFrom,
  localDateString,
  parseLocalDate,
  tripLength,
  tripPhase,
} from "./trip-dates";

// Local noon, so the tests don't depend on the machine's time zone.
const today = new Date(2026, 9, 6, 12, 0);

describe("parseLocalDate / daysFrom", () => {
  it("reads a date-only string as that local calendar day", () => {
    const d = parseLocalDate("2026-11-15")!;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 10, 15, 0]);
  });

  it("counts whole days from today", () => {
    expect(daysFrom("2026-10-06", today)).toBe(0);
    expect(daysFrom("2026-10-07", today)).toBe(1);
    expect(daysFrom("2026-10-01", today)).toBe(-5);
    expect(daysFrom(null, today)).toBeNull();
    expect(daysFrom("not a date", today)).toBeNull();
  });
});

describe("tripPhase", () => {
  it("puts an undated trip under upcoming", () => {
    expect(tripPhase({ start_date: null, end_date: null }, today)).toBe("upcoming");
  });

  it("splits now / upcoming / past by start and end", () => {
    expect(tripPhase({ start_date: "2026-10-07", end_date: "2026-10-09" }, today)).toBe("upcoming");
    expect(tripPhase({ start_date: "2026-10-03", end_date: "2026-10-06" }, today)).toBe("now");
    expect(tripPhase({ start_date: "2026-10-06", end_date: null }, today)).toBe("now");
    expect(tripPhase({ start_date: "2026-09-01", end_date: "2026-09-08" }, today)).toBe("past");
    expect(tripPhase({ start_date: "2026-09-01", end_date: null }, today)).toBe("past");
  });
});

describe("Hebrew day counts", () => {
  it("uses the dual and the singular where Hebrew does", () => {
    expect(dayCount(1)).toBe("יום אחד");
    expect(dayCount(2)).toBe("יומיים");
    expect(dayCount(12)).toBe("12 ימים");
  });

  it("phrases a countdown", () => {
    expect(countdownLabel(0)).toBe("היום");
    expect(countdownLabel(1)).toBe("מחר");
    expect(countdownLabel(2)).toBe("בעוד יומיים");
    expect(countdownLabel(40)).toBe("בעוד 40 ימים");
  });
});

describe("dateRangeHeb", () => {
  it("is compact within one month and drops this year", () => {
    expect(dateRangeHeb("2026-11-15", "2026-11-20", today)).toBe("15–20 בנוב׳");
  });

  it("shows a single day once", () => {
    expect(dateRangeHeb("2026-11-15", "2026-11-15", today)).toBe("15 בנוב׳");
    expect(dateRangeHeb("2026-11-15", null, today)).toBe("15 בנוב׳");
  });

  it("adds the year outside the current one", () => {
    expect(dateRangeHeb("2027-07-01", "2027-07-09", today)).toBe("1–9 ביולי 2027");
  });

  it("ignores an end date before the start", () => {
    expect(dateRangeHeb("2026-10-10", "2026-10-05", today)).toBe("10 באוק׳");
  });

  it("is empty without a start date", () => {
    expect(dateRangeHeb(null, "2026-11-20", today)).toBe("");
  });
});

describe("tripLength / localDateString", () => {
  it("counts both ends of the trip", () => {
    expect(tripLength("2026-11-15", "2026-11-20")).toBe(6);
    expect(tripLength("2026-11-15", "2026-11-15")).toBe(1);
    expect(tripLength("2026-11-15", null)).toBeNull();
    expect(tripLength("2026-11-20", "2026-11-15")).toBeNull();
  });

  it("formats the local calendar day, even just after midnight", () => {
    expect(localDateString(new Date(2026, 9, 7, 0, 30))).toBe("2026-10-07");
  });
});
