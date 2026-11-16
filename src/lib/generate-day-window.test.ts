import { describe, expect, it } from "vitest";
import { MAX_WINDOW_DAYS, clipToWindow, parseDayWindow } from "../../supabase/functions/generate/day-window";
import {
  departureDayRule,
  flightWindow,
  itineraryBookingLines,
  outsideTrip,
  tripDays,
  type FlightRow,
  type StayRow,
} from "../../supabase/functions/generate/bookings";
import { splitDayWindows } from "./itinerary-windows";

// The ABADA demo (production, 2026-11-15): 18 days in Vietnam and Thailand,
// 5 stays, 7 flights. Every leg that doesn't land in Israel is saved as
// "outbound", the domestic ones too. Times are on the Israeli browser's clock
// (UTC+2 until 26.3.2027, UTC+3 after).
const TZ = "Asia/Jerusalem";
const leg = (direction: string, from: string, to: string, depart: string, arrive: string): FlightRow => ({
  direction,
  from_airport: from,
  to_airport: to,
  depart_at: depart,
  arrive_at: arrive,
});
const flights: FlightRow[] = [
  leg("outbound", "TLV", "BKK", "2027-03-10T22:40:00+02:00", "2027-03-11T14:50:00+02:00"),
  leg("outbound", "BKK", "HAN", "2027-03-13T10:00:00+02:00", "2027-03-13T12:00:00+02:00"),
  leg("outbound", "HAN", "DAD", "2027-03-16T09:00:00+02:00", "2027-03-16T10:20:00+02:00"),
  leg("outbound", "DAD", "DMK", "2027-03-20T08:30:00+02:00", "2027-03-20T10:30:00+02:00"),
  leg("outbound", "DMK", "CNX", "2027-03-20T13:00:00+02:00", "2027-03-20T14:10:00+02:00"),
  leg("outbound", "CNX", "HKT", "2027-03-24T12:00:00+02:00", "2027-03-24T14:10:00+02:00"),
  leg("inbound", "HKT", "TLV", "2027-03-28T14:00:00+03:00", "2027-03-29T00:05:00+03:00"),
];
const stays: StayRow[] = [
  { hotel_name: "Chatrium Riverside", address: "Bangkok, Thailand", check_in: "2027-03-11", check_out: "2027-03-13" },
  { hotel_name: "Hotel de l'Opera", address: "Hanoi, Vietnam", check_in: "2027-03-13", check_out: "2027-03-16" },
  { hotel_name: "Anantara Hoi An", address: "Hoi An, Vietnam", check_in: "2027-03-16", check_out: "2027-03-20" },
  { hotel_name: "Shangri-La Chiang Mai", address: "Chiang Mai, Thailand", check_in: "2027-03-20", check_out: "2027-03-24" },
  { hotel_name: "Katathani Phuket", address: "Phuket, Thailand", check_in: "2027-03-24", check_out: "2027-03-28" },
];
const START = "2027-03-11";
const END = "2027-03-28";
const allDays = tripDays(START, END, flights, TZ);

describe("parseDayWindow", () => {
  it("no window means the whole trip (the call made before windows existed)", () => {
    expect(parseDayWindow(undefined, START, END)).toEqual({ ok: true, window: null });
    expect(parseDayWindow(null, START, END)).toEqual({ ok: true, window: null });
  });

  it("accepts every window the client sends for the 18-day trip", () => {
    for (const w of splitDayWindows(18)) expect(parseDayWindow(w, START, END)).toEqual({ ok: true, window: w });
  });

  it("rejects anything that isn't two whole numbers", () => {
    for (const raw of ["1-5", [1], [1, 2, 3], [1.5, 3], ["1", "5"], [1, Infinity], [NaN, 2], { from: 1, to: 5 }]) {
      expect(parseDayWindow(raw, START, END)).toEqual({ ok: false });
    }
  });

  it("rejects a window outside the trip or reversed", () => {
    expect(parseDayWindow([0, 3], START, END)).toEqual({ ok: false });
    expect(parseDayWindow([16, 19], START, END)).toEqual({ ok: false });
    expect(parseDayWindow([5, 4], START, END)).toEqual({ ok: false });
  });

  it("rejects a window longer than one call may plan, so it can't stand in for the whole trip", () => {
    expect(parseDayWindow([1, MAX_WINDOW_DAYS], START, END)).toEqual({ ok: true, window: [1, MAX_WINDOW_DAYS] });
    expect(parseDayWindow([1, MAX_WINDOW_DAYS + 1], START, END)).toEqual({ ok: false });
    expect(parseDayWindow([1, 18], START, END)).toEqual({ ok: false });
  });

  it("rejects any window on a trip without dates", () => {
    expect(parseDayWindow([1, 3], null, null)).toEqual({ ok: false });
  });
});

describe("the multi-stop trip planned window by window", () => {
  it("plans all 18 days, landing day to the flight home", () => {
    expect(allDays).toHaveLength(18);
    expect(allDays[0]).toBe("2027-03-11");
    expect(allDays[17]).toBe("2027-03-28");
  });

  it("the windows together cover every day exactly once", () => {
    const covered = splitDayWindows(18).flatMap((w) => clipToWindow(allDays, START, w));
    expect(covered).toEqual(allDays);
  });

  it("clips to the window's dates", () => {
    expect(clipToWindow(allDays, START, [6, 10])).toEqual(["2027-03-16", "2027-03-17", "2027-03-18", "2027-03-19", "2027-03-20"]);
    expect(clipToWindow(allDays, START, null)).toEqual(allDays);
  });

  it("a window before landing has nothing to plan", () => {
    // Trip dates start two days before the flight lands.
    const early = tripDays("2027-03-09", END, flights, TZ);
    expect(clipToWindow(early, "2027-03-09", [1, 2])).toEqual([]);
  });

  it("a window's rows outside it are dropped like rows outside the trip", () => {
    const days = clipToWindow(allDays, START, [6, 10]);
    const w = flightWindow(flights, TZ);
    expect(outsideTrip({ day_date: "2027-03-15", start_time: "10:00" }, days, w)).toBe(true);
    expect(outsideTrip({ day_date: "2027-03-17", start_time: "10:00" }, days, w)).toBe(false);
  });

  it("each window's prompt gets its own move days, and only the last gets the return day", () => {
    const [first, second, , last] = splitDayWindows(18).map((w) =>
      itineraryBookingLines(stays, flights, clipToWindow(allDays, START, w), TZ),
    );
    expect(first).toContain("ביום ההגעה (2027-03-11) התחל רק אחרי הנחיתה ב-14:50");
    expect(first).toContain("2027-03-13 הוא יום מעבר");
    expect(first).not.toContain("ביום החזרה");
    expect(second).toContain("2027-03-16 הוא יום מעבר");
    expect(second).toContain("2027-03-20 הוא יום מעבר");
    expect(second).not.toContain("ביום ההגעה");
    expect(last).toContain("ביום החזרה (2027-03-28) הטיסה ב-14:00");
    expect(last).toContain("- טיסת פנים: CNX → HKT");
  });
});

describe("departureDayRule", () => {
  it("asks for breakfast, check-out and a transfer reaching the airport 2-3h before take-off", () => {
    const rule = departureDayRule({ day: "2027-03-28", time: "14:00" });
    expect(rule).toContain("ביום החזרה (2027-03-28) הטיסה ב-14:00");
    expect(rule).toContain("ארוחת בוקר");
    expect(rule).toContain("צ'ק-אאוט");
    expect(rule).toContain("transport");
    expect(rule).toContain("עד 11:00");
    expect(rule).toContain("ולכל המאוחר 12:00");
    expect(rule).toContain("בלי שום פריט אחרי ההמראה");
  });

  it("an afternoon or evening flight may keep a short activity near the hotel", () => {
    expect(departureDayRule({ day: "2026-11-19", time: "21:40" })).toContain("פעילות קצרה וקרובה למלון");
    expect(departureDayRule({ day: "2027-03-28", time: "14:00" })).not.toContain("פעילות קצרה");
  });

  it("an early flight leaves no time for breakfast", () => {
    const rule = departureDayRule({ day: "2027-03-28", time: "07:30" });
    expect(rule).toContain("עד 04:30");
    expect(rule).toContain("בלי ארוחת בוקר");
  });

  it("a flight after midnight moves check-out and the transfer to the evening before", () => {
    const rule = departureDayRule({ day: "2027-03-28", time: "01:30" });
    expect(rule).toContain("בערב של 2027-03-27");
    expect(rule).toContain("עד 22:30");
    expect(rule).toContain("ולכל המאוחר 23:30");
  });
});
