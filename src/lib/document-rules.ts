import { can } from "./permissions";
import type { DocumentRow, TripRole } from "./types";

export const PASSPORT_CATEGORY = "passport";

export type TravellerProblem = "no_travellers" | "pick_traveller";

/**
 * Why this category + traveller can't be saved, or null when it can.
 * trip_passport_count (migration 022) only counts a passport tied to one of the
 * trip's travellers, so a passport saved without one shows up in the documents
 * screen and stays "missing" on the agent board. Other categories are free.
 */
export function documentTravellerProblem(
  category: string,
  participantId: string | null | undefined,
  participants: readonly { id: string }[],
): TravellerProblem | null {
  if (category !== PASSPORT_CATEGORY) return null;
  if (participants.length === 0) return "no_travellers";
  return participants.some((p) => p.id === participantId) ? null : "pick_traveller";
}

/**
 * Mirrors the "uploader update" policy on `documents` (migration 015): only the
 * uploader, and only while they can still participate in the trip. The owner
 * gets no exception, since they may not even be able to read a member's file.
 */
export function canEditDocument(
  doc: Pick<DocumentRow, "uploaded_by">,
  userId: string | null | undefined,
  role: TripRole | null | undefined,
): boolean {
  return !!userId && doc.uploaded_by === userId && can(role, "participate");
}
