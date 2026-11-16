import { describe, expect, it } from "vitest";
import {
  ITINERARY_WINDOW_DAYS,
  itineraryCalls,
  missingDaysText,
  runItineraryWindows,
  splitDayWindows,
  windowProgressLabel,
  type DayWindow,
  type WindowCallResult,
} from "./itinerary-windows";
import { MAX_WINDOW_DAYS, clipToWindow, parseDayWindow } from "../../supabase/functions/generate/day-window";
import {
  type FlightRow,
  flightWindow,
  itineraryBookingLines,
  outsideTrip,
  tripDays,
} from "../../supabase/functions/generate/bookings";
import { daysBetween } from "./trip-options";

// The ABADA demo (production, 2026-11-15): 18 days, 11.3–28.3, one call ran
// out the Edge Function's 150s wall clock and saved nothing.
const abadaDays = daysBetween("2027-03-11", "2027-03-28");

describe("splitDayWindows", () => {
  it("cuts the 18-day trip into four ~5-day windows, in order", () => {
    expect(splitDayWindows(18)).toEqual([
      [1, 5],
      [6, 10],
      [11, 14],
      [15, 18],
    ]);
  });

  it("keeps a trip of up to 5 days in one window", () => {
    expect(splitDayWindows(4)).toEqual([[1, 4]]);
    expect(splitDayWindows(5)).toEqual([[1, 5]]);
    expect(splitDayWindows(1)).toEqual([[1, 1]]);
  });

  it("balances a trip just over one window instead of leaving a 1-day tail", () => {
    expect(splitDayWindows(6)).toEqual([
      [1, 3],
      [4, 6],
    ]);
  });

  it("never ends with a 1-day window, so the flight-home day never starts one", () => {
    for (let total = 2; total <= 60; total++) {
      const windows = splitDayWindows(total);
      const last = windows[windows.length - 1];
      expect(last[1] - last[0]).toBeGreaterThanOrEqual(1);
    }
    // A size that would leave a 1-day tail joins it to the window before.
    expect(splitDayWindows(5, 2)).toEqual([
      [1, 2],
      [3, 5],
    ]);
  });

  it("is empty for no days", () => {
    expect(splitDayWindows(0)).toEqual([]);
    expect(splitDayWindows(NaN)).toEqual([]);
  });

  it("covers every day exactly once and never exceeds what the function accepts", () => {
    for (let total = 1; total <= 60; total++) {
      const windows = splitDayWindows(total);
      expect(windows[0][0]).toBe(1);
      expect(windows[windows.length - 1][1]).toBe(total);
      windows.forEach(([from, to], i) => {
        expect(to - from + 1).toBeLessThanOrEqual(ITINERARY_WINDOW_DAYS);
        expect(to - from + 1).toBeLessThanOrEqual(MAX_WINDOW_DAYS);
        if (i > 0) expect(from).toBe(windows[i - 1][1] + 1);
      });
    }
  });
});

// Its flights: every leg that doesn't land in Israel is saved as "outbound",
// the domestic ones too; times on the Israeli browser's clock.
const TZ = "Asia/Jerusalem";
const leg = (direction: string, from: string, to: string, depart: string, arrive: string): FlightRow => ({
  direction,
  from_airport: from,
  to_airport: to,
  depart_at: depart,
  arrive_at: arrive,
});
const domesticLegs: FlightRow[] = [
  leg("outbound", "BKK", "HAN", "2027-03-13T10:00:00+02:00", "2027-03-13T12:00:00+02:00"),
  leg("outbound", "HAN", "DAD", "2027-03-16T09:00:00+02:00", "2027-03-16T10:20:00+02:00"),
  leg("outbound", "DAD", "DMK", "2027-03-20T08:30:00+02:00", "2027-03-20T10:30:00+02:00"),
  leg("outbound", "DMK", "CNX", "2027-03-20T13:00:00+02:00", "2027-03-20T14:10:00+02:00"),
  leg("outbound", "CNX", "HKT", "2027-03-24T12:00:00+02:00", "2027-03-24T14:10:00+02:00"),
];
const tlvBkk = leg("outbound", "TLV", "BKK", "2027-03-10T22:40:00+02:00", "2027-03-11T14:50:00+02:00");
const hktTlv = leg("inbound", "HKT", "TLV", "2027-03-28T14:00:00+03:00", "2027-03-29T00:05:00+03:00");
const abadaFlights = [tlvBkk, ...domesticLegs, hktTlv];

describe("itineraryCalls", () => {
  it("a 4-day trip makes one call, without a window", () => {
    const rome = [
      leg("outbound", "TLV", "FCO", "2027-04-05T07:00:00+03:00", "2027-04-05T10:10:00+03:00"),
      leg("inbound", "FCO", "TLV", "2027-04-08T17:00:00+03:00", "2027-04-08T21:20:00+03:00"),
    ];
    expect(itineraryCalls("2027-04-05", "2027-04-08", rome, [], TZ)).toEqual([null]);
  });

  it("a trip without dates makes one call", () => {
    expect(itineraryCalls(null, null, [], [], TZ)).toEqual([null]);
  });

  it("the 18-day trip makes one call per window", () => {
    expect(itineraryCalls("2027-03-11", "2027-03-28", abadaFlights, [], TZ)).toEqual(splitDayWindows(18));
  });

  it("skips windows whose days all hold items", () => {
    const planned = abadaDays.slice(0, 10); // days 1-10 already planned
    expect(itineraryCalls("2027-03-11", "2027-03-28", abadaFlights, planned, TZ)).toEqual([
      [11, 14],
      [15, 18],
    ]);
  });

  it("keeps a window with even one empty day", () => {
    const planned = abadaDays.filter((d) => d !== "2027-03-28");
    expect(itineraryCalls("2027-03-11", "2027-03-28", abadaFlights, planned, TZ)).toEqual([[15, 18]]);
  });

  it("a fully planned trip makes one whole-trip call (the 'add a few' mode)", () => {
    expect(itineraryCalls("2027-03-11", "2027-03-28", abadaFlights, abadaDays, TZ)).toEqual([null]);
  });

  // The trip starts on the day of the overnight flight out; the traveller lands on day 2.
  describe("overnight arrival on day 2", () => {
    const start = "2027-03-10";
    const end = "2027-03-28";

    it("windows cover the days from landing, numbered from start_date", () => {
      const calls = itineraryCalls(start, end, abadaFlights, [], TZ);
      expect(calls).toEqual([
        [2, 6],
        [7, 11],
        [12, 15],
        [16, 19],
      ]);
      for (const w of calls) expect(parseDayWindow(w, start, end)).toEqual({ ok: true, window: w });
      const allDays = tripDays(start, end, abadaFlights, TZ);
      expect(clipToWindow(allDays, start, [2, 6])).toEqual(["2027-03-11", "2027-03-12", "2027-03-13", "2027-03-14", "2027-03-15"]);
    });

    it("the flight-out day never counts as empty: a planned trip gets the whole-trip top-up", () => {
      expect(itineraryCalls(start, end, abadaFlights, abadaDays, TZ)).toEqual([null]);
    });
  });

  describe("end_date one day after the flight home", () => {
    const start = "2027-03-11";
    const end = "2027-03-29"; // LY84 lands in TLV at 00:05 on 29.3

    it("plans the same windows as a trip ending on the flight day", () => {
      expect(itineraryCalls(start, end, abadaFlights, [], TZ)).toEqual(splitDayWindows(18));
    });

    it("the day after the flight never counts as empty", () => {
      expect(itineraryCalls(start, end, abadaFlights, abadaDays, TZ)).toEqual([null]);
    });
  });

  // Flying home at 01:30 on 26.3 with end_date 30.3: by calendar days (20) the
  // last window would have started on 26.3 itself, and the evening-before
  // check-out / transfer on 25.3 would fall outside it and be dropped.
  describe("01:30 departure on the first day of a window", () => {
    const start = "2027-03-11";
    const end = "2027-03-30";
    const early = [tlvBkk, ...domesticLegs, leg("inbound", "HKT", "TLV", "2027-03-26T01:30:00+02:00", "2027-03-26T08:20:00+02:00")];
    const calendar = daysBetween(start, end);

    it("is the case: the calendar split starts a window on the departure day", () => {
      const byCalendar = splitDayWindows(calendar.length);
      const lastByCalendar = byCalendar[byCalendar.length - 1];
      expect(calendar[lastByCalendar[0] - 1]).toBe("2027-03-26");
    });

    it("the departure day's window also holds the evening before", () => {
      const calls = itineraryCalls(start, end, early, [], TZ) as DayWindow[];
      const allDays = tripDays(start, end, early, TZ);
      expect(allDays[allDays.length - 1]).toBe("2027-03-26");
      const w = calls.find((c) => clipToWindow(allDays, start, c).includes("2027-03-26"))!;
      const windowDays = clipToWindow(allDays, start, w);
      expect(windowDays[0]).not.toBe("2027-03-26");
      expect(windowDays).toContain("2027-03-25");

      // What the function does with that window: the rule moves check-out to 25.3,
      // and a 22:30 transfer that evening is kept.
      const lines = itineraryBookingLines([], early, windowDays, TZ);
      expect(lines).toContain("בערב של 2027-03-25");
      expect(lines).toContain("עד 22:30");
      expect(outsideTrip({ day_date: "2027-03-25", start_time: "22:30" }, windowDays, flightWindow(early, TZ))).toBe(false);
    });
  });
});

describe("windowProgressLabel", () => {
  it("names the days being built", () => {
    expect(windowProgressLabel([6, 10], 18)).toBe("בונה ימים 6–10 מתוך 18");
    expect(windowProgressLabel([18, 18], 18)).toBe("בונה יום 18 מתוך 18");
  });
});

describe("runItineraryWindows", () => {
  const windows = splitDayWindows(18);

  it("calls each window once, in order, one after the other", async () => {
    const seen: string[] = [];
    let inFlight = 0;
    const res = await runItineraryWindows(
      windows,
      async (w) => {
        inFlight++;
        expect(inFlight).toBe(1);
        seen.push(w.join("-"));
        await Promise.resolve();
        inFlight--;
        return { ok: true, inserted: 20 };
      },
    );
    expect(seen).toEqual(["1-5", "6-10", "11-14", "15-18"]);
    expect(res).toEqual({ inserted: 80, failed: [] });
  });

  it("records a failed window and still builds the rest", async () => {
    const res = await runItineraryWindows(windows, async (w): Promise<WindowCallResult> =>
      w[0] === 6 ? { ok: false, error: "llm_failed" } : { ok: true, inserted: 10 },
    );
    expect(res.failed).toEqual([[6, 10]]);
    expect(res.inserted).toBe(30);
    expect(res.error).toBe("llm_failed");
  });

  it("counts a window whose answer added nothing as missing", async () => {
    const res = await runItineraryWindows(windows, async (w): Promise<WindowCallResult> =>
      w[0] === 15 ? { ok: true, inserted: 0, empty: true } : { ok: true, inserted: 10 },
    );
    expect(res.failed).toEqual([[15, 18]]);
    expect(res.error).toBe("no_items");
  });

  it("stops at a cap: the remaining windows are missing, not called", async () => {
    const called: DayWindow[] = [];
    const res = await runItineraryWindows(windows, async (w): Promise<WindowCallResult> => {
      called.push(w);
      return w[0] === 6 ? { ok: false, error: "daily_cap_reached" } : { ok: true, inserted: 10 };
    });
    expect(called).toEqual([
      [1, 5],
      [6, 10],
    ]);
    expect(res.failed).toEqual([
      [6, 10],
      [11, 14],
      [15, 18],
    ]);
    expect(res.inserted).toBe(10);
  });

  it("reports progress before and after each window", async () => {
    const events: string[] = [];
    await runItineraryWindows(
      windows.slice(0, 2),
      async () => ({ ok: true, inserted: 1 }),
      (w, phase) => events.push(`${phase} ${w.join("-")}`),
    );
    expect(events).toEqual(["start 1-5", "done 1-5", "start 6-10", "done 6-10"]);
  });
});

describe("missingDaysText", () => {
  it("names the days by number and date", () => {
    expect(missingDaysText([[6, 10]], abadaDays)).toBe("ימים 6–10 (16.3–20.3)");
    expect(missingDaysText([[18, 18]], abadaDays)).toBe("יום 18 (28.3)");
  });

  it("merges neighbouring windows and lists separate ones", () => {
    expect(
      missingDaysText(
        [
          [6, 10],
          [11, 14],
        ],
        abadaDays,
      ),
    ).toBe("ימים 6–14 (16.3–24.3)");
    expect(
      missingDaysText(
        [
          [1, 5],
          [15, 18],
        ],
        abadaDays,
      ),
    ).toBe("ימים 1–5 (11.3–15.3) וימים 15–18 (25.3–28.3)");
  });
});
