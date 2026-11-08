/**
 * Day-by-day programme ("agenda") extracted from a document: an agency's tour
 * programme, a conference agenda, a booking summary with a daily plan. Used by
 * kind "agenda" (the Itinerary tab's PDF import) and by kind "voucher" (the
 * document scan also returns the programme printed next to the bookings).
 * Pure (no Deno/Node imports): unit-tested from src/lib/generate-agenda.test.ts.
 */

export type AgendaItem = {
  day_date: string;
  start_time: string | null;
  title: string;
  description: string | null;
  category: "activity" | "food" | "transport" | "flight" | "hotel" | "free";
  location: string | null;
};

const CATEGORIES = new Set(["activity", "food", "transport", "flight", "hotel", "free"]);
export const AGENDA_MAX_ITEMS = 200;

/** The JSON shape of one item, for the prompts. */
export const AGENDA_ITEM_SHAPE =
  '{"day_date":"YYYY-MM-DD","start_time":"HH:MM","title":"כותרת קצרה","description":null,"category":"activity","location":null}';

/** The extraction rules, shared by both prompts. */
export const AGENDA_RULES = `כללים למסלול היומי:
- פריט אחד לכל שורה מתוזמנת בתוכנית היומית (פעילות, ארוחה, העברה, צ'ק-אין, טיסה). לפי סדר הימים והשעות.
- day_date: התאריך של היום שבו מופיעה השורה, בפורמט YYYY-MM-DD. אם השנה לא מודפסת ליד היום, קח אותה משאר התאריכים במסמך. אם אי אפשר לדעת את התאריך בבירור — דלג על השורה.
- start_time: שעת ההתחלה בפורמט HH:MM (בטווח "10:30 – 11:00" — "10:30"). שורה בלי שעה: null.
- title: תיאור קצר בעברית (עד 80 תווים). שמות מקומות, מלונות, מופעים וחברות — השאר באותיות שבהן הם מודפסים, למשל "שייט באגם West Lake".
- description: פרטים נוספים שמודפסים בשורה (למשל שם הבמאי של מופע או סוג המטבח), בעברית. אם אין — null.
- category: אחד מ: "food" לארוחות, "transport" להעברות, איסוף ונסיעות, "flight" להמראה או נחיתה, "hotel" לצ'ק-אין, צ'ק-אאוט ולינה, "free" לזמן חופשי וקניות, "activity" לכל השאר.
- location: שם המקום אם מודפס בשורה, אחרת null.
- רק התוכנית היומית: אל תכלול טבלאות טיסות או מלונות, פרטי קשר, טיפים, מחירים או תנאים.
- אל תמציא פעילויות ואל תשלים שעות שלא מודפסות. אם אין במסמך תוכנית יומית — מערך ריק [].`;

const str = (v: unknown, max: number): string | null => {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return s ? s.slice(0, max) : null;
};

/** "9:15", "09:15", "09:15:00" → "09:15"; anything else → null. */
function time(v: unknown): string | null {
  const m = typeof v === "string" ? v.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/) : null;
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? `${String(h).padStart(2, "0")}:${m[2]}` : null;
}

function date(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100 ? s : null;
}

/**
 * The model's `items` → clean rows: a valid date and a title are required,
 * the rest is trimmed and capped, an unknown category becomes "activity". An
 * exact repeat (same day, time and title) is kept once. Sorted by day.
 */
export function sanitizeAgenda(raw: unknown): AgendaItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: (AgendaItem & { order: number })[] = [];
  raw.forEach((r, order) => {
    if (!r || typeof r !== "object") return;
    const o = r as Record<string, unknown>;
    const day_date = date(o.day_date);
    const title = str(o.title, 200);
    if (!day_date || !title) return;
    const start_time = time(o.start_time);
    const key = `${day_date}|${start_time ?? ""}|${title.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    const category = typeof o.category === "string" && CATEGORIES.has(o.category) ? o.category : "activity";
    out.push({
      day_date,
      start_time,
      title,
      description: str(o.description, 500),
      category: category as AgendaItem["category"],
      location: str(o.location, 200),
      order,
    });
  });
  // By day only: inside a day the document's order wins — a programme may run
  // past midnight ("23:20 landing", then "00:30 transfer" on the same day).
  out.sort((a, b) => (a.day_date !== b.day_date ? (a.day_date < b.day_date ? -1 : 1) : a.order - b.order));
  return out.slice(0, AGENDA_MAX_ITEMS).map(({ order: _order, ...item }) => item);
}
