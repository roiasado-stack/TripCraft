/**
 * Parses a pasted/uploaded itinerary into structured rows — locally, with no
 * LLM involved. Accepts JSON or CSV/TSV, with Hebrew or English headers.
 */

export type ParsedItem = {
  day_date: string;
  start_time: string | null;
  title: string;
  description: string | null;
  category: string;
  location: string | null;
};

export type ParseResult = {
  items: ParsedItem[];
  format: "json" | "csv" | "unknown";
  errors: string[];
};

/** Header aliases → canonical field. Hebrew first, English fallback. */
const HEADERS: Record<string, keyof ParsedItem> = {
  תאריך: "day_date",
  יום: "day_date",
  date: "day_date",
  day: "day_date",
  שעה: "start_time",
  time: "start_time",
  start: "start_time",
  start_time: "start_time",
  כותרת: "title",
  פעילות: "title",
  שם: "title",
  title: "title",
  activity: "title",
  name: "title",
  תיאור: "description",
  פרטים: "description",
  הערות: "description",
  description: "description",
  notes: "description",
  קטגוריה: "category",
  סוג: "category",
  category: "category",
  type: "category",
  מיקום: "location",
  מקום: "location",
  כתובת: "location",
  location: "location",
  address: "location",
};

const CATEGORY_WORDS: Record<string, string> = {
  אוכל: "food",
  ארוחה: "food",
  מסעדה: "food",
  food: "food",
  meal: "food",
  תחבורה: "transport",
  נסיעה: "transport",
  transport: "transport",
  transfer: "transport",
  טיסה: "flight",
  flight: "flight",
  לינה: "hotel",
  מלון: "hotel",
  hotel: "hotel",
  חופשי: "free",
  מנוחה: "free",
  free: "free",
  פעילות: "activity",
  activity: "activity",
};

const VALID_CATEGORIES = new Set(["activity", "food", "transport", "flight", "hotel", "free"]);

function normCategory(raw: unknown): string {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return "activity";
  if (VALID_CATEGORIES.has(s)) return s;
  for (const [word, cat] of Object.entries(CATEGORY_WORDS)) {
    if (s.includes(word.toLowerCase())) return cat;
  }
  return "activity";
}

/** Accepts YYYY-MM-DD, DD/MM/YYYY, DD.MM.YYYY, D/M/YY. Returns ISO or null. */
export function normDate(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

/** Accepts HH:MM, H:MM, HHMM, "09:30-11:00" (takes the start). */
export function normTime(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const m = s.match(/(\d{1,2})[:.](\d{2})/);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }
  const digits = s.match(/^(\d{2})(\d{2})$/);
  if (digits) {
    const h = Number(digits[1]);
    const min = Number(digits[2]);
    if (h > 23 || min > 59) return null;
    return `${digits[1]}:${digits[2]}`;
  }
  return null;
}

/** RFC-4180-ish splitter: handles quoted fields containing the delimiter. */
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
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delim && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim().replace(/^"|"$/g, ""));
}

function parseCsv(text: string, fallbackDate: string | null): ParseResult {
  const errors: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return { items: [], format: "csv", errors: ["צריך שורת כותרות ולפחות שורה אחת של נתונים."] };

  const delim = (lines[0].match(/\t/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? "\t" : ",";
  const rawHeaders = splitRow(lines[0], delim);
  const fields = rawHeaders.map((h) => HEADERS[h.trim().toLowerCase()] ?? null);

  if (!fields.includes("title")) {
    return {
      items: [],
      format: "csv",
      errors: [`לא נמצאה עמודת כותרת. הכותרות שזוהו: ${rawHeaders.join(", ") || "(ריק)"}`],
    };
  }

  const items: ParsedItem[] = [];
  lines.slice(1).forEach((line, idx) => {
    const cells = splitRow(line, delim);
    const rec: Partial<Record<keyof ParsedItem, string>> = {};
    fields.forEach((f, i) => {
      if (f) rec[f] = cells[i] ?? "";
    });
    const title = (rec.title ?? "").trim();
    if (!title) return;

    const date = normDate(rec.day_date) ?? fallbackDate;
    if (!date) {
      errors.push(`שורה ${idx + 2}: תאריך חסר או לא תקין ("${rec.day_date ?? ""}").`);
      return;
    }
    items.push({
      day_date: date,
      start_time: normTime(rec.start_time),
      title,
      description: (rec.description ?? "").trim() || null,
      category: normCategory(rec.category),
      location: (rec.location ?? "").trim() || null,
    });
  });

  return { items, format: "csv", errors };
}

function parseJson(text: string, fallbackDate: string | null): ParseResult {
  const errors: string[] = [];
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

  const items: ParsedItem[] = [];
  arr.forEach((raw, idx) => {
    const o = raw as Record<string, unknown>;
    // Map any recognised key (Hebrew or English) onto canonical fields.
    const rec: Partial<Record<keyof ParsedItem, unknown>> = {};
    for (const [k, v] of Object.entries(o)) {
      const f = HEADERS[k.trim().toLowerCase()];
      if (f) rec[f] = v;
    }
    const title = String(rec.title ?? "").trim();
    if (!title) return;

    const date = normDate(rec.day_date) ?? fallbackDate;
    if (!date) {
      errors.push(`פריט ${idx + 1}: תאריך חסר או לא תקין.`);
      return;
    }
    items.push({
      day_date: date,
      start_time: normTime(rec.start_time),
      title,
      description: String(rec.description ?? "").trim() || null,
      category: normCategory(rec.category),
      location: String(rec.location ?? "").trim() || null,
    });
  });

  return { items, format: "json", errors };
}

/**
 * Auto-detects the format and parses. `fallbackDate` fills rows with no date
 * (typically the trip's start date).
 */
export function parseItinerary(text: string, fallbackDate: string | null): ParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { items: [], format: "unknown", errors: ["לא הודבק תוכן."] };
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return parseJson(trimmed, fallbackDate);
  return parseCsv(trimmed, fallbackDate);
}
