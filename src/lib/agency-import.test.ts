import { describe, expect, it } from "vitest";
import {
  EXTERNAL_REF_MAX,
  IMPORT_SOURCE_LABEL,
  IMPORT_SOURCES,
  clientRow,
  dedupeBookings,
  documentsSource,
  isImportSource,
  normalizeExternalRef,
  type BookingImport,
} from "./agency-import";
import type { ImportedBooking } from "@/components/ImportBookings";

const base: BookingImport = {
  source: "documents",
  externalRef: null,
  client: { name: null, phone: null, email: null },
  trip: { title: "טיול לרומא", destination: "רומא", start_date: null, end_date: null },
  travellers: [],
  flights: [],
  stays: [],
  transfers: [],
};

const hotel = (name: string, ref: string, checkIn = "2026-11-15"): ImportedBooking => ({
  docType: "hotel",
  sourceFile: new File(["x"], "v.pdf", { type: "application/pdf" }),
  data: { hotel_name: name, booking_ref: ref, check_in: checkIn } as never,
});
const flight = (num: string, ref: string, depart: string, direction = "outbound"): ImportedBooking => ({
  docType: "flight",
  sourceFile: new File(["x"], "v.pdf", { type: "application/pdf" }),
  data: { flight_number: num, booking_ref: ref, depart_at: depart, direction } as never,
});

describe("sources", () => {
  it("knows exactly the values migration 025 allows, each with a Hebrew label", () => {
    expect([...IMPORT_SOURCES]).toEqual(["manual", "documents"]);
    for (const s of IMPORT_SOURCES) expect(IMPORT_SOURCE_LABEL[s]).toMatch(/[א-ת]/);
    expect(isImportSource("documents")).toBe(true);
    expect(isImportSource("crm")).toBe(false);
    expect(isImportSource(null)).toBe(false);
  });
});

describe("normalizeExternalRef", () => {
  it("trims, collapses spaces, and turns empty or too long into null", () => {
    expect(normalizeExternalRef("  AB  123 ")).toBe("AB 123");
    expect(normalizeExternalRef("")).toBeNull();
    expect(normalizeExternalRef("   ")).toBeNull();
    expect(normalizeExternalRef(null)).toBeNull();
    expect(normalizeExternalRef("x".repeat(EXTERNAL_REF_MAX))).toHaveLength(EXTERNAL_REF_MAX);
    expect(normalizeExternalRef("x".repeat(EXTERNAL_REF_MAX + 1))).toBeNull();
  });
});

describe("dedupeBookings", () => {
  it("drops a booking scanned twice and keeps the first copy", () => {
    const imp = documentsSource.toImport({
      scans: [{ bookings: [hotel("Hotel Roma", "H1")] }, { bookings: [hotel("hotel  roma", "h1")] }],
      client: { name: "", phone: "" },
      trip: { title: "t", destination: "d", start_date: "", end_date: "" },
      travellers: [],
    });
    expect(imp.stays).toHaveLength(1);
    expect(imp.stays[0].hotel_name).toBe("Hotel Roma");
  });

  it("keeps both legs of a return flight on one booking number", () => {
    const out = dedupeBookings({
      ...base,
      flights: [
        { direction: "outbound", airline: "", flight_number: "LY381", from_airport: "", to_airport: "", depart_at: "2026-11-15T08:00", booking_ref: "PNR1" },
        { direction: "inbound", airline: "", flight_number: "LY382", from_airport: "", to_airport: "", depart_at: "2026-11-20T18:00", booking_ref: "PNR1" },
      ],
    });
    expect(out.flights).toHaveLength(2);
  });

  it("never merges bookings without a booking number, however alike", () => {
    const blank = { direction: "outbound" as const, airline: "", flight_number: "", from_airport: "", to_airport: "", depart_at: "" };
    const out = dedupeBookings({
      ...base,
      flights: [blank, { ...blank }],
      stays: [
        { hotel_name: "", address: "", check_in: "", check_out: "", booking_ref: "" },
        { hotel_name: "", address: "", check_in: "", check_out: "", booking_ref: "  " },
      ],
    });
    expect(out.flights).toHaveLength(2);
    expect(out.stays).toHaveLength(2);
  });

  it("keeps two transfers on one booking number from different pickup points", () => {
    const t = { kind: "transfer", provider: "Shuttle", pickup_at: "2026-11-15T10:00", booking_ref: "T1" };
    const out = dedupeBookings({
      ...base,
      transfers: [
        { ...t, pickup_location: "CDG" },
        { ...t, pickup_location: "Hotel" },
      ],
    });
    expect(out.transfers).toHaveLength(2);
  });

  it("keeps two stays in the same hotel on different dates", () => {
    const imp = documentsSource.toImport({
      scans: [{ bookings: [hotel("Hotel Roma", "H1", "2026-11-15"), hotel("Hotel Roma", "H1", "2026-11-20")] }],
      client: { name: "", phone: "" },
      trip: { title: "t", destination: "d", start_date: "", end_date: "" },
      travellers: [],
    });
    expect(imp.stays).toHaveLength(2);
  });
});

describe("documentsSource", () => {
  it("collects every scan in order and marks the trip as from documents", () => {
    const imp = documentsSource.toImport({
      scans: [
        { bookings: [flight("LY381", "PNR1", "2026-11-15T08:00:00Z")] },
        { bookings: [hotel("Hotel Roma", "H1")] },
      ],
      client: { name: "משפחת כהן", phone: "050-1234567" },
      trip: { title: "טיול לרומא", destination: "רומא", start_date: "2026-11-15", end_date: "" },
      travellers: [],
    });
    expect(imp.source).toBe("documents");
    expect(imp.flights.map((f) => f.flight_number)).toEqual(["LY381"]);
    expect(imp.stays.map((s) => s.hotel_name)).toEqual(["Hotel Roma"]);
    expect(imp.trip.start_date).toBe("2026-11-15");
    expect(imp.trip.end_date).toBeNull();
  });
});

describe("clientRow", () => {
  it("carries the source and a normalized booking number, blanks as null", () => {
    expect(
      clientRow("trip-1", { ...base, client: { name: "  דנה ", phone: "", email: null }, externalRef: " A-77 " }),
    ).toEqual({
      trip_id: "trip-1",
      client_name: "דנה",
      client_phone: null,
      client_email: null,
      source: "documents",
      external_ref: "A-77",
    });
  });
});
