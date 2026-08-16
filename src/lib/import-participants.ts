/**
 * Parses a pasted/uploaded list of travellers. Runs locally, no LLM.
 *
 * Accepts, in order of detection:
 *   1. JSON  — array, or { items: [...] }
 *   2. CSV / TSV with a header row (Hebrew or English)
 *   3. A plain list, one traveller per line: "שם", "שם, 34", "שם 34",
 *      "שם - 4-8", "שם | 12 | חוף, אוכל"
 */

import { AGE_RANGES, PREFERENCES } from "./trip-options";

export type ParsedParticipant = {
  name: string;
  age: number | null;
  age_range: string | null;
  preferences: string[];
};

export type ParticipantParseResult = {
  items: ParsedParticipant[];
  format: "json" | "csv" | "list";
  errors: string[];
};

const HEADERS: Record<string, keyof ParsedParticipant> = {
  שם: "name",
  "שם מלא": "name",
  נוסע: "name",
  name: "name",
  "full name": "name",
  fullname: "name",
  traveler: "name",
  traveller: "name",
  passenger: "name",
  גיל: "age",
  age: "age",
  "טווח גילאים": "age_range",
  טווח: "age_range",
  age_range: "age_range",
  agerange: "age_range",
  range: "age_range",
  העדפות: "preferences",
  תחומי_עניין: "preferences",
  preferences: "preferences",
  interests: "preferences",
};

/** Hebrew/English words → canonical preference values. */
const PREF_WORDS: Record<string, string> = {};
for (const p of PREFERENCES) {
  PREF_WORDS[p.label] = p.value;
  PREF_WORDS[p.value] = p.value;
}
Object.assign(PREF_WORDS, {
  ים: "beach",
  חופים: "beach",
  מסעדות: "food",
  אוכל: "food",
  קניון: "shopping",
  שופינג: "shopping",
  היסטוריה: "history",
  מוזיאונים: "history",
  אתרים: "history",
  חיי_לילה: "nightlife",
  לילה: "nightlife",
  ספורט: "sport",
  נגיש: "accessibility",
  כשרות: "kosher",
  כשר: "kosher",
  צמחונות: "vegetarian",
  טבעוני: "vegetarian",
});

const VALID_RANGES = new Set<string>(AGE_RANGES as readonly string[]);

export function normPreferences(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return [...new Set(raw.map((x) => PREF_WORDS[String(x).trim().toLowerCase()] ?? PREF_WORDS[String(x).trim()]).filter(Boolean) as string[])];
  }
  const s = String(raw ?? "").trim();
  if (!s) return [];
  const parts = s.split(/[,;|/]+|\s{2,}/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const hit = PREF_WORDS[p] ?? PREF_WORDS[p.toLowerCase()];
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

export function normAge(raw: unknown): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const m = s.match(/^\d{1,3}$/);
  if (!m) return null;
  const n = Number(s);
  return n >= 0 && n <= 120 ? n : null;
}

/** "4-8" / "65+" → a canonical range, else null. */
export function normRange(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (VALID_RANGES.has(s)) return s;
  const m = s.match(/^(\d{1,3})\s*[-–]\s*(\d{1,3})$/);
  if (m) {
    const candidate = `${Number(m[1])}-${Number(m[2])}`;
    if (VALID_RANGES.has(candidate)) return candidate;
  }
  if (/^\d{1,3}\+$/.test(s) && VALID_RANGES.has(s)) return s;
  return null;
}

function splitRow(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (ch === delim && !inQuotes) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim().replace(/^"|"$/g, ""));
}

function build(name: string, age: unknown, range: unknown, prefs: unknown): ParsedParticipant | null {
  const clean = name.trim();
  if (!clean) return null;
  const parsedAge = normAge(age);
  return {
    name: clean,
    age: parsedAge,
    age_range: parsedAge == null ? normRange(range) : null,
    preferences: normPreferences(prefs),
  };
}

function looksLikeHeader(cells: string[]): boolean {
  return cells.some((c) => HEADERS[c.trim().toLowerCase()] !== undefined);
}

function parseCsv(text: string): ParticipantParseResult {
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const delim = (lines[0].match(/\t/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? "\t" : ",";
  const headerCells = splitRow(lines[0], delim);
  const fields = headerCells.map((h) => HEADERS[h.trim().toLowerCase()] ?? null);

  const items: ParsedParticipant[] = [];
  lines.slice(1).forEach((line, idx) => {
    const cells = splitRow(line, delim);
    const rec: Partial<Record<keyof ParsedParticipant, string>> = {};
    fields.forEach((f, i) => {
      if (f) rec[f] = cells[i] ?? "";
    });
    if (!rec.name?.trim()) {
      if (cells.some((c) => c)) errors.push(`שורה ${idx + 2}: חסר שם.`);
      return;
    }
    const p = build(rec.name, rec.age, rec.age_range, rec.preferences);
    if (p) items.push(p);
  });
  return { items, format: "csv", errors };
}

/** One traveller per line, with optional age and preferences after a separator. */
function parseList(text: string): ParticipantParseResult {
  const errors: string[] = [];
  const items: ParsedParticipant[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  lines.forEach((line, idx) => {
    // Strip list bullets / numbering: "1." "-" "•"
    const clean = line.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, "").trim();
    if (!clean) return;

    const parts = clean.split(/\s*[,;|]\s*|\s+[-–]\s+/).map((p) => p.trim()).filter(Boolean);
    let name = parts[0] ?? "";
    let age: string | null = null;
    let range: string | null = null;
    const prefParts: string[] = [];

    for (const part of parts.slice(1)) {
      if (!age && /^\d{1,3}$/.test(part)) age = part;
      else if (!range && normRange(part)) range = part;
      else prefParts.push(part);
    }

    // Trailing age attached to the name: "דני 34"
    if (!age && !range) {
      const m = name.match(/^(.*?)\s+(\d{1,3})$/);
      if (m && m[1].trim()) {
        name = m[1].trim();
        age = m[2];
      }
    }

    const p = build(name, age, range, prefParts);
    if (p) items.push(p);
    else errors.push(`שורה ${idx + 1}: לא זוהה שם.`);
  });

  return { items, format: "list", errors };
}

function parseJson(text: string): ParticipantParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { items: [], format: "json", errors: ["ה-JSON אינו תקין."] };
  }
  const arr = Array.isArray(data)
    ? data
    : Array.isArray((data as { items?: unknown[] })?.items)
      ? (data as { items: unknown[] }).items
      : null;
  if (!arr) return { items: [], format: "json", errors: ['ה-JSON צריך להיות מערך, או אובייקט עם שדה "items".'] };

  const errors: string[] = [];
  const items: ParsedParticipant[] = [];
  arr.forEach((raw, idx) => {
    if (typeof raw === "string") {
      const p = build(raw, null, null, null);
      if (p) items.push(p);
      return;
    }
    const o = raw as Record<string, unknown>;
    const rec: Partial<Record<keyof ParsedParticipant, unknown>> = {};
    for (const [k, v] of Object.entries(o)) {
      const f = HEADERS[k.trim().toLowerCase()];
      if (f) rec[f] = v;
    }
    if (!String(rec.name ?? "").trim()) {
      errors.push(`פריט ${idx + 1}: חסר שם.`);
      return;
    }
    const p = build(String(rec.name), rec.age, rec.age_range, rec.preferences);
    if (p) items.push(p);
  });
  return { items, format: "json", errors };
}

export function parseParticipants(text: string): ParticipantParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { items: [], format: "list", errors: ["לא הודבק תוכן."] };
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return parseJson(trimmed);

  const firstLine = trimmed.split(/\r?\n/)[0] ?? "";
  const delim = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? "\t" : ",";
  if (looksLikeHeader(splitRow(firstLine, delim))) return parseCsv(trimmed);

  return parseList(trimmed);
}
