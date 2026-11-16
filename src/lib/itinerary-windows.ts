/**
 * The AI itinerary of a long trip is built a few days per call: one call for
 * 18 days ran past the Edge Function's 150s limit and saved nothing. The
 * client sends `days: [from, to]` (1 = the trip's start_date) per call, in
 * order, and the function clips the plan to that window (see
 * supabase/functions/generate/day-window.ts, which caps a window at 7 days).
 */

/** Days per call: an 18-day trip plans in four 40-65s calls (local, 2026-11-16) instead of one 130-150s+ call. */
export const ITINERARY_WINDOW_DAYS = 5;

export type DayWindow = [number, number];

/** 1..total cut into ceil(total / size) windows of near-equal length, in order. */
export function splitDayWindows(total: number, size = ITINERARY_WINDOW_DAYS): DayWindow[] {
  if (!Number.isInteger(total) || total < 1 || size < 1) return [];
  const count = Math.ceil(total / size);
  const out: DayWindow[] = [];
  let from = 1;
  for (let i = 0; i < count; i++) {
    const len = Math.floor(total / count) + (i < total % count ? 1 : 0);
    out.push([from, from + len - 1]);
    from += len;
  }
  return out;
}

/**
 * The calls one AI press makes, as windows (null = one call without a window,
 * exactly as before windows existed):
 * - no dates, or a trip that fits one window → [null];
 * - otherwise every window that still has an empty day, in order (a window
 *   whose days all hold items is skipped — the function would only plan empty
 *   days anyway);
 * - when every day already holds items → [null], the function's "add a few
 *   complementary activities" mode over the whole trip, as before.
 */
export function itineraryCalls(tripDays: string[], plannedDays: Iterable<string>): (DayWindow | null)[] {
  const windows = splitDayWindows(tripDays.length);
  if (windows.length <= 1) return [null];
  const planned = new Set(plannedDays);
  const open = windows.filter(([from, to]) => tripDays.slice(from - 1, to).some((d) => !planned.has(d)));
  return open.length ? open : [null];
}

/** "בונה ימים 6–10 מתוך 18" while a window is being planned. */
export function windowProgressLabel(window: DayWindow, total: number): string {
  const [from, to] = window;
  return from === to ? `בונה יום ${from} מתוך ${total}` : `בונה ימים ${from}–${to} מתוך ${total}`;
}

export type WindowCallResult = { ok: boolean; error?: string; inserted?: number; empty?: boolean };

export type WindowRunResult = {
  inserted: number;
  /** Windows that saved nothing, in order. */
  failed: DayWindow[];
  /** The first failed call's error code (mapInvokeError's vocabulary). */
  error?: string;
};

// Errors that will fail every later window too: stop instead of spending more calls.
const FATAL = new Set(["daily_cap_reached", "monthly_cap_reached", "not_deployed", "forbidden", "unauthorized", "demo_not_allowed"]);

/**
 * Runs the windows one after the other, so each call sees what the earlier
 * ones saved. A window that fails (or saves nothing) is recorded and the next
 * one still runs; a cap / access error stops the run and counts every
 * remaining window as failed. Days already saved stay saved either way.
 */
export async function runItineraryWindows(
  windows: DayWindow[],
  call: (window: DayWindow) => Promise<WindowCallResult>,
  onWindow?: (window: DayWindow, phase: "start" | "done") => void,
): Promise<WindowRunResult> {
  const result: WindowRunResult = { inserted: 0, failed: [] };
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    onWindow?.(w, "start");
    const res = await call(w);
    onWindow?.(w, "done");
    if (res.ok && !res.empty) {
      result.inserted += res.inserted ?? 0;
      continue;
    }
    result.error ??= res.ok ? "no_items" : res.error;
    if (!res.ok && res.error && FATAL.has(res.error)) {
      result.failed.push(...windows.slice(i));
      break;
    }
    result.failed.push(w);
  }
  return result;
}

/** "16.3" for "2027-03-16" — string arithmetic, no time zone involved. */
function shortDate(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${d}.${m}`;
}

/** Consecutive failed windows merged into ranges: [1,5],[6,10],[16,18] → [1,10],[16,18]. */
function mergeWindows(windows: DayWindow[]): DayWindow[] {
  const out: DayWindow[] = [];
  for (const [from, to] of [...windows].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

/**
 * The missing days for the error toast, by day number and date:
 * "ימים 6–10 (16.3–20.3)", "יום 18 (28.3)", joined with "ו".
 */
export function missingDaysText(failed: DayWindow[], tripDays: string[]): string {
  const parts = mergeWindows(failed).map(([from, to]) => {
    const a = tripDays[from - 1];
    const b = tripDays[to - 1];
    if (from === to) return `יום ${from}${a ? ` (${shortDate(a)})` : ""}`;
    return `ימים ${from}–${to}${a && b ? ` (${shortDate(a)}–${shortDate(b)})` : ""}`;
  });
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} ו${parts[parts.length - 1]}`;
}
