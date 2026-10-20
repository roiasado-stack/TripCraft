// Creating a trip from staged drafts (trip-drafts.ts). Shared by the wizard
// (/new) and the agent's "new trip from documents" (/agency/new, via createImportedTrip).
import { supabase } from "./supabase";
import { uploadTripDocument } from "./documents";
import { clientRow, type BookingImport } from "./agency-import";
import type { Participant, Trip } from "./types";
import {
  participantRows,
  toIso,
  type FlightDraft,
  type ParticipantInsert,
  type PartDraft,
  type StayDraft,
  type TransferDraft,
} from "./trip-drafts";

export type NewTripFields = {
  title: string;
  destination: string;
  start_date: string | null;
  end_date: string | null;
  trip_type: string;
  budget_level: string;
  cover_emoji: string;
  guide_name?: string | null;
  guide_phone?: string | null;
};

/**
 * Inserts the trip row, then its participants, flights, stays and transfers in
 * parallel. Throws only when the trip row itself fails (so the caller may offer
 * "try again"); once the trip exists, a failed child insert is counted in
 * `failedChildren` instead — retrying would create a second trip.
 */
export async function insertTripWithDrafts(input: {
  userId: string;
  fields: NewTripFields;
  participants: PartDraft[];
  flights: FlightDraft[];
  stays: StayDraft[];
  transfers: TransferDraft[];
}): Promise<{
  trip: Trip;
  /** Participant rows as inserted (empty if the select came back empty). */
  participants: Participant[];
  partRows: ParticipantInsert[];
  /** The stays that were inserted (drafts with a hotel name). */
  savedStays: StayDraft[];
  failedChildren: number;
}> {
  const { data: trip, error } = await supabase
    .from("trips")
    .insert({ user_id: input.userId, ...input.fields })
    .select()
    .single();
  if (error || !trip) throw error ?? new Error("trip_insert_failed");
  const tripId = (trip as Trip).id;

  // Supabase query builders are thenable, not real Promises.
  const jobs: PromiseLike<{ error: unknown }>[] = [];
  const partRows = participantRows(input.participants);
  let inserted: Participant[] = [];
  if (partRows.length) {
    jobs.push(
      supabase
        .from("participants")
        .insert(partRows.map((r) => ({ trip_id: tripId, ...r })))
        .select()
        .then(({ data, error: e }) => {
          inserted = (data as Participant[] | null) ?? [];
          return { error: e };
        }),
    );
  }
  if (input.flights.length) {
    jobs.push(
      supabase.from("flights").insert(
        input.flights.map((f) => ({
          trip_id: tripId,
          direction: f.direction,
          airline: f.airline || null,
          flight_number: f.flight_number || null,
          from_airport: f.from_airport || null,
          to_airport: f.to_airport || null,
          depart_at: f.depart_at ? new Date(f.depart_at).toISOString() : null,
          arrive_at: toIso(f.arrive_at),
          from_terminal: f.from_terminal || null,
          to_terminal: f.to_terminal || null,
          seats: f.seats || null,
          baggage: f.baggage || null,
          booking_ref: f.booking_ref || null,
          notes: f.notes || null,
        })),
      ),
    );
  }
  const savedStays = input.stays.filter((s) => s.hotel_name.trim());
  if (savedStays.length) {
    jobs.push(
      supabase.from("stays").insert(
        savedStays.map((s) => ({
          trip_id: tripId,
          hotel_name: s.hotel_name.trim(),
          address: s.address || null,
          check_in: s.check_in || null,
          check_out: s.check_out || null,
          booking_ref: s.booking_ref || null,
          phone: s.phone || null,
          url: s.url || null,
          notes: s.notes || null,
        })),
      ),
    );
  }
  if (input.transfers.length) {
    jobs.push(
      supabase.from("transfers").insert(
        input.transfers.map((t) => ({
          trip_id: tripId,
          kind: t.kind,
          provider: t.provider || null,
          pickup_location: t.pickup_location || null,
          pickup_at: t.pickup_at ? new Date(t.pickup_at).toISOString() : null,
          dropoff_location: t.dropoff_location || null,
          return_at: toIso(t.return_at),
          booking_ref: t.booking_ref || null,
          phone: t.phone || null,
          url: t.url || null,
          notes: t.notes || null,
        })),
      ),
    );
  }
  const results = await Promise.all(jobs);
  return {
    trip: trip as Trip,
    participants: inserted,
    partRows,
    savedStays,
    failedChildren: results.filter((r) => r.error).length,
  };
}

/**
 * Keeps the original booking files in trip-docs (private to the uploader).
 * Sequential on purpose: the storage path is `${Date.now()}-${name}`, so two
 * same-named files uploaded in the same millisecond would collide. Never
 * throws; returns how many failed.
 */
export async function uploadSourceDocs(
  userId: string,
  tripId: string,
  docs: { file: File; category: string }[],
): Promise<number> {
  let failed = 0;
  for (const d of docs) {
    try {
      await uploadTripDocument({ userId, tripId, file: d.file, category: d.category });
    } catch (err) {
      console.error(err);
      failed += 1;
    }
  }
  return failed;
}

/**
 * Creates an agent's trip from a BookingImport (agency-import.ts) — the one
 * place an imported trip is written, whatever its source. The trip and its
 * bookings go through insertTripWithDrafts (throws only if the trip row
 * fails); then the owner-only trip_clients row, which records the client, the
 * source and the agency's booking number (migration 025). A failed client row
 * is reported, not thrown: the trip already exists.
 */
export async function createImportedTrip(
  userId: string,
  imp: BookingImport,
  extra: Pick<NewTripFields, "trip_type" | "budget_level" | "cover_emoji">,
): Promise<Awaited<ReturnType<typeof insertTripWithDrafts>> & { clientError: boolean }> {
  const res = await insertTripWithDrafts({
    userId,
    fields: { ...imp.trip, ...extra },
    participants: imp.travellers,
    flights: imp.flights,
    stays: imp.stays,
    transfers: imp.transfers,
  });
  const { error } = await supabase.from("trip_clients").insert(clientRow(res.trip.id, imp));
  if (error) console.error(error);
  return { ...res, clientError: !!error };
}
