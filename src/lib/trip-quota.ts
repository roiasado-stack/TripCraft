import { LEGAL } from "@/lib/legal";
import { isTripLimitError, TRIP_LIMIT_MESSAGE } from "@/lib/trip-drafts";

/** What `my_trip_quota()` (migration 029) returns. `limit` null = no private limit applies
 *  (active agent, admin, demo visitor). */
export type TripQuota = { limit: number | null; used: number; has_sample: boolean };

/** The RPC's JSON as a TripQuota, or null when it isn't the expected shape. */
export function parseTripQuota(data: unknown): TripQuota | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  const limit = d.limit === null || d.limit === undefined ? null : Number(d.limit);
  const used = Number(d.used);
  if ((limit !== null && !Number.isInteger(limit)) || !Number.isInteger(used)) return null;
  return { limit, used, has_sample: d.has_sample === true };
}

/** True only when the account is known to be private and full. Unknown (loading, failed call)
 *  is false: the screen doesn't block, and the trips trigger stays the real gate. */
export function atTripLimit(q: TripQuota | null | undefined): boolean {
  return !!q && q.limit !== null && q.used >= q.limit;
}

export const PRIVATE_TRIP_LIMIT_TITLE = "בחשבון פרטי אפשר לנהל טיול אחד";
export const PRIVATE_TRIP_LIMIT_MESSAGE = `${PRIVATE_TRIP_LIMIT_TITLE}. כדי לפתוח טיול חדש, מחקו את הקודם או כתבו לנו ל-${LEGAL.contactEmail}`;
export const SAMPLE_TRIP_LIMIT_MESSAGE = "כבר יש לך טיול לדוגמה ברשימה.";

function messageOf(e: unknown): string {
  if (typeof e === "string") return e;
  if (typeof e === "object" && e !== null) return String((e as { message?: unknown }).message ?? "");
  return "";
}

/** The Hebrew message for a trip-limit error from the trips triggers (agents: 022, private
 *  accounts and the sample trip: 029), or null for any other error. */
export function tripLimitMessage(e: unknown): string | null {
  if (typeof e !== "object" || e === null) return null;
  const m = messageOf(e);
  if (m.includes("private_trip_limit_reached")) return PRIVATE_TRIP_LIMIT_MESSAGE;
  if (m.includes("sample_trip_limit_reached")) return SAMPLE_TRIP_LIMIT_MESSAGE;
  if (isTripLimitError(e)) return TRIP_LIMIT_MESSAGE;
  return null;
}
