// The agent's trip list (/agent): one status per trip, the "needs handling"
// notes and search, all derived from an agent_trip_board() row (migration 022).
import type { AgentAttentionFlag, AgentTripBoardRow } from "./types";
import { tripPhase } from "./trip-dates";

export type AgentTripStatus = "draft" | "sent" | "soon" | "abroad" | "back" | "attention";

export const AGENT_STATUS_LABEL: Record<AgentTripStatus, string> = {
  draft: "טיוטה",
  sent: "נשלח",
  soon: "יוצא בקרוב",
  abroad: 'בחו"ל',
  back: "חזר",
  attention: "חסר משהו",
};

/** Flags that mean something is actually missing (not just "leaving soon" or "nobody joined yet"). */
const MISSING: AgentAttentionFlag[] = ["missing_passports", "pending_members", "no_dates"];

type StatusRow = Pick<
  AgentTripBoardRow,
  "start_date" | "end_date" | "is_shared" | "members_joined" | "members_pending" | "needs_attention"
>;

/**
 * One status per trip, first match wins:
 * back (it's over) → abroad (on it now) → draft (the client hasn't got it:
 * no public link and nobody invited) → attention (a passport, an approval or
 * the dates are missing) → soon (leaves within a week) → sent.
 */
export function agentTripStatus(row: StatusRow, today: Date): AgentTripStatus {
  const phase = tripPhase(row, today);
  if (phase === "past") return "back";
  if (phase === "now") return "abroad";
  if (!row.is_shared && row.members_joined === 0 && row.members_pending === 0) return "draft";
  if (row.needs_attention.some((f) => MISSING.includes(f))) return "attention";
  if (row.needs_attention.includes("departing_soon")) return "soon";
  return "sent";
}

/** The "דורשים טיפול" filter: anything the board flags (empty once the trip is over). */
export function needsHandling(row: Pick<AgentTripBoardRow, "needs_attention">): boolean {
  return row.needs_attention.length > 0;
}

/** Short Hebrew notes for what's missing, shown under the row. "Leaving soon" is the status chip's job. */
export function attentionNotes(
  row: Pick<AgentTripBoardRow, "needs_attention" | "participants_count" | "passports_count" | "members_pending">,
): string[] {
  const notes: string[] = [];
  for (const flag of row.needs_attention) {
    if (flag === "missing_passports") {
      const missing = Math.max(row.participants_count - row.passports_count, 0);
      notes.push(missing === 1 ? "חסר דרכון אחד" : `חסרים ${missing} דרכונים`);
    } else if (flag === "pending_members") {
      notes.push(row.members_pending === 1 ? "מצטרף אחד מחכה לאישור" : `${row.members_pending} מצטרפים מחכים לאישור`);
    } else if (flag === "not_joined") {
      notes.push("אף נוסע עוד לא הצטרף");
    } else if (flag === "no_dates") {
      notes.push("אין תאריכים");
    }
  }
  return notes;
}

/** "הצטרפו 2 · דרכונים 3/4" — the counters line of a row. */
export function boardCounters(
  row: Pick<AgentTripBoardRow, "members_joined" | "participants_count" | "passports_count">,
): string {
  const joined = `הצטרפו ${row.members_joined}`;
  if (row.participants_count === 0) return `${joined} · עוד אין נוסעים`;
  return `${joined} · דרכונים ${Math.min(row.passports_count, row.participants_count)}/${row.participants_count}`;
}

/** Case- and spacing-insensitive search over client name, destination and trip title. */
export function matchesBoardQuery(
  row: Pick<AgentTripBoardRow, "client_name" | "destination" | "title">,
  query: string,
): boolean {
  const norm = (s: string | null | undefined) => (s ?? "").toLocaleLowerCase().replace(/\s+/g, " ").trim();
  const q = norm(query);
  if (!q) return true;
  return [row.client_name, row.destination, row.title].some((f) => norm(f).includes(q));
}

/**
 * Work order for the list: trips on now and coming up first (soonest first,
 * undated ones after the dated), then the ones that are over (latest first).
 */
export function sortBoard<T extends Pick<AgentTripBoardRow, "start_date" | "end_date">>(rows: T[], today: Date): T[] {
  const day = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null);
  const past = (r: T) => tripPhase(r, today) === "past";
  return [...rows].sort((a, b) => {
    if (past(a) !== past(b)) return past(a) ? 1 : -1;
    if (past(a)) return (day(b.end_date ?? b.start_date) ?? "").localeCompare(day(a.end_date ?? a.start_date) ?? "");
    return (day(a.start_date) ?? "9999").localeCompare(day(b.start_date) ?? "9999");
  });
}

/** 1 → "טיול אחד", n → "n טיולים". */
export function tripsCountHe(n: number): string {
  return n === 1 ? "טיול אחד" : `${n} טיולים`;
}
