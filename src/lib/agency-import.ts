// The one shape every agent-trip import goes through (agency workspace, phase 3).
// Today there is one source, the document scan of /agency/new. A later
// connection to an agency's own system (booking system, CRM) becomes another
// ImportSource that produces the same BookingImport, and createImportedTrip
// (create-trip.ts) stays the only place that writes it. Pure: no Supabase here.
// See docs/agency-integrations.md.
import type { BookingsImportResult } from "@/components/ImportBookings";
import { bookingsToDrafts, type FlightDraft, type PartDraft, type StayDraft, type TransferDraft } from "./trip-drafts";

/** Mirrors the CHECK on trip_clients.source (migration 025). A new source adds its value there first. */
export const IMPORT_SOURCES = ["manual", "documents"] as const;
export type ImportSourceKind = (typeof IMPORT_SOURCES)[number];

/** Hebrew label of where a trip came from, for the agent's screens. */
export const IMPORT_SOURCE_LABEL: Record<ImportSourceKind, string> = {
  manual: "נוצר ידנית",
  documents: "נוצר ממסמכים",
};

export function isImportSource(v: unknown): v is ImportSourceKind {
  return typeof v === "string" && (IMPORT_SOURCES as readonly string[]).includes(v);
}

/** Same ceiling as trip_clients.external_ref (migration 025). */
export const EXTERNAL_REF_MAX = 80;

export interface BookingImport {
  source: ImportSourceKind;
  /** The agency's own booking/file number for this trip, if the source knows it. */
  externalRef: string | null;
  client: { name: string | null; phone: string | null; email: string | null };
  trip: { title: string; destination: string; start_date: string | null; end_date: string | null };
  travellers: PartDraft[];
  flights: FlightDraft[];
  stays: StayDraft[];
  transfers: TransferDraft[];
}

/** A place bookings come from: turns its own input into a BookingImport. */
export interface ImportSource<Input> {
  kind: ImportSourceKind;
  toImport(input: Input): BookingImport;
}

/**
 * The agency's booking number as stored: trimmed, inner whitespace collapsed,
 * null when empty. Too long → null too, so a bad value never blocks creating
 * the trip (the CHECK would reject it).
 */
export function normalizeExternalRef(raw: string | null | undefined): string | null {
  const v = (raw ?? "").replace(/\s+/g, " ").trim();
  return v && v.length <= EXTERNAL_REF_MAX ? v : null;
}

const key = (...parts: (string | null | undefined)[]) =>
  parts.map((p) => (p ?? "").trim().toLowerCase().replace(/\s+/g, " ")).join("|");

function uniqueBy<T>(items: T[], k: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = k(item);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * Drops bookings that came in twice (the same voucher scanned again, or a
 * future source re-sending what it sent). One booking number can cover several
 * segments (a return flight on one PNR), so the key is the booking plus what
 * tells its parts apart. The first copy wins.
 */
export function dedupeBookings(imp: BookingImport): BookingImport {
  return {
    ...imp,
    flights: uniqueBy(imp.flights, (f) => key(f.booking_ref, f.flight_number, f.depart_at, f.direction)),
    stays: uniqueBy(imp.stays, (s) => key(s.booking_ref, s.hotel_name, s.check_in)),
    transfers: uniqueBy(imp.transfers, (t) => key(t.booking_ref, t.kind, t.provider, t.pickup_at)),
  };
}

/** The trip_clients row for an imported trip (owner-only, migration 022/024/025). */
export function clientRow(tripId: string, imp: BookingImport) {
  return {
    trip_id: tripId,
    client_name: imp.client.name?.trim() || null,
    client_phone: imp.client.phone?.trim() || null,
    client_email: imp.client.email?.trim() || null,
    source: imp.source,
    external_ref: normalizeExternalRef(imp.externalRef),
  };
}

/**
 * What the document scan of /agency/new hands over (each ImportBookings result,
 * in the order scanned), plus the agent's review screen.
 */
export type DocumentsInput = {
  scans: Pick<BookingsImportResult, "bookings">[];
  client: { name: string; phone: string };
  trip: { title: string; destination: string; start_date: string; end_date: string };
  travellers: PartDraft[];
};

/** The first source: bookings recognised from the agent's documents. */
export const documentsSource: ImportSource<DocumentsInput> = {
  kind: "documents",
  toImport(input) {
    const drafts = input.scans.map((s) => bookingsToDrafts(s));
    return dedupeBookings({
      source: "documents",
      externalRef: null,
      client: { name: input.client.name, phone: input.client.phone, email: null },
      trip: {
        title: input.trip.title,
        destination: input.trip.destination,
        start_date: input.trip.start_date || null,
        end_date: input.trip.end_date || null,
      },
      travellers: input.travellers,
      flights: drafts.flatMap((d) => d.flights),
      stays: drafts.flatMap((d) => d.stays),
      transfers: drafts.flatMap((d) => d.transfers),
    });
  },
};
