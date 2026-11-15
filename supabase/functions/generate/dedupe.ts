/**
 * Duplicate filtering for AI-generated suggestions / itinerary items, so a
 * repeated AI press — or two parts of a long itinerary planned in parallel —
 * doesn't add the same place twice. Pure (no Deno/Node imports): unit-tested
 * from src/lib/generate-dedupe.test.ts.
 */

/**
 * Title key used to spot the same place twice: drops any parenthetical
 * ("קברי המלכים (Tombs of the Kings)" == "קברי המלכים"), Hebrew niqqud and
 * cantillation, quotes (incl. ״ ׳), other punctuation/symbols (incl. maqaf), lowercases
 * Latin and collapses whitespace. Falls back to the un-stripped form when the
 * whole title was inside parentheses, so it only comes back empty for a title
 * with no letters or digits at all.
 */
export function normalizeTitle(title: string): string {
  const clean = (s: string) =>
    s
      .replace(/[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/g, "")
      // Quotes/gershayim sit inside a word (אונסק״ו == אונסקו) — delete them;
      // any other punctuation or symbol (hyphen, maqaf, comma…) separates words.
      .replace(/["'`\u05F3\u05F4\u2018\u2019\u201C\u201D]/g, "")
      .replace(/[\p{P}\p{S}]/gu, " ")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  const s = title.normalize("NFKC");
  return clean(s.replace(/\([^)]*\)/g, " ")) || clean(s);
}

export type DupRow = { title: string; day_date?: string | null; category?: string | null };

// In the itinerary, meals, free time and transport legitimately repeat day to
// day ("ארוחת בוקר במלון"), so those are unique per day only.
const PER_DAY = new Set(["food", "free", "transport"]);

function perDay(r: DupRow, itinerary: boolean): boolean {
  return itinerary && PER_DAY.has(r.category ?? "");
}

/** The normalized title; `day|title` for a per-day itinerary item; "" when the title has no letters. */
export function dupKey(r: DupRow, itinerary: boolean): string {
  const t = normalizeTitle(r.title);
  if (!t) return "";
  return perDay(r, itinerary) ? `${r.day_date ?? ""}|${t}` : t;
}

/**
 * Safety net behind the prompt's "don't repeat" list: drops an item whose key
 * matches an existing row of this table or an earlier item in `list`. A place
 * or activity stays unique across the whole trip. In the itinerary a place is
 * also known by its English Wikipedia article (`wikiTitle`, already cleaned by
 * the caller): "Grand Palace" under two Hebrew names is one place — the case
 * when parts of a long trip are planned in parallel without seeing each other.
 */
export function dropDuplicates<T extends { row: DupRow; wikiTitle?: string | null }>(
  list: T[],
  existing: DupRow[],
  itinerary: boolean,
): T[] {
  const seen = new Set(existing.map((r) => dupKey(r, itinerary)).filter(Boolean));
  return list.filter((item) => {
    const keys = [dupKey(item.row, itinerary)];
    if (itinerary && item.wikiTitle && !perDay(item.row, itinerary)) keys.push(`wiki:${item.wikiTitle.toLowerCase()}`);
    const real = keys.filter(Boolean);
    if (!real.length) return true;
    if (real.some((k) => seen.has(k))) return false;
    for (const k of real) seen.add(k);
    return true;
  });
}
