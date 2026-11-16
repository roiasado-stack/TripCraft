import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AIRLINES,
  arrivalMode,
  arrivalPreview,
  blankFlightForm,
  flightTimesRow,
  flightToForm,
  formArrival,
  formToFlightRow,
  formZones,
  wallOf,
  withDirection,
  type FlightFormDraft,
  type FlightFormRow,
} from "./flight-form";
import { zoneOf } from "../../supabase/functions/_shared/airport-zones";

// LY84 as migration 028 stores it: ticket wall clocks, zones, and the derived instants.
const ly84: FlightFormRow = {
  id: "f-ly84",
  direction: "inbound",
  airline: "אל על",
  flight_number: "LY84",
  from_airport: "Bangkok (BKK)",
  to_airport: "TLV",
  depart_local: "2026-03-28T17:00:00",
  arrive_local: "2026-03-29T00:05:00",
  from_tz: "Asia/Bangkok",
  to_tz: "Asia/Jerusalem",
  depart_at: "2026-03-28T10:00:00+00:00",
  arrive_at: "2026-03-28T21:05:00+00:00",
  baggage: "2×23",
  notes: null,
};

// A domestic leg inside Thailand, airline not on the shortlist.
const bkkCnx: FlightFormRow = {
  id: "f-tg",
  direction: "outbound",
  airline: "Thai Airways",
  flight_number: "TG102",
  from_airport: "BKK",
  to_airport: "Chiang Mai (CNX)",
  depart_local: "2026-03-20T08:00:00",
  arrive_local: "2026-03-20T09:15:00",
  from_tz: "Asia/Bangkok",
  to_tz: "Asia/Bangkok",
  depart_at: "2026-03-20T01:00:00+00:00",
  arrive_at: "2026-03-20T02:15:00+00:00",
  baggage: null,
  notes: "טיסת פנים",
};

// An airport the table doesn't know (free text, no code): no zones on the row.
const unknown: FlightFormRow = {
  id: "f-x",
  direction: "outbound",
  airline: null,
  flight_number: "XX1",
  from_airport: "TLV",
  to_airport: "שדה קטן באי",
  depart_local: "2026-05-01T10:00:00",
  arrive_local: "2026-05-01T13:30:00",
  from_tz: "Asia/Jerusalem",
  to_tz: null,
  depart_at: "2026-05-01T07:00:00+00:00",
  arrive_at: "2026-05-01T10:30:00+00:00",
  baggage: null,
  notes: null,
};

/** What an untouched open → save writes, against the row's own columns. */
function roundTrip(row: FlightFormRow) {
  const out = formToFlightRow(flightToForm(row, zoneOf), row, zoneOf);
  return {
    out,
    same: {
      direction: row.direction,
      airline: row.airline,
      flight_number: row.flight_number,
      from_airport: row.from_airport,
      to_airport: row.to_airport,
      depart_local: row.depart_local,
      arrive_local: row.arrive_local,
      from_tz: row.from_tz,
      to_tz: row.to_tz,
      baggage: row.baggage,
      notes: row.notes,
    },
  };
}

function cases() {
  it("open and save unchanged writes back exactly the row's values", () => {
    for (const row of [ly84, bkkCnx, unknown]) {
      const { out, same } = roundTrip(row);
      expect(out).toEqual(same);
      expect(out).not.toHaveProperty("depart_at");
      expect(out).not.toHaveProperty("arrive_at");
    }
  });

  it("pre-fills LY84 from the ticket times with the real block time", () => {
    const d = flightToForm(ly84, zoneOf);
    expect([d.depart_date, d.depart_hour, d.depart_minute]).toEqual(["2026-03-28", "17", "00"]);
    expect([d.duration_hours, d.duration_minutes]).toEqual(["11", "05"]);
    expect([d.from_airport, d.to_airport]).toEqual(["Bangkok (BKK)", "TLV"]);
  });

  it("LY84: BKK 28.3 17:00 + 11h05 lands 29.3 00:05 in TLV (not 04:05)", () => {
    const d: FlightFormDraft = { ...flightToForm(ly84, zoneOf), duration_hours: "11", duration_minutes: "05" };
    const zones = formZones(d, ly84, zoneOf);
    expect(formArrival(d, zones)).toBe("2026-03-29T00:05");
    expect(arrivalPreview(d, zones)).toBe("נחיתה 29.3 00:05 שעון TLV");
    // A corrected duration moves the arrival through both zones.
    const longer = { ...d, duration_minutes: "35" };
    const row = formToFlightRow(longer, ly84, zoneOf);
    expect(row.arrive_local).toBe("2026-03-29T00:35");
    expect(row.depart_local).toBe(ly84.depart_local);
  });

  it("TLV 22:40 + 11h10 lands in BKK at 14:50 the next day", () => {
    const d: FlightFormDraft = {
      ...blankFlightForm,
      to_airport: "BKK",
      depart_date: "2026-03-12",
      depart_hour: "22",
      depart_minute: "40",
      duration_hours: "11",
      duration_minutes: "10",
    };
    const zones = formZones(d, null, zoneOf);
    expect(zones).toEqual({ from_tz: "Asia/Jerusalem", to_tz: "Asia/Bangkok" });
    expect(arrivalMode(d, zones)).toBe("duration");
    expect(arrivalPreview(d, zones)).toBe("נחיתה 13.3 14:50 שעון BKK");
    expect(formToFlightRow(d, null, zoneOf)).toMatchObject({
      from_airport: "TLV",
      to_airport: "BKK",
      depart_local: "2026-03-12T22:40",
      arrive_local: "2026-03-13T14:50",
      from_tz: "Asia/Jerusalem",
      to_tz: "Asia/Bangkok",
    });
  });

  it("editing a domestic leg keeps its origin (no forced TLV)", () => {
    const d = { ...flightToForm(bkkCnx, zoneOf), notes: "טיסת פנים, מושב 3A" };
    const row = formToFlightRow(d, bkkCnx, zoneOf);
    expect(row.from_airport).toBe("BKK");
    expect(row.to_airport).toBe("Chiang Mai (CNX)");
    expect(row.airline).toBe("Thai Airways");
    expect([row.depart_local, row.arrive_local]).toEqual([bkkCnx.depart_local, bkkCnx.arrive_local]);
  });

  it("an unknown airport asks for the arrival time and saves it as typed", () => {
    const d: FlightFormDraft = {
      ...blankFlightForm,
      to_airport: "שדה קטן באי",
      depart_date: "2026-05-01",
      depart_hour: "10",
      depart_minute: "00",
      arrive_date: "2026-05-01",
      arrive_hour: "13",
      arrive_minute: "30",
    };
    const zones = formZones(d, null, zoneOf);
    expect(zones).toEqual({ from_tz: "Asia/Jerusalem", to_tz: null });
    expect(arrivalMode(d, zones)).toBe("arrival");
    expect(formToFlightRow(d, null, zoneOf)).toMatchObject({
      depart_local: "2026-05-01T10:00",
      arrive_local: "2026-05-01T13:30",
      from_tz: "Asia/Jerusalem",
      to_tz: null,
    });
    // The existing unknown-zone row opens in the same mode with its arrival filled in.
    const open = flightToForm(unknown, zoneOf);
    expect(arrivalMode(open, formZones(open, unknown, zoneOf))).toBe("arrival");
    expect([open.duration_hours, open.arrive_date, open.arrive_hour, open.arrive_minute]).toEqual(["", "2026-05-01", "13", "30"]);
  });

  it("a changed airport gets its own zone; the row's zone stays while the text is unchanged", () => {
    const d = { ...flightToForm(bkkCnx, zoneOf), to_airport: "HKT" };
    expect(formZones(d, bkkCnx, zoneOf).to_tz).toBe("Asia/Bangkok");
    const custom = { ...bkkCnx, to_airport: "Chiang Mai", to_tz: "Asia/Bangkok" };
    expect(formZones(flightToForm(custom, zoneOf), custom, zoneOf).to_tz).toBe("Asia/Bangkok");
    // Before the table loads, an unchanged row still knows its zones.
    expect(formZones(flightToForm(bkkCnx, null), bkkCnx, null)).toEqual({ from_tz: "Asia/Bangkok", to_tz: "Asia/Bangkok" });
  });

  it("a row without locals (pre-028) opens on its Israel-time wall clock", () => {
    const old = { ...ly84, depart_local: null, arrive_local: null, from_tz: null, to_tz: null };
    const d = flightToForm(old, zoneOf);
    expect([d.depart_date, d.depart_hour, d.depart_minute]).toEqual(["2026-03-28", "13", "00"]);
  });

  it("switching direction on a new flight moves the prefilled TLV only", () => {
    const inbound = withDirection(blankFlightForm, "inbound");
    expect([inbound.from_airport, inbound.to_airport]).toEqual(["", "TLV"]);
    expect(withDirection(inbound, "outbound").from_airport).toBe("TLV");
    const typed = withDirection({ ...blankFlightForm, to_airport: "CNX" }, "inbound");
    expect([typed.from_airport, typed.to_airport]).toEqual(["TLV", "CNX"]);
    const existing = withDirection(flightToForm(bkkCnx, zoneOf), "inbound");
    expect([existing.from_airport, existing.direction]).toEqual(["BKK", "inbound"]);
  });

  it("keeps a known airline and maps others to אחר", () => {
    expect(flightToForm(ly84, zoneOf).airline).toBe(AIRLINES[0]);
    expect(flightToForm(bkkCnx, zoneOf)).toMatchObject({ airline: "__other__", airlineOther: "Thai Airways" });
  });
}

describe("wallOf / flightTimesRow (scan, wizard, documents tab writers)", () => {
  it("keeps a ticket wall clock as printed and reads an instant in Israel time", () => {
    expect(wallOf("2026-03-28T17:00:00")).toBe("2026-03-28T17:00");
    expect(wallOf("2026-03-28T17:00")).toBe("2026-03-28T17:00");
    expect(wallOf("2026-03-28T21:05:00Z")).toBe("2026-03-29T00:05");
    expect(wallOf("2026-03-28T21:05:00+00:00")).toBe("2026-03-29T00:05");
    expect(wallOf("")).toBeNull();
    expect(wallOf("tomorrow")).toBeNull();
    expect(wallOf(null)).toBeNull();
  });

  it("stores each airport's zone, leaving an unknown one null", () => {
    expect(
      flightTimesRow(
        { from_airport: "Bangkok (BKK)", to_airport: 'נתב"ג', depart_at: "2026-03-28T17:00:00", arrive_at: "2026-03-29T00:05:00" },
        zoneOf,
      ),
    ).toEqual({
      depart_local: "2026-03-28T17:00",
      arrive_local: "2026-03-29T00:05",
      from_tz: "Asia/Bangkok",
      to_tz: "Asia/Jerusalem",
    });
    expect(flightTimesRow({ from_airport: "Bangkok", to_airport: null, depart_at: "2026-03-28T17:00", arrive_at: null }, zoneOf)).toEqual({
      depart_local: "2026-03-28T17:00",
      arrive_local: null,
      from_tz: null,
      to_tz: null,
    });
  });
});

describe("flight form (process zone as set by the runner)", cases);

// The device zone must never leak in (same technique as flight-time.test.ts).
for (const viewer of ["America/Los_Angeles", "Asia/Bangkok"]) {
  describe(`flight form with the process in ${viewer}`, () => {
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
      expect(new Date(Date.UTC(2026, 0, 15, 12)).getTimezoneOffset()).toBe(viewer === "Asia/Bangkok" ? -420 : 480);
    });
    cases();
  });
}
