/** What the join page does next, given where the user stands on the trip. */
export type JoinStep = "open_trip" | "wait" | "removed" | "gone";

/** A waiting check can also fail, which changes nothing: the next check retries. */
export type WaitingCheckStep = JoinStep | "retry";

/**
 * Maps a status from accept_trip_invite ('owner' included) or from the user's own
 * trip_members row to the next step. null means the row is gone. An unknown status
 * keeps waiting, so a new value can't tell someone they were refused.
 */
export function stepForMemberStatus(status: string | null | undefined): JoinStep {
  if (status === null || status === undefined) return "gone";
  if (status === "active" || status === "owner") return "open_trip";
  if (status === "removed") return "removed";
  return "wait";
}

/** The step after one check of the row. A failed read says nothing about the row. */
export function stepAfterWaitingCheck(failed: boolean, status: string | null | undefined): WaitingCheckStep {
  return failed ? "retry" : stepForMemberStatus(status);
}
