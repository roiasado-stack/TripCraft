import { describe, expect, it } from "vitest";
import {
  bookingsToDrafts,
  collectSourceDocs,
  countHe,
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
