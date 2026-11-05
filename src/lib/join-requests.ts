// The agent's join-requests screen (/agency/requests): what the count link
// says, whether approving also adds a traveller, and where a join push lands.

/** Trimmed and case-folded, so "  Dana Levi " and "dana levi" are one traveller. */
export function travellerNameKey(name: string): string {
  return name.trim().toLowerCase();
}

export type AddTravellerPlan =
  | { kind: "no_name" }
  | { kind: "exists" }
  | { kind: "insert"; name: string };

/**
 * What "approve and add to travellers" does after the approval: nothing without
 * a name, nothing if the trip already has that name (imported from the booking,
 * say), otherwise insert the trimmed name.
 */
export function planAddTraveller(displayName: string | null | undefined, existingNames: string[]): AddTravellerPlan {
  const name = displayName?.trim();
  if (!name) return { kind: "no_name" };
  const key = travellerNameKey(name);
  if (existingNames.some((n) => travellerNameKey(n) === key)) return { kind: "exists" };
  return { kind: "insert", name };
}

/** All waiting requests on the board (agent_trip_board().members_pending per trip). */
export function pendingRequestsTotal(rows: { members_pending: number }[]): number {
  return rows.reduce((sum, r) => sum + r.members_pending, 0);
}

export function pendingRequestsLabel(count: number): string {
  return count === 1 ? "בקשת הצטרפות אחת ממתינה לאישור" : `${count} בקשות הצטרפות ממתינות לאישור`;
}

export type JoinPushLanding = "agent_requests" | "members_sheet" | "none";

/**
 * Where /trip/<id>?members=1 (the join-request push) takes the caller. Only an
 * agent who owns the trip moves to the requests screen; any other owner gets
 * the trip's members sheet, and someone who can't manage the trip gets nothing.
 */
export function joinPushLanding(canManage: boolean, isAgent: boolean): JoinPushLanding {
  if (!canManage) return "none";
  return isAgent ? "agent_requests" : "members_sheet";
}
