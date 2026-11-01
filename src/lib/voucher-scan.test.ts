import { describe, expect, it } from "vitest";
import { scanSummary, scannedRecords } from "./voucher-scan";

const out = { flight_number: "LY 381", from_airport: "TLV", to_airport: "FCO" };
const back = { flight_number: "LY 382", from_airport: "FCO", to_airport: "TLV" };
const rome = { hotel_name: "Hotel Roma Centro", check_in: "2026-11-13" };
const florence = { hotel_name: "Hotel Firenze", check_in: "2026-11-16" };

describe("scannedRecords", () => {
  it("reads every booking of a combined file from items", () => {
    const res = {
      ok: true,
      doc_type: "flight",
      data: out,
      segments: [out, back],
      items: [
        { doc_type: "flight", data: out },
        { doc_type: "flight", data: back },
        { doc_type: "hotel", data: rome },
        { doc_type: "hotel", data: florence },
      ],
    };
    expect(scannedRecords(res).map((r) => r.docType)).toEqual(["flight", "flight", "hotel", "hotel"]);
    expect(scannedRecords(res)[3].data).toBe(florence);
  });

  it("falls back to the old single-booking shape", () => {
    expect(scannedRecords({ ok: true, doc_type: "flight", data: out, segments: [out, back] })).toEqual([
      { docType: "flight", data: out },
      { docType: "flight", data: back },
    ]);
    expect(scannedRecords({ ok: true, doc_type: "flight", data: out })).toEqual([{ docType: "flight", data: out }]);
    expect(scannedRecords({ ok: true, doc_type: "hotel", data: rome, segments: [] })).toEqual([
      { docType: "hotel", data: rome },
    ]);
  });

  it("returns nothing for unknown, failed or malformed answers", () => {
    expect(scannedRecords({ ok: true, doc_type: "unknown", data: null, segments: [], items: [] })).toEqual([]);
    expect(scannedRecords({ ok: true, doc_type: "unknown", data: null })).toEqual([]);
    expect(scannedRecords({ ok: false, error: "llm_failed" })).toEqual([]);
    expect(scannedRecords(null)).toEqual([]);
    expect(scannedRecords({ ok: true, items: [{ doc_type: "train", data: {} }, { doc_type: "hotel", data: null }, "x"] })).toEqual([]);
  });
});

describe("scanSummary", () => {
  it("names a lone booking by its type", () => {
    expect(scanSummary(["hotel"])).toBe("זוהה: מלון");
    expect(scanSummary(["car"])).toBe("זוהה: רכב / העברה");
  });

  it("counts several bookings by type", () => {
    expect(scanSummary(["flight", "flight"])).toBe("זוהו: 2 טיסות");
    expect(scanSummary(["flight", "flight", "hotel", "hotel"])).toBe("זוהו: 2 טיסות ו-2 מלונות");
    expect(scanSummary(["flight", "hotel"])).toBe("זוהו: טיסה אחת ומלון אחד");
    expect(scanSummary(["flight", "flight", "hotel", "car"])).toBe("זוהו: 2 טיסות, מלון אחד והזמנת רכב אחת");
  });
});
