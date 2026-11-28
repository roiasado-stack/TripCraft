import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  joinTransferWall,
  scannedTransferKind,
  transferFormParts,
  transferKind,
  transferStamp,
  transferTimesRow,
  transferWall,
} from "./transfer-times";
import { daysBetween } from "./trip-options";

// A 4-stop Maldives trip with domestic flights (CLAUDE.md: the scan saves every leg that
// doesn't land in Israel as `outbound`, domestic legs included). Each transfer belongs to the
// trip day printed on its voucher; a viewer's zone must never move it to another day.
const trip = { start_date: "2027-03-10", end_date: "2027-03-17" };
const flights = [
  { direction: "outbound", from_airport: "TLV", to_airport: "DXB", depart_local: "2027-03-10T09:40:00" },
  { direction: "outbound", from_airport: "DXB", to_airport: "MLE", depart_local: "2027-03-10T16:05:00" },
  { direction: "outbound", from_airport: "MLE", to_airport: "GAN", depart_local: "2027-03-13T07:00:00" }, // domestic
  { direction: "outbound", from_airport: "GAN", to_airport: "MLE", depart_local: "2027-03-16T20:15:00" }, // domestic, still outbound
  { direction: "inbound", from_airport: "MLE", to_airport: "TLV", depart_local: "2027-03-17T01:10:00" },
];
const transfers = [
  // Seaplane from Malé after the DXB leg lands.
  { kind: "transfer", provider: "Trans Maldivian", pickup_local: "2027-03-10T21:30:00", pickup_at: "2027-03-10T19:30:00+00:00", day: "2027-03-10" },
  // Speedboat in Addu after the domestic flight.
  { kind: "transfer", provider: "Addu Boats", pickup_local: "2027-03-13T09:15:00", pickup_at: "2027-03-13T07:15:00+00:00", day: "2027-03-13" },
  // Just after midnight in Malé, before the flight home: the date a viewer west of Greenwich
  // would see one day early if it went through Date.
  { kind: "transfer", provider: "Hotel shuttle", pickup_local: "2027-03-17T00:05:00", pickup_at: "2027-03-16T22:05:00+00:00", day: "2027-03-17" },
  { kind: "car_rental", provider: "Hertz", pickup_local: "2027-03-14T10:00:00", pickup_at: "2027-03-14T08:00:00+00:00", day: "2027-03-14" },
];

function cases() {
  it("shows the voucher's wall clock, never the viewer's zone", () => {
    expect(transferStamp("2027-03-12T14:00:00", "2027-03-12T12:00:00+00:00", "he")).toBe("12.3 14:00");
    expect(transferStamp("2027-03-12T14:00:00", "2027-03-12T12:00:00+00:00", "en")).toBe("12 Mar 14:00");
  });

  it("puts every transfer of a multi-stop trip with domestic flights on its own trip day", () => {
    const days = daysBetween(trip.start_date, trip.end_date);
    expect(flights.filter((f) => f.direction === "outbound")).toHaveLength(4);
    for (const t of transfers) {
      const { date } = transferFormParts(t.pickup_local, t.pickup_at);
      expect(date).toBe(t.day);
      expect(days).toContain(date);
    }
    expect(transferStamp(transfers[2].pickup_local, transfers[2].pickup_at, "he")).toBe("17.3 00:05");
  });

  it("falls back to the instant in Israel time for a row without a local (pre-032 payload)", () => {
    // 12:00 UTC in March is 14:00 in Israel (+02); in July 11:00 UTC is 14:00 (+03).
    expect(transferWall(null, "2027-03-12T12:00:00+00:00")).toBe("2027-03-12T14:00");
    expect(transferWall(undefined, "2027-07-01T11:00:00Z")).toBe("2027-07-01T14:00");
    expect(transferStamp(null, null, "he")).toBe("");
    expect(transferWall("not a time", null)).toBeNull();
  });

  it("the local wins over a disagreeing instant", () => {
    expect(transferWall("2027-03-12T14:00:00", "2027-03-12T05:00:00Z")).toBe("2027-03-12T14:00");
  });

  it("form: the pickers show the voucher time and save it back unchanged", () => {
    const parts = transferFormParts("2027-03-12T14:05:00", "2027-03-12T12:05:00+00:00");
    expect(parts).toEqual({ date: "2027-03-12", hour: "14", minute: "05" });
    expect(joinTransferWall(parts.date, parts.hour, parts.minute)).toBe("2027-03-12T14:05");
    expect(transferFormParts(null, null)).toEqual({ date: "", hour: "", minute: "" });
  });

  it("form: a date with no time saves midnight; no date saves nothing", () => {
    expect(joinTransferWall("2027-03-12", "", "")).toBe("2027-03-12T00:00");
    expect(joinTransferWall("", "14", "00")).toBeNull();
    expect(joinTransferWall("2027-02-30", "10", "00")).toBeNull();
  });

  it("writers send the wall clock as scanned or typed, never the device's reading of it", () => {
    expect(transferTimesRow({ pickup_at: "2027-03-12T14:00:00", return_at: null })).toEqual({
      pickup_local: "2027-03-12T14:00",
      return_local: null,
    });
    expect(transferTimesRow({ pickup_at: "2027-03-12T14:00" })).toEqual({ pickup_local: "2027-03-12T14:00", return_local: null });
    // An older draft holding an instant: read in Israel time, as the trigger does.
    expect(transferTimesRow({ pickup_at: "2027-03-12T12:00:00.000Z", return_at: "2027-07-01T15:00:00.000Z" })).toEqual({
      pickup_local: "2027-03-12T14:00",
      return_local: "2027-07-01T18:00",
    });
    expect(transferTimesRow({ pickup_at: "" })).toEqual({ pickup_local: null, return_local: null });
  });
}

describe("transfer kinds", () => {
  it("only car_rental is a rental; anything else is a transfer", () => {
    expect(transferKind("car_rental")).toBe("car_rental");
    expect(transferKind("transfer")).toBe("transfer");
    expect(transferKind("ferry")).toBe("transfer");
    expect(transferKind(null)).toBe("transfer");
  });

  it("a scanned voucher with a return time is a rental; a ferry or seaplane without one is a transfer", () => {
    expect(scannedTransferKind({ return_at: "2027-03-17T10:00:00" })).toBe("car_rental");
    expect(scannedTransferKind({ return_at: null })).toBe("transfer");
    expect(scannedTransferKind({ return_at: "  " })).toBe("transfer");
    expect(scannedTransferKind({})).toBe("transfer");
  });
});

describe("transfer times (process zone as set by the runner)", cases);

// The device zone must never leak in (same technique as flight-form.test.ts).
for (const viewer of ["America/Los_Angeles", "Indian/Mahe"]) {
  describe(`transfer times with the process in ${viewer}`, () => {
    const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
    const saved = env.TZ;
    beforeAll(() => {
      env.TZ = viewer;
    });
    afterAll(() => {
      if (saved === undefined) delete env.TZ;
      else env.TZ = saved;
    });
    it("the process zone really changed", () => {
      expect(new Date(Date.UTC(2026, 0, 15, 12)).getTimezoneOffset()).toBe(viewer === "Indian/Mahe" ? -240 : 480);
    });
    cases();
  });
}
