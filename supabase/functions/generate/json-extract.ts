/**
 * Pulling JSON out of the model's reply. Pure (no Deno/Node imports):
 * unit-tested from src/lib/generate-json-extract.test.ts.
 *
 * One stray character used to cost the whole reply: an 18-day itinerary
 * (9k tokens, ~40 items) came back with a plain quote inside one Hebrew
 * description, JSON.parse rejected the outer object, and nothing was saved
 * (production, 2026-11-15). So: parse as-is; else repair stray quotes; else
 * keep every item that parses on its own.
 */

/**
 * A plain double quote that JSON syntax could be using always touches syntax:
 * it follows `{ [ , :` or comes before `, } ] :` (whitespace aside). Any other
 * unescaped quote sits inside a value ("מקדש "Big Buddha" בפוקט", "מסך 5"") and
 * would end the string early, so it becomes the gershayim mark ״. Valid JSON
 * comes out unchanged.
 */
export function repairStrayQuotes(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== '"' || text[i - 1] === "\\") {
      out += c;
      continue;
    }
    let p = out.length - 1;
    while (p >= 0 && /\s/.test(out[p])) p--;
    let n = i + 1;
    while (n < text.length && /\s/.test(text[n])) n++;
    const prev = p >= 0 ? out[p] : "";
    const next = n < text.length ? text[n] : "";
    const touchesSyntax = prev === "" || next === "" || "{[,:".includes(prev) || ",}]:".includes(next);
    out += touchesSyntax ? c : "״";
  }
  return out;
}

function parseObject(s: string): Record<string, unknown> | null {
  for (const candidate of [s, repairStrayQuotes(s)]) {
    try {
      const v = JSON.parse(candidate);
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/**
 * Every top-level JSON object in the reply, in order. A long answer sometimes
 * arrives split into several blocks (e.g. one fenced ```json block per
 * itinerary day); taking only the first block silently dropped the rest.
 * Brace-matching respects string literals, so braces inside values are safe;
 * quotes outside any object (prose) are ignored. An `{"items":[...]}` object
 * that won't parse even after repair is replaced by the items inside it that do.
 */
export function extractJsonObjects(rawText: string, salvage = true): Record<string, unknown>[] {
  // Hebrew abbreviations (אונסק"ו, חב"ד, ארה"ב) are often written with a plain
  // double quote. A quote between two Hebrew letters can never be JSON syntax,
  // so turning it into the proper gershayim (״) is always safe.
  const text = rawText.replace(/([֐-׿])"(?=[֐-׿])/g, "$1״");
  const out: Record<string, unknown>[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      if (depth > 0) inString = true;
    } else if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}" && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        const slice = text.slice(start, i + 1);
        const v = parseObject(slice);
        if (v) {
          out.push(v);
        } else if (salvage && /^\{\s*"items"\s*:\s*\[/.test(slice)) {
          const items = extractJsonObjects(slice.slice(1, -1), false);
          if (items.length) out.push({ items });
        }
        start = -1;
      }
    }
  }
  // A reply cut off at max_tokens never closes its `{"items":[...` object:
  // keep the items that were finished before the cut.
  if (salvage && depth > 0 && start >= 0 && /^\{\s*"items"\s*:\s*\[/.test(text.slice(start))) {
    const items = extractJsonObjects(text.slice(start + 1), false);
    if (items.length) out.push({ items });
  }
  return out;
}

/**
 * Generic enough for both `{items:[...]}` (suggestions/itinerary/checklist/passports)
 * and `{doc_type, data}` (voucher) shaped responses. When the reply holds several
 * `{items:[...]}` objects, their items are concatenated into one. When a stray
 * quote broke the brace-matching itself (so no items came out), the whole reply
 * is scanned again after repair.
 */
export function extractJson(text: string): Record<string, unknown> | null {
  let objects = extractJsonObjects(text);
  const hasItems = (list: Record<string, unknown>[]) =>
    list.some((o) => Array.isArray(o.items) && (o.items as unknown[]).length > 0);
  if (!hasItems(objects) && text.includes('"items"')) {
    const repaired = extractJsonObjects(repairStrayQuotes(text));
    if (hasItems(repaired)) objects = repaired;
  }
  if (!objects.length) return null;
  const withItems = objects.filter((o) => Array.isArray(o.items));
  if (withItems.length > 1) {
    return { ...withItems[0], items: withItems.flatMap((o) => o.items as unknown[]) };
  }
  return withItems[0] ?? objects[0];
}
