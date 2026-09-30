import type { MemberRole, TripRole } from "./types";

/**
 * What each trip role may do. Mirrors the RLS policies in migration 015 —
 * the database is the authority; this only decides which controls to show.
 *
 * - manage: delete the trip, public sharing / showcase, invites and members
 * - edit: trip details, flights, stays, transfers, itinerary, participants,
 *   deleting suggestions, anyone's trip updates
 * - participate: checklist, liking and adding suggestions, posting updates,
 *   uploading own documents, AI chat and suggestion/checklist generation
 */
export type TripAction = "manage" | "edit" | "participate";

const ALLOWED: Record<TripAction, TripRole[]> = {
  manage: ["owner"],
  edit: ["owner", "editor"],
  participate: ["owner", "editor", "participant"],
};

export function can(role: TripRole | null | undefined, action: TripAction): boolean {
  return !!role && ALLOWED[action].includes(role);
}

export const ROLE_LABELS: Record<TripRole, string> = {
  owner: "בעלים",
  editor: "עורך",
  participant: "משתתף",
  viewer: "צופה",
};

export const ROLE_HINTS: Record<MemberRole, string> = {
  viewer: "רואה את כל הטיול, לא משנה כלום",
  participant: "רואה הכול, מסמן בצ'קליסט, ממליץ ומפרסם עדכונים",
  editor: "עורך הכול חוץ ממחיקת הטיול, שיתוף וחברים",
};
