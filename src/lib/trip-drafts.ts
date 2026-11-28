// Trip drafts: what a new trip holds before it exists in the database. Shared by
// the wizard (/new) and the agent's "new trip from documents" (/agency/new) — both
// stage scanned bookings locally and insert them only once the trip is created
// (see create-trip.ts). Pure: no Supabase, no React.
import type { BookingsImportResult, BookingTraveller, PassengerType } from "@/components/ImportBookings";
import type { VoucherCarData, VoucherFlightData, VoucherHotelData } from "@/components/ImportVoucher";
import { AGE_RANGES, type TripType } from "./trip-options";
import { wallOf } from "./flight-form";
import { scannedTransferKind } from "./transfer-times";

export type PartDraft = {
  name: string;
  ageMode: "age" | "range";
  age: string;
  age_range: string;
  preferences: string[];
  /** The booking's passenger marker (adult / child / infant), when a scan found one.
   *  Never saved: it only tells defaultTripType about a child with no birth date. */
  type?: PassengerType | null;
};
// The optional fields below have no wizard UI: they carry voucher-scanned
// detail through to the insert as hidden values (manually added drafts simply
// leave them unset). `source_file` is the scanned original, uploaded to
// trip-docs once the trip exists. Every flight segment scanned from one file
// shares that one File object (collectSourceDocs de-duplicates by identity), so
// the file is dropped only once every draft carrying it has been deleted —
// deleting just one segment never loses it.
export type FlightDraft = {
  direction: "outbound" | "inbound";
  airline: string;
  flight_number: string;
  from_airport: string;
  to_airport: string;
  /** The ticket's wall clock at each airport, "YYYY-MM-DDTHH:MM" (a datetime-local value). */
  depart_at: string;
  arrive_at?: string | null;
  from_terminal?: string | null;
  to_terminal?: string | null;
  seats?: string | null;
  baggage?: string | null;
  booking_ref?: string | null;
  notes?: string | null;
  source_file?: File | null;
};
export type StayDraft = {
  hotel_name: string;
  address: string;
  check_in: string;
  check_out: string;
  booking_ref: string;
  phone?: string | null;
  url?: string | null;
  notes?: string | null;
  source_file?: File | null;
};
export type TransferDraft = {
  kind: string;
  provider: string;
  pickup_location: string;
  /** The voucher's wall clock, "YYYY-MM-DDTHH:MM" (a datetime-local value); saved as pickup_local. */
  pickup_at: string;
  dropoff_location?: string | null;
  return_at?: string | null; // wall clock, as pickup_at
  booking_ref?: string | null;
  phone?: string | null;
  url?: string | null;
  notes?: string | null;
  source_file?: File | null;
};

/** A participant row as inserted (minus trip_id). */
export type ParticipantInsert = { name: string; age: number | null; age_range: string | null; preferences: string[] };

export function flightDraftFromVoucher(d: VoucherFlightData, file: File | null): FlightDraft {
  return {
    direction: d.direction === "inbound" ? "inbound" : "outbound",
    airline: d.airline ?? "",
    flight_number: d.flight_number ?? "",
    from_airport: d.from_airport ?? "",
    to_airport: d.to_airport ?? "",
    // Kept as printed on the ticket — never read in the browser's zone.
    depart_at: wallOf(d.depart_at) ?? "",
    arrive_at: wallOf(d.arrive_at),
    from_terminal: d.from_terminal,
    to_terminal: d.to_terminal,
    seats: d.seats,
    baggage: d.baggage,
    booking_ref: d.booking_ref,
    notes: d.notes,
    source_file: file,
  };
}
export function stayDraftFromVoucher(d: VoucherHotelData, file: File | null): StayDraft {
  return {
    hotel_name: d.hotel_name,
    address: d.address ?? "",
    check_in: d.check_in ?? "",
    check_out: d.check_out ?? "",
    booking_ref: d.booking_ref ?? "",
    phone: d.phone,
    url: d.url,
    notes: d.notes,
    source_file: file,
  };
}
export function transferDraftFromVoucher(d: VoucherCarData, file: File | null): TransferDraft {
  return {
    // A ferry / seaplane / shuttle voucher has no return time; only a rental does.
    kind: scannedTransferKind(d),
    provider: d.provider ?? "",
    pickup_location: d.pickup_location ?? "",
    // Kept as printed on the voucher — never read in the browser's zone.
    pickup_at: wallOf(d.pickup_at) ?? "",
    dropoff_location: d.dropoff_location,
    return_at: wallOf(d.return_at),
    booking_ref: d.booking_ref,
    phone: d.phone,
    url: d.url,
    notes: d.notes,
    source_file: file,
  };
}

/** Booking traveller → participant draft. An unknown age stays unset: exact-age
 *  mode with an empty age saves as age/age_range null, and the user can fill it
 *  in later (same rule as the passport-scan staging). */
export function travellerToDraft(t: BookingTraveller): PartDraft {
  const type = t.type;
  if (t.age != null) {
    return { name: t.name, ageMode: "age", age: String(t.age), age_range: AGE_RANGES[5], preferences: t.preferences, type };
  }
  if (t.age_range) {
    return { name: t.name, ageMode: "range", age: "", age_range: t.age_range, preferences: t.preferences, type };
  }
  return { name: t.name, ageMode: "age", age: "", age_range: AGE_RANGES[5], preferences: t.preferences, type };
}

// Under-18 ranges, as AGE_RANGES lists them ("0-3" … "13-17").
const KID_RANGES = new Set<string>(AGE_RANGES.slice(0, 4));

/** Under 18 by the age typed in, else the age range, else the booking's child/infant marker. */
function isKid(p: PartDraft): boolean {
  if (p.ageMode === "age" && p.age.trim() !== "" && Number.isFinite(Number(p.age))) return Number(p.age) < 18;
  if (p.ageMode === "range") return KID_RANGES.has(p.age_range);
  return p.type === "child" || p.type === "infant";
}

/**
 * The trip type an agency trip starts on, from its travellers (abada-promises
 * phase 4): any child or infant → family; exactly two adults → couple; anything
 * else → friends. That includes no travellers at all: "friends" makes no claim
 * about kids, where the old hard-coded "family" made the AI plan for children.
 * Only named travellers count, as only they are saved (participantRows); a
 * traveller with no age and no child marker counts as an adult.
 */
export function defaultTripType(drafts: PartDraft[]): TripType {
  const named = drafts.filter((p) => p.name.trim());
  if (named.some(isKid)) return "family";
  return named.length === 2 ? "couple" : "friends";
}

/** Reviewed bookings → flight / stay / transfer drafts, each carrying its source file. */
export function bookingsToDrafts(r: Pick<BookingsImportResult, "bookings">): {
  flights: FlightDraft[];
  stays: StayDraft[];
  transfers: TransferDraft[];
} {
  return {
    flights: r.bookings
      .filter((b) => b.docType === "flight")
      .map((b) => flightDraftFromVoucher(b.data as VoucherFlightData, b.sourceFile)),
    stays: r.bookings
      .filter((b) => b.docType === "hotel")
      .map((b) => stayDraftFromVoucher(b.data as VoucherHotelData, b.sourceFile)),
    transfers: r.bookings
      .filter((b) => b.docType === "car")
      .map((b) => transferDraftFromVoucher(b.data as VoucherCarData, b.sourceFile)),
  };
}

/** Named drafts → participant rows. Blank names are dropped. */
export function participantRows(drafts: PartDraft[]): ParticipantInsert[] {
  return drafts
    .filter((p) => p.name.trim())
    .map((p) => ({
      name: p.name.trim(),
      age: p.ageMode === "age" && p.age ? Number(p.age) : null,
      age_range: p.ageMode === "range" ? p.age_range : null,
      preferences: p.preferences,
    }));
}

/**
 * The original booking files to keep in trip-docs, one per distinct File. A
 * multi-segment flight file puts the SAME File object on every segment's draft,
 * so only the first occurrence counts: every original is uploaded exactly once,
 * as long as at least one of its drafts survived.
 */
export function collectSourceDocs(
  flights: FlightDraft[],
  stays: StayDraft[],
  transfers: TransferDraft[],
): { file: File; category: string }[] {
  const seen = new Set<File>();
  return [
    ...flights.map((f) => ({ file: f.source_file, category: "flight" })),
    ...stays.map((s) => ({ file: s.source_file, category: "hotel" })),
    ...transfers.map((t) => ({ file: t.source_file, category: "car" })),
  ].filter((d): d is { file: File; category: string } => {
    if (!d.file || seen.has(d.file)) return false;
    seen.add(d.file);
    return true;
  });
}

/** ["2 טיסות", "מלון אחד", "3 נוסעים"] → "2 טיסות, מלון אחד ו-3 נוסעים". */
export function joinHebrew(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  const last = parts[parts.length - 1];
  return `${parts.slice(0, -1).join(", ")} ${/^\d/.test(last) ? "ו-" : "ו"}${last}`;
}

/** 1 → `one` ("טיסה אחת"), n → "n many" ("3 טיסות"). */
export function countHe(n: number, one: string, many: string): string {
  return n === 1 ? one : `${n} ${many}`;
}

/** A trip-limit hit comes back from the trips trigger (migration 022) as this message. */
export function isTripLimitError(e: unknown): boolean {
  return typeof e === "object" && e !== null && String((e as { message?: string }).message).includes("agent_trip_limit_reached");
}

export const TRIP_LIMIT_MESSAGE = "הגעת למכסת הטיולים הפעילים בחשבון. אפשר למחוק טיול ישן או לפנות אלינו.";
