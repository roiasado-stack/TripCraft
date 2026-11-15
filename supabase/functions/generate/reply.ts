/**
 * Reading the model's reply: its text blocks, and the JSON objects in them.
 * Pure (no Deno/Node imports): unit-tested from src/lib/generate-reply.test.ts.
 */

/**
 * Anthropic responses aren't guaranteed to put the reply in content[0] — a
 * leading non-text block (e.g. thinking) pushes it later. Concatenate every
 * text block instead of indexing positionally.
 */
export function extractText(payload: unknown): string {
  const blocks = (payload as { content?: unknown[] })?.content;
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((b): b is { type: string; text: string } => (b as { type?: string })?.type === "text")
    .map((b) => b.text)
    .join("\n");
}

/**
 * Every top-level JSON object in the reply, in order. A long answer sometimes
 * arrives split into several blocks (e.g. one fenced ```json block per
 * itinerary day); taking only the first block silently dropped the rest.
 * Brace-matching respects string literals, so braces inside values are safe;
 * quotes outside any object (prose) are ignored.
 */
export function extractJsonObjects(rawText: string): Record<string, unknown>[] {
  // Hebrew abbreviations (אונסק"ו, חב"ד, ארה"ב) are often written with a plain
  // double quote, which ends the JSON string early and loses the whole reply.
  // A quote between two Hebrew letters can never be JSON syntax, so turning it
  // into the proper gershayim (״) is always safe.
  const text = rawText.replace(/([\u0590-\u05FF])"(?=[\u0590-\u05FF])/g, "$1\u05F4");
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
        const block = text.slice(start, i + 1);
        // One stray character breaks the whole block (a week of itinerary):
        // when it doesn't parse as it is, try the repairs below, then skip it.
        const repairs = [
          () => block,
          () => repairStrayQuotes(block),
          () => dropStrayOutsideStrings(block),
          () => repairStrayQuotes(dropStrayOutsideStrings(block)),
        ];
        for (const candidate of repairs) {
          try {
            const v = JSON.parse(candidate());
            if (v && typeof v === "object" && !Array.isArray(v)) out.push(v as Record<string, unknown>);
            break;
          } catch {
            // Not valid JSON this way — try the next repair.
          }
        }
        start = -1;
      }
    }
  }
  return out;
}

// What may stand between JSON values: whitespace, punctuation, numbers, true/false/null.
const JSON_SYNTAX = /[\s{}[\],:0-9.eE+\-a-zA-Z]/;

/**
 * A JSON block with a stray character between its fields: the model now and
 * then emits a lone Hebrew point (U+05BF) outside any string (caught
 * 2026-11-15 — about 1 reply in 8 lost a whole week to it). Outside strings,
 * marks and symbols that can't be JSON syntax are dropped. Letters never are:
 * a letter outside a string means the strings were misread (a stray quote),
 * and dropping it would silently delete words.
 */
export function dropStrayOutsideStrings(json: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const c of json) {
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      out += c;
      inString = true;
    } else if (JSON_SYNTAX.test(c) || /\p{L}/u.test(c)) {
      out += c;
    }
  }
  return out;
}

/**
 * A JSON block with plain double quotes used as text inside a string — the
 * model's quotation marks around a name end the string early, and the whole
 * reply (a week of itinerary) is lost. A quote that can't be JSON syntax —
 * neither opening a string (after `{ [ , :`) nor closing one (before
 * `} ] , :`) — becomes ״. Only for a block that didn't parse as it was.
 */
export function repairStrayQuotes(json: string): string {
  let out = "";
  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    if (c !== '"' || json[i - 1] === "\\") {
      out += c;
      continue;
    }
    let before = i - 1;
    while (before >= 0 && /\s/.test(json[before])) before--;
    let after = i + 1;
    while (after < json.length && /\s/.test(json[after])) after++;
    const opens = before < 0 || "{[,:".includes(json[before]);
    const closes = after >= json.length || "}],:".includes(json[after]);
    out += opens || closes ? c : "\u05F4";
  }
  return out;
}

// Generic enough for both `{items:[...]}` (suggestions/itinerary/checklist/passports)
// and `{doc_type, data}` (voucher) shaped responses. When the reply holds several
// `{items:[...]}` objects, their items are concatenated into one.
export function extractJson(text: string): Record<string, unknown> | null {
  const objects = extractJsonObjects(text);
  if (!objects.length) return null;
  const withItems = objects.filter((o) => Array.isArray(o.items));
  if (withItems.length > 1) {
    return { ...withItems[0], items: withItems.flatMap((o) => o.items as unknown[]) };
  }
  return withItems[0] ?? objects[0];
}
