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
import { MAX_WINDOW_DAYS } from "../../supabase/functions/generate/day-window";
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

describe("itineraryCalls", () => {
  it("a 4-day trip makes one call, without a window", () => {
    expect(itineraryCalls(daysBetween("2027-04-05", "2027-04-08"), [])).toEqual([null]);
  });

  it("a trip without dates makes one call", () => {
    expect(itineraryCalls([], [])).toEqual([null]);
  });

  it("the 18-day trip makes one call per window", () => {
    expect(itineraryCalls(abadaDays, [])).toEqual(splitDayWindows(18));
  });

  it("skips windows whose days all hold items", () => {
    const planned = abadaDays.slice(0, 10); // days 1-10 already planned
    expect(itineraryCalls(abadaDays, planned)).toEqual([
      [11, 14],
      [15, 18],
    ]);
  });

  it("keeps a window with even one empty day", () => {
    const planned = abadaDays.filter((d) => d !== "2027-03-28");
    expect(itineraryCalls(abadaDays, planned)).toEqual([[15, 18]]);
  });

  it("a fully planned trip makes one whole-trip call (the 'add a few' mode)", () => {
    expect(itineraryCalls(abadaDays, abadaDays)).toEqual([null]);
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
