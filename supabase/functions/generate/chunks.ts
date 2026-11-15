/**
 * A long itinerary in parts. One model call for a long trip doesn't fit the
 * Supabase Free plan's 150 s per request or the 16k output cap (an 18-day trip
 * took 128 s and 13.7k tokens, 2026-11-15), so `generate` plans more than a
 * week of days as parts of up to a week, cut where the hotel changes, all run
 * in parallel inside the one request. Pure (no Deno/Node imports):
 * unit-tested from src/lib/generate-chunks.test.ts.
 */

/** Most days the model plans in one call. More than this → parts. */
export const CHUNK_MAX_DAYS = 7;
/** Most parts per request (35 days); later days wait for the next AI press. */
export const MAX_CHUNKS = 5;

export type ItineraryChunk = {
  days: string[];
  /** Its first day is in a stay that began in the previous part (a long stay split in two). */
  stayFromPrevious: boolean;
  /** Its last day is in a stay that goes on into the next part. */
  stayIntoNext: boolean;
};

/**
 * The days the AI plans: the trip days that have no item yet — or, when every
 * day already has items (or there are no trip days to tell), `allPlanned`:
 * add a few complementary activities instead of a second full plan.
 */
export function itineraryScope(
  days: string[],
  existingDays: (string | null | undefined)[],
): { planDays: string[]; allPlanned: boolean } {
  const planned = new Set(existingDays.filter((d): d is string => !!d));
  const planDays = days.filter((d) => !planned.has(d));
  return { planDays, allPlanned: existingDays.length > 0 && planDays.length === 0 };
}

/**
 * Splits the days to plan into parallel parts. Cuts first where the hotel
 * changes (`breakDays`, from moveDays — a change on a day that's already
 * planned cuts at the next day being planned), splits a stay longer than
 * `maxDays` into even parts, then packs neighbouring pieces up to `maxDays`.
 * At most `maxChunks` parts; the rest come back as `deferred`.
 * `maxDays` days or fewer → one part (a single call, as before).
 */
export function planItineraryChunks(
  planDays: string[],
  breakDays: string[],
  opts: { maxDays?: number; maxChunks?: number } = {},
): { chunks: ItineraryChunk[]; deferred: string[] } {
  const maxDays = Math.max(1, opts.maxDays ?? CHUNK_MAX_DAYS);
  const maxChunks = Math.max(1, opts.maxChunks ?? MAX_CHUNKS);
  const days = [...new Set(planDays)].sort();
  if (!days.length) return { chunks: [], deferred: [] };
  if (days.length <= maxDays) return { chunks: [{ days, stayFromPrevious: false, stayIntoNext: false }], deferred: [] };

  // Stays: a new one starts at the first planned day on or after each hotel change.
  const stays: string[][] = [];
  let prev: string | null = null;
  for (const d of days) {
    const from = prev;
    if (from === null || breakDays.some((b) => from < b && b <= d)) stays.push([d]);
    else stays[stays.length - 1].push(d);
    prev = d;
  }

  // A stay longer than maxDays → the fewest even pieces (15 → 5/5/5).
  const pieces: { days: string[]; stay: number }[] = [];
  stays.forEach((stay, i) => {
    const n = Math.ceil(stay.length / maxDays);
    const base = Math.floor(stay.length / n);
    let at = 0;
    for (let k = 0; k < n; k++) {
      const size = base + (k < stay.length % n ? 1 : 0);
      pieces.push({ days: stay.slice(at, at + size), stay: i });
      at += size;
    }
  });

  // Neighbouring pieces share a part while they fit: fewest calls, and a stay
  // is only ever split by the step above.
  const parts: { days: string[]; firstStay: number; lastStay: number }[] = [];
  for (const p of pieces) {
    const last = parts[parts.length - 1];
    if (last && last.days.length + p.days.length <= maxDays) {
      last.days.push(...p.days);
      last.lastStay = p.stay;
    } else {
      parts.push({ days: [...p.days], firstStay: p.stay, lastStay: p.stay });
    }
  }

  const chunks = parts.map((p, i) => ({
    days: p.days,
    stayFromPrevious: i > 0 && parts[i - 1].lastStay === p.firstStay,
    stayIntoNext: i < parts.length - 1 && parts[i + 1].firstStay === p.lastStay,
  }));
  return { chunks: chunks.slice(0, maxChunks), deferred: chunks.slice(maxChunks).flatMap((c) => c.days) };
}

/**
 * The itinerary prompt's lines for one part: plan only its days, and — when
 * a stay is split between parts that can't see each other — which kind of
 * places this part takes, so two parts don't pick the same sights.
 */
export function chunkPromptLines(chunk: ItineraryChunk): string {
  const lines = [
    `- המסלול נבנה בחלקים. בחלק הזה תכנן רק את הימים: ${chunk.days.join(", ")}. שאר ימי הטיול מתוכננים בנפרד — אל תוסיף להם פריטים.`,
  ];
  if (chunk.stayFromPrevious && chunk.stayIntoNext) {
    lines.push(
      "- אתה באמצע שהייה ארוכה באותו מקום: הימים שלפני כן מתוכננים בנפרד עם האטרקציות המרכזיות, והימים שאחרי כן עם טיולי יום. כאן תכנן שכונות, שווקים ומקומות פחות מוכרים במקום עצמו.",
    );
  } else if (chunk.stayFromPrevious) {
    lines.push(
      "- הימים הקודמים באותו מקום מתוכננים בנפרד ומכסים את האטרקציות המרכזיות שלו. כאן העדף טיולי יום, שכונות ומקומות פחות מוכרים.",
    );
  } else if (chunk.stayIntoNext) {
    lines.push(
      "- הימים הבאים באותו מקום מתוכננים בנפרד עם טיולי יום ומקומות פחות מוכרים. כאן התמקד באטרקציות המרכזיות של המקום.",
    );
  }
  return lines.join("\n");
}
