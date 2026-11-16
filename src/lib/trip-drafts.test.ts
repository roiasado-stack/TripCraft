import { describe, expect, it } from "vitest";
import {
  isTripLimitError,
  bookingsToDrafts,
  collectSourceDocs,
  countHe,
  defaultTripType,
  flightDraftFromVoucher,
  joinHebrew,
  participantRows,
  travellerToDraft,
  type FlightDraft,
  type StayDraft,
} from "./trip-drafts";
import type { ImportedBooking } from "@/components/ImportBookings";

const file = (name: string) => new File(["x"], name, { type: "application/pdf" });

const flight = (f: File | null): FlightDraft => ({
  direction: "outbound",
  airline: "",
  flight_number: "",
  from_airport: "",
  to_airport: "",
  depart_at: "",
  source_file: f,
});
const stay = (name: string, f: File | null): StayDraft => ({
  hotel_name: name,
  address: "",
  check_in: "",
  check_out: "",
  booking_ref: "",
  source_file: f,
});

describe("collectSourceDocs", () => {
  it("uploads a multi-segment flight file once, however many segments carry it", () => {
    const f = file("lyft.pdf");
    const docs = collectSourceDocs([flight(f), flight(f)], [], []);
    expect(docs).toEqual([{ file: f, category: "flight" }]);
  });

  it("keeps one entry per distinct file with its category, and skips drafts without one", () => {
    const a = file("a.pdf");
    const b = file("b.pdf");
    const docs = collectSourceDocs([flight(a), flight(null)], [stay("Hotel", b)], []);
    expect(docs.map((d) => d.category)).toEqual(["flight", "hotel"]);
  });
});

describe("participantRows", () => {
  it("drops blank names and maps the age mode", () => {
    expect(
      participantRows([
        { name: " רועי ", ageMode: "age", age: "40", age_range: "18-30", preferences: ["beach"] },
        { name: "  ", ageMode: "age", age: "", age_range: "", preferences: [] },
        { name: "נועה", ageMode: "range", age: "7", age_range: "4-12", preferences: [] },
        { name: "תינוק", ageMode: "age", age: "", age_range: "0-3", preferences: [] },
      ]),
    ).toEqual([
      { name: "רועי", age: 40, age_range: null, preferences: ["beach"] },
      { name: "נועה", age: null, age_range: "4-12", preferences: [] },
      { name: "תינוק", age: null, age_range: null, preferences: [] },
    ]);
  });
});

describe("travellerToDraft", () => {
  it("keeps an unknown age unset rather than guessing a range", () => {
    const d = travellerToDraft({ name: "דני", age: null, age_range: null, preferences: [], type: "child" });
    expect(participantRows([d])).toEqual([{ name: "דני", age: null, age_range: null, preferences: [] }]);
  });
});

describe("defaultTripType", () => {
  const scanned = (name: string, type: "adult" | "child" | "infant" | null, age: number | null = null) =>
    travellerToDraft({ name, age, age_range: type === "infant" && age == null ? "0-3" : null, preferences: [], type });

  it("two adults → couple (the ABADA booking that came out as a family)", () => {
    expect(defaultTripType([scanned("ROI COHEN", "adult"), scanned("DANA COHEN", "adult")])).toBe("couple");
  });

  it("two adults with a child → family, even with no birth date on the child", () => {
    expect(defaultTripType([scanned("A", "adult"), scanned("B", "adult"), scanned("C", "child")])).toBe("family");
  });

  it("an infant → family", () => {
    expect(defaultTripType([scanned("A", "adult"), scanned("B", "infant")])).toBe("family");
  });

  it("an under-18 age or range → family", () => {
    expect(defaultTripType([scanned("A", null, 40), scanned("B", null, 12)])).toBe("family");
    const range = { name: "B", ageMode: "range" as const, age: "", age_range: "13-17", preferences: [] };
    expect(defaultTripType([scanned("A", null, 40), range])).toBe("family");
  });

  it("a typed age beats the booking marker", () => {
    expect(defaultTripType([scanned("A", "adult"), scanned("B", "child", 19)])).toBe("couple");
  });

  it("one adult → friends", () => {
    expect(defaultTripType([scanned("A", "adult")])).toBe("friends");
  });

  it("four adults → friends", () => {
    expect(defaultTripType(["A", "B", "C", "D"].map((n) => scanned(n, "adult")))).toBe("friends");
  });

  it("travellers with no type or age count as adults", () => {
    expect(defaultTripType([scanned("A", null), scanned("B", null)])).toBe("couple");
  });

  it("no travellers → friends, never family", () => {
    expect(defaultTripType([])).toBe("friends");
  });

  it("ignores rows with no name (they are not saved)", () => {
    const blank = { name: "  ", ageMode: "age" as const, age: "5", age_range: "30-49", preferences: [] };
    expect(defaultTripType([scanned("A", "adult"), scanned("B", "adult"), blank])).toBe("couple");
  });
});

describe("bookingsToDrafts", () => {
  it("routes each booking to its draft list with its file", () => {
    const f = file("all.pdf");
    const bookings: ImportedBooking[] = [
      { docType: "hotel", sourceFile: f, data: { hotel_name: "Hotel Roma" } as never },
      { docType: "car", sourceFile: f, data: { provider: "Hertz" } as never },
    ];
    const { flights, stays, transfers } = bookingsToDrafts({ bookings });
    expect(flights).toHaveLength(0);
    expect(stays[0].hotel_name).toBe("Hotel Roma");
    expect(stays[0].source_file).toBe(f);
    expect(transfers[0].kind).toBe("car_rental");
    expect(transfers[0].provider).toBe("Hertz");
  });
});

describe("joinHebrew / countHe", () => {
  it("joins with ו or ו- before a number", () => {
    expect(joinHebrew(["2 טיסות", "מלון אחד"])).toBe("2 טיסות ומלון אחד");
    expect(joinHebrew(["מלון אחד", "3 נוסעים"])).toBe("מלון אחד ו-3 נוסעים");
    expect(joinHebrew(["טיסה אחת"])).toBe("טיסה אחת");
    expect(joinHebrew([])).toBe("");
  });
  it("uses the singular word for one", () => {
    expect(countHe(1, "טיסה אחת", "טיסות")).toBe("טיסה אחת");
    expect(countHe(3, "טיסה אחת", "טיסות")).toBe("3 טיסות");
  });
});

describe("isTripLimitError", () => {
  it("recognises the trips trigger's limit error", () => {
    expect(isTripLimitError({ message: "agent_trip_limit_reached", code: "23514" })).toBe(true);
  });
  it("ignores other errors and non-objects", () => {
    expect(isTripLimitError({ message: "duplicate key" })).toBe(false);
    expect(isTripLimitError(null)).toBe(false);
    expect(isTripLimitError("agent_trip_limit_reached")).toBe(false);
  });
});

describe("flightDraftFromVoucher", () => {
  const scanned = {
    direction: "inbound",
    airline: "EL AL",
    flight_number: "LY84",
    from_airport: "Bangkok (BKK)",
    to_airport: "Tel Aviv (TLV)",
    depart_at: "2026-03-28T17:00:00",
    arrive_at: "2026-03-29T00:05:00",
    from_terminal: null,
    to_terminal: null,
    seats: null,
    baggage: null,
    booking_ref: null,
    notes: null,
  };

  it("keeps the ticket's wall clock in every process zone (no browser-zone conversion)", () => {
    const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
    const saved = env.TZ;
    try {
      for (const tz of ["Asia/Jerusalem", "America/Los_Angeles", "Asia/Bangkok"]) {
        env.TZ = tz;
        const d = flightDraftFromVoucher(scanned, null);
        expect([d.depart_at, d.arrive_at]).toEqual(["2026-03-28T17:00", "2026-03-29T00:05"]);
      }
    } finally {
      if (saved === undefined) delete env.TZ;
      else env.TZ = saved;
    }
  });
});
