// Transfer times as printed on the voucher (migration 032, docs/plans/2026-11-28-share-transfers.md).
//
// A voucher says "pickup 14:00": the wall clock where the pickup happens. The row keeps that
// string (`pickup_local` / `return_local`); `pickup_at` / `return_at` are only an ordering key the
// transfers_local_times trigger derives (read as Israel time). So writers send the wall clock,
// and readers show it as a string — never through `Date` in the viewer's zone, which turned a
// 14:00 saved in Israel into 16:00 on a phone in the Seychelles.
//
// Pure: no Supabase, no React.

import { formatFlightClock, instantToWall, parseWallClock } from "../../supabase/functions/_shared/flight-time";
import { wallOf } from "./flight-form";

/** The zone the trigger reads a transfer's wall clock in, and the one old rows were typed in. */
const FALLBACK_ZONE = "Asia/Jerusalem";

const pad = (n: number) => String(n).padStart(2, "0");

export type TransferKind = "transfer" | "car_rental";

/** The two kinds the app knows; anything else (a typo, an import) is shown as a transfer. */
export function transferKind(kind: string | null | undefined): TransferKind {
  return kind === "car_rental" ? "car_rental" : "transfer";
}

/**
 * The kind of a scanned "car / transfer" voucher. A rental always has a return time; a
 * shuttle, boat, ferry or seaplane transfer doesn't. Before 032 every scan was saved as a
 * rental, so a scanned ferry showed as "רכב שכור".
 */
export function scannedTransferKind(v: { return_at?: string | null }): TransferKind {
  return v.return_at && v.return_at.trim() ? "car_rental" : "transfer";
}

/**
 * A row's voucher time "YYYY-MM-DDTHH:MM", or null. The local wins; a row without one (a payload
 * from before 032) falls back to its instant read in Israel time — the same rule as the trigger.
 */
export function transferWall(local: string | null | undefined, instant: string | null | undefined): string | null {
  return wallOf(local) ?? (instant ? instantToWall(instant, FALLBACK_ZONE) : null);
}

/** On one line, as printed: he "12.3 14:00", en "12 Mar 14:00"; "" when unknown. */
export function transferStamp(
  local: string | null | undefined,
  instant: string | null | undefined,
  lang: "he" | "en",
): string {
  return formatFlightClock(transferWall(local, instant), lang) ?? "";
}

/** The edit form's date / hour / minute pickers, from the row's voucher time. */
export function transferFormParts(
  local: string | null | undefined,
  instant: string | null | undefined,
): { date: string; hour: string; minute: string } {
  const w = parseWallClock(transferWall(local, instant));
  return w
    ? { date: `${w.year}-${pad(w.month)}-${pad(w.day)}`, hour: pad(w.hour), minute: pad(w.minute) }
    : { date: "", hour: "", minute: "" };
}

/** The pickers → the wall clock to save ("YYYY-MM-DDTHH:MM"), or null without a date. */
export function joinTransferWall(date: string, hour: string, minute: string): string | null {
  if (!date) return null;
  return wallOf(`${date}T${hour || "00"}:${minute || "00"}`);
}

/**
 * The time columns a writer sends for a staged or scanned transfer. Never `pickup_at` /
 * `return_at`: the trigger derives them. A wall-clock string (the scan's "2026-03-28T17:00:00",
 * a datetime-local value) is kept as written; an instant from an older draft is read in Israel time.
 */
export function transferTimesRow(t: { pickup_at?: string | null; return_at?: string | null }): {
  pickup_local: string | null;
  return_local: string | null;
} {
  return { pickup_local: wallOf(t.pickup_at), return_local: wallOf(t.return_at) };
}
