/**
 * TripCraft AI generation — Supabase Edge Function (Deno).
 *
 * Runs the LLM server-side so the API key is never exposed to the browser,
 * verifies the caller owns the trip, then writes generated rows into the
 * trip's tables (RLS still applies because we use the caller's JWT).
 *
 * Deploy:
 *   supabase functions deploy generate
 *   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = "claude-sonnet-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// Output ceiling for every call. claude-sonnet-5 runs adaptive thinking by
// default and thinking tokens count against max_tokens, so tight caps (the
// old 1500/2000/4000) cut the JSON off mid-answer - agent_runs showed 4 of 7
// itinerary runs and every truncated voucher scan stopping at the cap. Billing
// is per token actually generated, so a high ceiling costs nothing extra.
const MAX_TOKENS = 16000;
// Simple extraction/translation calls: less thinking, same answer, faster.
const EXTRACTION_OUTPUT_CONFIG = { effort: "low" } as const;
// Voucher scans: multi-page family e-tickets need every page read; low effort skimmed and dropped passengers/segments.
const VOUCHER_OUTPUT_CONFIG = { effort: "medium" } as const;

// claude-sonnet-5 pricing (Anthropic API).
const PRICE_PER_MTOK_INPUT_USD = 2.0;
const PRICE_PER_MTOK_OUTPUT_USD = 10.0;

// Per-user, per-day, shared with the `ask` function's cap (both write to the
// same agent_runs table, so my_agent_daily_cost_usd() sums across both).
const DAILY_CAP_USD = 2.0;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Participant = {
  name: string;
  age: number | null;
  age_range: string | null;
  preferences: string[];
};

type PassportImage = { media_type: string; data: string };

type Body = {
  trip_id: string;
  kind: "suggestions" | "itinerary" | "checklist" | "passports" | "photo" | "geocode" | "voucher";
  images?: PassportImage[];
  /** For kind: "voucher" — the document category the user picked before uploading, if any.
   *  Narrows/primes classification; the model's own `doc_type` in the response stays authoritative. */
  hint?: "flight" | "hotel" | "car" | "other";
  tune?: string | null;
  /** For kind: "photo" (free-text place, resolved to a Wikipedia article) or kind: "geocode" (place to look up). */
  query?: string;
  trip: {
    destination: string;
    trip_type: string;
    budget_level: string | null;
    start_date: string | null;
    end_date: string | null;
  };
  participants: Participant[];
};

const TUNE_HE: Record<string, string> = {
  more_kids: "התאם יותר לילדים — פעילויות ידידותיות למשפחות עם ילדים.",
  calmer: "הפוך את הקצב לרגוע יותר — פחות פעילויות ליום, יותר מנוחה.",
  cheaper: "התמקד באפשרויות זולות או חינמיות, תקציב נמוך.",
  more_active: "הוסף יותר פעילות, ספורט והרפתקאות.",
};

function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const from = new Date(start);
  const to = new Date(end);
  for (const d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function describeParticipants(list: Participant[]): string {
  if (!list.length) return "לא צוינו משתתפים.";
  return list
    .map((p) => {
      const age = p.age != null ? `גיל ${p.age}` : p.age_range ? `טווח גילאים ${p.age_range}` : "גיל לא ידוע";
      const prefs = p.preferences?.length ? `, מעדיף: ${p.preferences.join(", ")}` : "";
      return `- ${p.name} (${age}${prefs})`;
    })
    .join("\n");
}

/**
 * Title key used to spot the same place twice: drops any parenthetical
 * ("קברי המלכים (Tombs of the Kings)" == "קברי המלכים"), Hebrew niqqud and
 * cantillation, quotes (incl. ״ ׳), other punctuation/symbols (incl. maqaf), lowercases
 * Latin and collapses whitespace. Falls back to the un-stripped form when the
 * whole title was inside parentheses, so it only comes back empty for a title
 * with no letters or digits at all.
 */
function normalizeTitle(title: string): string {
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

/** What the trip already holds — fed into the prompt so a repeated AI press adds new places. */
type ExistingRow = {
  title: string;
  image_url: string | null;
  kind?: string | null;
  day_date?: string | null;
  start_time?: string | null;
  category?: string | null;
};

// Shared prompt rule for AI-generated suggestions/itinerary. The title is
// looked up verbatim (wikipediaPhoto) — no search — so a null here means an
// honest "no photo" rather than a photo of some other place.
const WIKIPEDIA_TITLE_RULE =
  `wikipedia_title: הכותרת המדויקת של הערך בוויקיפדיה האנגלית על המקום הספציפי הזה (למשל "Eiffel Tower" או "Tombs of the Kings (Paphos)"), או null. מלא רק אם אתה בטוח שקיים ערך בוויקיפדיה האנגלית בדיוק על המקום הזה. null למסעדות, ארוחות, בתי עסק, מלונות, טיפים, תחבורה, זמן חופשי וכל דבר שאין לו ערך משלו. לעולם אל תחזיר את הערך של העיר, האזור או המדינה שבהם המקום נמצא (לא "Paphos" למסעדה בפאפוס) — במקרה כזה החזר null.`;

// Upper bound on existing titles listed in the prompt (the server-side
// duplicate filter still checks every existing row).
const MAX_EXISTING_IN_PROMPT = 60;

/** Existing rows with duplicate titles collapsed, in the given order, capped for the prompt. */
function uniqueForPrompt(rows: ExistingRow[]): ExistingRow[] {
  const seen = new Set<string>();
  const out: ExistingRow[] = [];
  for (const r of rows) {
    const key = normalizeTitle(r.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= MAX_EXISTING_IN_PROMPT) break;
  }
  return out;
}

function buildPrompt(body: Body, existing: ExistingRow[] = []): string {
  const { trip, participants, kind, tune } = body;
  const days = trip.start_date && trip.end_date ? daysBetween(trip.start_date, trip.end_date) : [];
  const tuneLine = tune && TUNE_HE[tune] ? `\nכיוונון מיוחד: ${TUNE_HE[tune]}` : "";

  const context = `יעד: ${trip.destination}
סוג טיול: ${trip.trip_type}
תקציב: ${trip.budget_level ?? "לא צוין"}
תאריכים: ${trip.start_date ?? "?"} עד ${trip.end_date ?? "?"}${days.length ? ` (${days.length} ימים)` : ""}
משתתפים:
${describeParticipants(participants)}${tuneLine}`;

  if (kind === "suggestions") {
    // Place kinds first so the capped list keeps the entries most likely to be re-suggested.
    const saved = uniqueForPrompt([...existing].sort((a, b) => (a.kind === "tip" ? 1 : 0) - (b.kind === "tip" ? 1 : 0)));
    const savedLines = saved.length
      ? `
- כבר שמורים בטיול — אל תציע אותם שוב, וגם לא וריאציות שלהם (אותו מקום בשם אחר, בכתיב אחר או באנגלית). הצע רק מקומות וטיפים חדשים:
${saved.map((r) => r.title).join("; ")}
- אם אין מספיק מקומות חדשים ואמיתיים — החזר פחות פריטים. אל תמציא מקומות ואל תחזור על הקיימים.`
      : "";
    return `${context}

צור המלצות מותאמות אישית לטיול הזה. החזר JSON בלבד, ללא טקסט נוסף, במבנה:
{"items":[{"kind":"attraction|restaurant|tip","title":"שם בעברית","description":"תיאור קצר בעברית (1-2 משפטים) כולל למה זה מתאים למשתתפים","tags":["תג1","תג2"],"age_min":0,"age_max":99,"price_level":"low|mid|high","wikipedia_title":"כותרת הערך בוויקיפדיה האנגלית או null","lat":32.0853,"lng":34.7818}]}

דרישות:
- 8 אטרקציות, 6 מסעדות, 4 טיפים מקומיים.
- התאם לגילאים ולהעדפות שצוינו. אם יש ילדים קטנים — הוסף אפשרויות מתאימות.
- אם צוין כשרות/צמחונות — התייחס לכך במסעדות.
- מקומות אמיתיים וידועים ב${trip.destination}. כל הטקסט בעברית.${savedLines}
- ${WIKIPEDIA_TITLE_RULE}
- lat/lng: קואורדינטות עשרוניות משוערות אך אמיתיות של המקום הספציפי, לפי הידע שלך (הערכה טובה מספיקה לסמן על מפה, לא נדרשת דיוק סקר-קרקע). לטיפים כלליים שאינם מקום ספציפי — השמט lat/lng.
- בקיצורים עבריים (כמו חב״ד, אונסק״ו, ארה״ב) כתוב את הגרשיים בתו ״ ולא במירכאות " — מירכאות רגילות שוברות את ה-JSON.`;
  }

  if (kind === "itinerary") {
    const dayList = days.length ? days.join(", ") : "צור 3 ימים לדוגמה";
    // Which days already hold items decides the scope: plan only the empty
    // days, or — when every day is taken (or there are no trip dates to tell) —
    // add just a few complementary activities instead of a second full plan.
    const plannedDays = new Set(existing.map((r) => r.day_date).filter((d): d is string => !!d));
    const emptyDays = days.filter((d) => !plannedDays.has(d));
    const allPlanned = existing.length > 0 && emptyDays.length === 0;
    let existingLines = "";
    if (existing.length) {
      const byDay = new Map<string, string[]>();
      for (const r of uniqueForPrompt(existing)) {
        const day = r.day_date ?? "?";
        const time = r.start_time ? `${r.start_time.slice(0, 5)} ` : "";
        byDay.set(day, [...(byDay.get(day) ?? []), `${time}${r.title}`]);
      }
      const perDay = [...byDay.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([day, titles]) => `${day}: ${titles.join("; ")}`)
        .join("\n");
      const scope = allPlanned
        ? "- לכל הימים כבר יש פריטים — אל תבנה מסלול שני. הוסף רק 2-5 פעילויות חדשות באמת בסך הכול, שמשלימות את הקיים, בימים ובשעות שבהם הן מתאימות."
        : `- תכנן רק את הימים שעדיין אין בהם פריטים: ${emptyDays.join(", ")}. אל תוסיף פריטים לימים שכבר יש בהם פריטים.`;
      existingLines = `
- פריטים שכבר קיימים במסלול, לפי יום:
${perDay}
${scope}
- לעולם אל תחזור על פעילות או מקום שכבר קיימים במסלול — גם לא בשם אחר, בכתיב אחר או ביום אחר.`;
    }
    return `${context}

צור מסלול יומי מוצע. הימים: ${dayList}
החזר JSON בלבד במבנה:
{"items":[{"day_date":"YYYY-MM-DD","start_time":"HH:MM","title":"שם הפעילות בעברית","description":"פרטים קצרים","category":"activity|food|transport|free","location":"שם מקום","wikipedia_title":"כותרת הערך בוויקיפדיה האנגלית או null","lat":32.0853,"lng":34.7818}]}

דרישות:
- ${allPlanned ? "כל פריט בשעה הגיונית ביחס לפריטים הקיימים באותו יום." : "3-5 פריטים לכל יום שאתה מתכנן, בסדר הגיוני לפי שעות (בוקר/צהריים/ערב)."}
- התאם לקצב המשתתפים (ילדים/מבוגרים) ולהעדפות.
- day_date חייב להיות אחד מהתאריכים שצוינו. כל הטקסט בעברית.${existingLines}
- ${WIKIPEDIA_TITLE_RULE}
- lat/lng: קואורדינטות עשרוניות משוערות אך אמיתיות של המקום הספציפי, לפי הידע שלך (הערכה טובה מספיקה לסמן על מפה, לא נדרשת דיוק סקר-קרקע). לפריטים כלליים ללא מקום מסוים (כמו "זמן חופשי") — השמט lat/lng.
- בקיצורים עבריים (כמו חב״ד, אונסק״ו, ארה״ב) כתוב את הגרשיים בתו ״ ולא במירכאות " — מירכאות רגילות שוברות את ה-JSON.`;
  }

  return `${context}

צור רשימת ציוד/צ'קליסט מותאמת לטיול הזה. החזר JSON בלבד במבנה:
{"items":[{"title":"שם הפריט בעברית","is_shared":true}]}

דרישות:
- 15-25 פריטים. is_shared=true לפריטים משותפים למשפחה, false לפריטים אישיים.
- התאם למשתתפים (תינוקות/ילדים), ליעד, לעונה ולהעדפות. כל הטקסט בעברית.
- בקיצורים עבריים (כמו חב״ד, אונסק״ו, ארה״ב) כתוב את הגרשיים בתו ״ ולא במירכאות " — מירכאות רגילות שוברות את ה-JSON.`;
}

/**
 * Anthropic responses aren't guaranteed to put the reply in content[0] — a
 * leading non-text block (e.g. thinking) pushes it later. Concatenate every
 * text block instead of indexing positionally.
 */
function extractText(payload: unknown): string {
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
function extractJsonObjects(rawText: string): Record<string, unknown>[] {
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
        try {
          const v = JSON.parse(text.slice(start, i + 1));
          if (v && typeof v === "object" && !Array.isArray(v)) out.push(v as Record<string, unknown>);
        } catch {
          // Not valid JSON on its own — skip it.
        }
        start = -1;
      }
    }
  }
  return out;
}

// Generic enough for both `{items:[...]}` (suggestions/itinerary/checklist/passports)
// and `{doc_type, data}` (voucher) shaped responses. When the reply holds several
// `{items:[...]}` objects, their items are concatenated into one.
function extractJson(text: string): Record<string, unknown> | null {
  const objects = extractJsonObjects(text);
  if (!objects.length) return null;
  const withItems = objects.filter((o) => Array.isArray(o.items));
  if (withItems.length > 1) {
    return { ...withItems[0], items: withItems.flatMap((o) => o.items as unknown[]) };
  }
  return withItems[0] ?? objects[0];
}

// Service-role client used ONLY for photo_cache (migration 012). That table is
// deliberately not user-writable — a user who could write it could plant an
// image every other trip then shows — so it can't go through the caller's JWT.
let adminClient: ReturnType<typeof createClient> | null = null;
function adminDb(): ReturnType<typeof createClient> | null {
  if (!adminClient) {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return null;
    adminClient = createClient(url, key, { auth: { persistSession: false } });
  }
  return adminClient;
}
const photoCacheKey = (q: string) => q.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200);

/**
 * Cleans a Wikipedia article title as the model wrote it (JSON field or the
 * `photo` kind's one-line answer): first line only, a pasted /wiki/ URL or
 * [[link]] unwrapped, quotes stripped, underscores → spaces. NONE/null, a
 * Hebrew answer or an implausibly long one all mean "no article" → null.
 */
function parseWikipediaTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let t = raw.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const fromUrl = t.match(/wikipedia\.org\/wiki\/([^\s?#]+)/i);
  if (fromUrl) {
    try {
      t = decodeURIComponent(fromUrl[1]);
    } catch {
      t = fromUrl[1];
    }
  }
  t = t.replace(/^\[\[|\]\]$/g, "").replace(/^["“”`]+|["“”`]+$/g, "");
  if (/^'.*'$/.test(t)) t = t.slice(1, -1);
  t = t.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (!t || /^(none|null|n\/a)\.?$/i.test(t)) return null;
  if (t.length > 150 || /[\u0590-\u05FF]/.test(t)) return null;
  return t;
}

const WIKIPEDIA_USER_AGENT = "TripCraft/1.0 (https://tripcraft-lac.vercel.app)";

/** Only ever store/show images served from Wikimedia's own upload hosts. */
function isWikimediaImage(u: unknown): u is string {
  if (typeof u !== "string") return false;
  try {
    const p = new URL(u);
    return p.protocol === "https:" && (p.hostname === "upload.wikimedia.org" || p.hostname === "thumb.wikimedia.org");
  } catch {
    return false;
  }
}

/**
 * The page image of the English Wikipedia article with EXACTLY this title
 * (redirects followed, so alternate names resolve to the canonical article).
 * Deliberately no free-text search fallback: search maps "Baths of Aphrodite"
 * to Adonis Baths and "Paphos seafood restaurant" to Taco Bell — a miss must
 * stay a miss (null), which MediaCard renders as its gradient fallback.
 *
 * Best-effort, never throws: any failure resolves to { url: null, fail } with
 * a short reason, fed into the generation diagnostics in agent_runs. Hits are
 * cached in photo_cache under `wiki:<title>` (misses aren't — the article or
 * its image may appear later).
 */
async function wikipediaPhoto(title: string): Promise<{ url: string | null; fail?: string; cached?: boolean }> {
  const clean = title.replace(/_/g, " ").replace(/\s+/g, " ").trim().slice(0, 250);
  const normalized = photoCacheKey(clean);
  if (!normalized) return { url: null, fail: "empty_title" };
  const cacheKey = `wiki:${normalized}`;
  const db = adminDb();
  if (db) {
    try {
      const { data } = await db.from("photo_cache").select("url").eq("query_key", cacheKey).maybeSingle();
      const cachedUrl = (data as { url?: string } | null)?.url;
      if (isWikimediaImage(cachedUrl)) return { url: cachedUrl, cached: true };
    } catch {
      // Cache is an optimization only — fall through to Wikipedia.
    }
  }
  try {
    const url =
      "https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1" +
      `&prop=pageimages&piprop=thumbnail&pithumbsize=800&titles=${encodeURIComponent(clean)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": WIKIPEDIA_USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("Wikipedia lookup failed", res.status, body.slice(0, 200));
      return { url: null, fail: `http_${res.status}` };
    }
    const data = await res.json();
    const page = data?.query?.pages?.[0];
    if (!page || page.missing || page.invalid) return { url: null, fail: `missing:${clean.slice(0, 40)}` };
    const found = page.thumbnail?.source;
    if (!found) return { url: null, fail: `no_image:${clean.slice(0, 40)}` };
    if (!isWikimediaImage(found)) return { url: null, fail: "bad_host" };
    if (db) {
      try {
        // Awaited on purpose: an un-awaited write can be cut off when the function returns.
        await db.from("photo_cache").upsert({ query_key: cacheKey, url: found });
      } catch {
        // Best-effort.
      }
    }
    return { url: found };
  } catch (e) {
    console.error("Wikipedia lookup threw", e);
    return { url: null, fail: `exception:${String(e).slice(0, 80)}` };
  }
}

/**
 * Looks up approximate coordinates for `query` via OpenStreetMap's free
 * Nominatim API. Same resilience contract as wikipediaPhoto: never
 * throws, resolves to null on any failure (empty result set, network error,
 * non-OK response, unparsable numbers) — a geocoding miss must never block
 * add/edit or generation. Failures are logged server-side only.
 *
 * Nominatim's usage policy requires a descriptive User-Agent (requests are
 * rejected without one) and caps public usage at ~1 request/second with no
 * parallel requests. This is only ever called once per manual add/edit save
 * (a single user action), trivially within that limit — no throttling here.
 * Do not reuse this for batch-geocoding AI-generated lists; those get their
 * coordinates from the model itself (see buildPrompt's lat/lng fields).
 */
async function geocodeWithNominatim(query: string): Promise<{ lat: number; lng: number } | null> {
  if (!query.trim()) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": "TripCraft/1.0 (travel planning app)" },
    });
    if (!res.ok) {
      console.error("Nominatim search failed", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = await res.json();
    const hit = data?.[0];
    if (!hit?.lat || !hit?.lon) return null;
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch (e) {
    console.error("Nominatim search threw", e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY is not set" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Client bound to the caller's JWT → RLS enforced on every write.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as Body;

    const logRun = async (fields: {
      kind: string;
      tripId: string | null;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      latencyMs: number;
      status: "ok" | "error";
      errorMessage?: string;
    }) => {
      try {
        await supabase.from("agent_runs").insert({
          trip_id: fields.tripId,
          user_id: auth.user.id,
          kind: fields.kind,
          input_tokens: fields.inputTokens,
          output_tokens: fields.outputTokens,
          cost_usd: fields.costUsd,
          latency_ms: fields.latencyMs,
          status: fields.status,
          error_message: fields.errorMessage?.slice(0, 500) ?? null,
        });
      } catch {
        // Monitoring must never break generation.
      }
    };

    // The daily cap tracks Anthropic token spend (agent_runs) — every kind
    // that calls the LLM is capped, including "passports" below. "photo" and
    // "geocode" are gated separately below instead of rejected here: their
    // small LLM sub-call (Wikipedia-title resolution / Hebrew translation) is
    // simply skipped over the cap, and the request still answers { ok: true }
    // with a null photo / the untranslated query, never a 429.
    if (body.kind !== "photo" && body.kind !== "geocode") {
      const { data: spentToday } = await supabase.rpc("my_agent_daily_cost_usd");
      if ((spentToday ?? 0) >= DAILY_CAP_USD) {
        return new Response(JSON.stringify({ error: "daily_cap_reached" }), {
          status: 429,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
    }

    // Passport scanning returns parsed travellers to the client for review and
    // writes nothing, so it needs no trip ownership check — but it still costs
    // money, so it's still capped and logged (trip_id: null — see agent_runs).
    if (body.kind === "passports") {
      const images = (body.images ?? []).slice(0, 8);
      if (!images.length) {
        return new Response(JSON.stringify({ error: "no_images", items: [] }), {
          status: 400,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      const content: unknown[] = images.map((img) =>
        img.media_type === "application/pdf"
          ? { type: "document", source: { type: "base64", media_type: img.media_type, data: img.data } }
          : { type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } },
      );
      const today = new Date().toISOString().slice(0, 10);
      content.push({
        type: "text",
        text: `אלה תמונות של דרכונים. עבור כל דרכון, חלץ את שם בעל הדרכון ואת תאריך הלידה שלו (Date of Birth בעמוד הנתונים), וחשב ממנו את הגיל הנוכחי.

היום הוא ${today}. חשב גיל = השנה הנוכחית פחות שנת הלידה, ואם יום-והחודש של יום ההולדת עוד לא הגיעו השנה (ביחס ל-${today}) — הפחת עוד 1.

החזר JSON בלבד, ללא טקסט נוסף:
{"items":[{"name":"שם מלא בעברית אם אפשר, אחרת כפי שמופיע","age":34}]}

כללים:
- פריט אחד לכל דרכון, באותו סדר שבו הופיעו התמונות.
- אם לא ניתן לקרוא את השם — דלג על אותו דרכון.
- אם לא ניתן לקרוא את תאריך הלידה בבירור — החזר age: null, אל תנחש.
- אל תמציא פרטים. אל תחזיר מספרי דרכון או כל מידע אחר.`,
      });

      const runStart = Date.now();
      const visionRes = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          output_config: EXTRACTION_OUTPUT_CONFIG,
          messages: [{ role: "user", content }],
        }),
      });
      const latencyMs = Date.now() - runStart;

      if (!visionRes.ok) {
        const detail = await visionRes.text();
        await logRun({ kind: "generate_passports", tripId: null, inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs, status: "error", errorMessage: detail });
        return new Response(JSON.stringify({ error: "llm_failed", detail, items: [] }), {
          status: 502,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      const visionPayload = await visionRes.json();
      const visionUsage = visionPayload?.usage ?? {};
      const visionInputTokens = Number(visionUsage.input_tokens ?? 0);
      const visionOutputTokens = Number(visionUsage.output_tokens ?? 0);
      const visionCostUsd =
        (visionInputTokens / 1_000_000) * PRICE_PER_MTOK_INPUT_USD + (visionOutputTokens / 1_000_000) * PRICE_PER_MTOK_OUTPUT_USD;

      const visionText = extractText(visionPayload);
      const parsedVision = extractJson(visionText);
      const people = Array.isArray(parsedVision?.items) ? parsedVision!.items : [];
      const items = people
        .map((raw) => {
          const p = raw as Record<string, unknown>;
          const age = typeof p.age === "number" && p.age >= 0 && p.age <= 120 ? p.age : null;
          return {
            name: String(p.name ?? "").trim().slice(0, 120),
            age,
            age_range: null,
            preferences: [] as string[],
          };
        })
        .filter((p) => p.name);

      await logRun({
        kind: "generate_passports",
        tripId: null,
        inputTokens: visionInputTokens,
        outputTokens: visionOutputTokens,
        costUsd: visionCostUsd,
        latencyMs,
        status: "ok",
        // Zero items usually means the model declined to read the photo (glare,
        // blur, or caution around ID documents) rather than a code failure —
        // keep its raw answer so a report of "couldn't identify" is diagnosable
        // from the monitoring table instead of guessing blind.
        errorMessage:
          items.length === 0
            ? `empty_result: stop=${visionPayload?.stop_reason} blocks=${(visionPayload?.content ?? []).map((b: { type?: string }) => b?.type).join(",")} text=${visionText.slice(0, 300)}`
            : undefined,
      });
      return new Response(JSON.stringify({ ok: true, items }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Voucher scanning (flight/hotel/car-rental booking confirmations) returns a
    // classified record (for flights: every segment in the document, with the
    // first also in `data`) for client-side review only and writes nothing
    // itself — same reasoning as "passports" above: no trip ownership check
    // needed (this also covers the Wizard's logistics step, called before a
    // trip row exists at all), but it's still a vision call so still capped
    // and logged (trip_id: null when called without a real trip yet).
    if (body.kind === "voucher") {
      const images = (body.images ?? []).slice(0, 8);
      if (!images.length) {
        return new Response(JSON.stringify({ error: "no_images", ok: false }), {
          status: 400,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      const content: unknown[] = images.map((img) =>
        img.media_type === "application/pdf"
          ? { type: "document", source: { type: "base64", media_type: img.media_type, data: img.data } }
          : { type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } },
      );

      const hintLabels: Record<string, string> = { flight: "טיסה", hotel: "מלון", car: "רכב/העברה" };
      const hintLine =
        body.hint && hintLabels[body.hint]
          ? `המשתמש חושב שזהו אישור הזמנה מסוג "${hintLabels[body.hint]}", אך סווג לפי תוכן המסמך בפועל וזהה מחדש אם הוא טעה.\n\n`
          : "";

      content.push({
        type: "text",
        text: `זהו את סוג מסמך ההזמנה המצורף (אישור טיסה / אישור מלון / אישור השכרת רכב או הסעה), וחלץ ממנו את הפרטים בדיוק כפי שהם מופיעים במסמך.

המסמך עשוי להשתרע על פני כמה עמודים — למשל כרטיס אלקטרוני נפרד לכל נוסע, או עמודים נפרדים לטיסת ההלוך ולטיסת החזור. קרא את כל העמודים עד הסוף, לא רק את הראשון, ואסוף את הפרטים מכולם.

${hintLine}החזר JSON בלבד, ללא טקסט נוסף, באחד מהמבנים הבאים לפי סוג המסמך שזיהית בפועל:

אם זו טיסה:
{"doc_type":"flight","segments":[{"direction":"outbound","airline":"שם חברת התעופה כפי שמופיע במסמך","flight_number":"מספר טיסה","from_airport":"קוד שדה תעופה בן 3 אותיות או שם","to_airport":"קוד שדה תעופה בן 3 אותיות או שם","depart_at":"YYYY-MM-DDTHH:MM:00","arrive_at":"YYYY-MM-DDTHH:MM:00","from_terminal":null,"to_terminal":null,"seats":null,"baggage":null,"booking_ref":null,"notes":null},{"direction":"inbound","airline":"שם חברת התעופה כפי שמופיע במסמך","flight_number":"מספר טיסה","from_airport":"קוד שדה תעופה בן 3 אותיות או שם","to_airport":"קוד שדה תעופה בן 3 אותיות או שם","depart_at":"YYYY-MM-DDTHH:MM:00","arrive_at":"YYYY-MM-DDTHH:MM:00","from_terminal":null,"to_terminal":null,"seats":null,"baggage":null,"booking_ref":null,"notes":null}],"destination":"עיר, מדינה","passengers":[{"name":"שם הנוסע כפי שמודפס","type":"adult|child|infant|null","birth_date":null,"meal_code":null}]}

segments (כל קטעי הטיסה שבמסמך):
- פריט אחד לכל קטע טיסה: טיסת ההלוך, טיסת החזור, וכל רגל של טיסת המשך (קונקשן) כקטע נפרד. אל תחזיר רק את הטיסה הראשונה.
- לפי סדר כרונולוגי של זמן ההמראה.
- אותה טיסה שמופיעה בעמוד של כל נוסע היא קטע אחד — לא קטע לכל נוסע.
- direction לכל קטע: "outbound" אם הקטע יוצא מישראל, "inbound" אם הוא נוחת בישראל; רגל של טיסת המשך מקבלת את הכיוון של המסלול שהיא חלק ממנו (הלוך או חזור). אם לא ברור, "outbound".
- seats: המושבים של כל הנוסעים בקטע הזה, אם מודפסים.

אם זה מלון:
{"doc_type":"hotel","data":{"hotel_name":"שם המלון","address":null,"check_in":"YYYY-MM-DD","check_out":"YYYY-MM-DD","booking_ref":null,"phone":null,"url":null,"notes":null},"destination":"עיר, מדינה","passengers":[{"name":"שם האורח כפי שמודפס","type":null,"birth_date":null,"meal_code":null}]}

אם זו השכרת רכב או הסעה:
{"doc_type":"car","data":{"provider":"שם חברת ההשכרה או ההסעה","pickup_location":"נקודת איסוף","dropoff_location":null,"pickup_at":"YYYY-MM-DDTHH:MM:00","return_at":null,"booking_ref":null,"phone":null,"url":null,"notes":null},"destination":"עיר, מדינה","passengers":[{"name":"שם הנהג/הנוסע כפי שמודפס","type":null,"birth_date":null,"meal_code":null}]}

אם המסמך אינו נראה כמו אישור הזמנה של טיסה/מלון/רכב, או שאי אפשר לזהות בבירור:
{"doc_type":"unknown","data":null,"destination":null,"passengers":[]}

כללים:
- כל שדה שלא מופיע במסמך בבירור — החזר null, אל תמציא ואל תנחש.
- תאריכים/שעות: קרא בדיוק את מה שמודפס במסמך, ללא המרת אזור זמן.
- שמות (חברת תעופה, מלון, ספק) — השאר בשפה שבה הם מופיעים במסמך (עברית או לועזית), אל תתרגם.
- אם אתה לא בטוח בסוג המסמך — עדיף "unknown" מאשר סיווג שגוי.

destination (יעד הטיול שההזמנה מרמזת עליו):
- בפורמט "עיר, מדינה" בעברית, למשל "רומא, איטליה".
- מלון: העיר שבה נמצא המלון. טיסה: הקצה של המסלול שאינו בישראל (ביעד הסופי של מסלול ההלוך, במוצא של מסלול החזור — לא עיר של עצירת ביניים). רכב/הסעה: העיר של נקודת האיסוף.
- אם לא ניתן להסיק את העיר בבירור מהמסמך — null. אל תנחש.

passengers (הנוסעים/האורחים ששמם מודפס בהזמנה):
- פריט אחד לכל אדם ששמו מודפס במסמך. אם אין שמות במסמך — מערך ריק [].
- רשום את כל הנוסעים ששמם מופיע בעמוד כלשהו של המסמך. אל תעצור אחרי העמוד הראשון או אחרי הנוסע הראשון — בכרטיס משפחתי יש לרוב עמוד (כרטיס אלקטרוני) נפרד לכל נוסע.
- כל אדם מופיע פעם אחת בלבד: אותו נוסע שמופיע בכמה עמודים הוא פריט אחד.
- name: בפורמט קריא "שם פרטי שם משפחה" (למשל COHEN/ROI MR ← "Roi Cohen"), ללא תארים או סימוני סוג (MR/MRS/MS/MSTR/MISS/CHD/INF/ADT).
- name: השאר את השם בכתב שבו הוא מודפס — שם לועזי נשאר באותיות לועזיות ושם עברי נשאר בעברית. אל תתעתק ואל תתרגם שמות.
- אל תמציא שמות, אל תשלים שם חלקי ואל תנחש שם שלא מודפס בבירור.
- type: "adult" / "child" / "infant" רק אם מופיע במסמך סימון סוג נוסע מפורש (ADT/CHD/INF, מבוגר/ילד/תינוק, Adult/Child/Infant). אחרת null — אל תסיק סוג מהשם או מהתואר.
- birth_date: "YYYY-MM-DD" רק אם תאריך הלידה מודפס במסמך, אחרת null.
- meal_code: קוד הארוחה המיוחדת כפי שמודפס (למשל KSML, VGML, VLML, AVML), אחרת null.`,
      });

      const runStart = Date.now();
      const visionRes = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          output_config: VOUCHER_OUTPUT_CONFIG,
          messages: [{ role: "user", content }],
        }),
      });
      const latencyMs = Date.now() - runStart;

      if (!visionRes.ok) {
        const detail = await visionRes.text();
        await logRun({ kind: "generate_voucher", tripId: body.trip_id ?? null, inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs, status: "error", errorMessage: detail });
        return new Response(JSON.stringify({ error: "llm_failed", detail, ok: false }), {
          status: 502,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      const visionPayload = await visionRes.json();
      const visionUsage = visionPayload?.usage ?? {};
      const visionInputTokens = Number(visionUsage.input_tokens ?? 0);
      const visionOutputTokens = Number(visionUsage.output_tokens ?? 0);
      const visionCostUsd =
        (visionInputTokens / 1_000_000) * PRICE_PER_MTOK_INPUT_USD + (visionOutputTokens / 1_000_000) * PRICE_PER_MTOK_OUTPUT_USD;

      const visionText = extractText(visionPayload);
      const parsedVision = extractJson(visionText);
      const rawDocType = String(parsedVision?.doc_type ?? "unknown");
      const docType = (["flight", "hotel", "car"].includes(rawDocType) ? rawDocType : "unknown") as
        | "flight"
        | "hotel"
        | "car"
        | "unknown";
      const rawData = (parsedVision?.data ?? null) as Record<string, unknown> | null;

      // Small local helpers — every field lands as a trimmed string capped at a
      // sane length, or null. Never trust the model's null-ness claims blindly,
      // but never invent a value either.
      const str = (v: unknown, max = 300): string | null => {
        const s = typeof v === "string" ? v.trim() : "";
        return s ? s.slice(0, max) : null;
      };
      const isoDateTime = (v: unknown): string | null => {
        const s = typeof v === "string" ? v.trim() : "";
        return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) ? s.slice(0, 16) + ":00" : null;
      };
      const isoDate = (v: unknown): string | null => {
        const s = typeof v === "string" ? v.trim() : "";
        return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
      };

      const sanitizeFlight = (raw: Record<string, unknown>) => ({
        direction: raw.direction === "inbound" ? "inbound" : "outbound",
        airline: str(raw.airline, 120),
        flight_number: str(raw.flight_number, 20),
        from_airport: str(raw.from_airport, 10),
        to_airport: str(raw.to_airport, 10),
        depart_at: isoDateTime(raw.depart_at),
        arrive_at: isoDateTime(raw.arrive_at),
        from_terminal: str(raw.from_terminal, 20),
        to_terminal: str(raw.to_terminal, 20),
        seats: str(raw.seats, 60),
        baggage: str(raw.baggage, 120),
        booking_ref: str(raw.booking_ref, 60),
        notes: str(raw.notes, 500),
      });

      // Every flight segment in the document (outbound, return, connection
      // legs). Falls back to a lone `data` object if the model answered in the
      // old single-flight shape. A segment with neither a flight number nor
      // both airports is noise and is dropped; an exact repeat (same flight
      // number + departure — the same flight printed on each passenger's page)
      // is kept once. Sorted by departure only when every segment has one,
      // otherwise the model's (already chronological) order is kept.
      let segments: ReturnType<typeof sanitizeFlight>[] = [];
      if (docType === "flight") {
        const rawSegments: unknown[] =
          Array.isArray(parsedVision?.segments) && (parsedVision!.segments as unknown[]).length
            ? (parsedVision!.segments as unknown[])
          : rawData
            ? [rawData]
            : [];
        const seen = new Set<string>();
        segments = rawSegments
          .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && !Array.isArray(s))
          .map(sanitizeFlight)
          .filter((s) => s.flight_number || (s.from_airport && s.to_airport))
          .filter((s) => {
            if (!s.flight_number || !s.depart_at) return true;
            const key = `${s.flight_number.replace(/\s+/g, "").toUpperCase()}|${s.depart_at}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        if (segments.every((s) => s.depart_at)) {
          segments.sort((a, b) => (a.depart_at! < b.depart_at! ? -1 : a.depart_at! > b.depart_at! ? 1 : 0));
        }
        segments = segments.slice(0, 8);
      }

      let data: Record<string, unknown> | null = null;
      if (docType === "flight") {
        data = segments[0] ?? null;
      } else if (docType === "hotel" && rawData) {
        data = {
          hotel_name: str(rawData.hotel_name, 200) ?? "",
          address: str(rawData.address, 300),
          check_in: isoDate(rawData.check_in),
          check_out: isoDate(rawData.check_out),
          booking_ref: str(rawData.booking_ref, 60),
          phone: str(rawData.phone, 40),
          url: str(rawData.url, 500),
          notes: str(rawData.notes, 500),
        };
      } else if (docType === "car" && rawData) {
        data = {
          provider: str(rawData.provider, 200),
          pickup_location: str(rawData.pickup_location, 300),
          dropoff_location: str(rawData.dropoff_location, 300),
          pickup_at: isoDateTime(rawData.pickup_at),
          return_at: isoDateTime(rawData.return_at),
          booking_ref: str(rawData.booking_ref, 60),
          phone: str(rawData.phone, 40),
          url: str(rawData.url, 500),
          notes: str(rawData.notes, 500),
        };
      }

      const finalDocType = data ? docType : "unknown";

      // Trip destination the booking implies ("עיר, מדינה", Hebrew) — optional,
      // only meaningful alongside a recognized booking.
      const destination = finalDocType !== "unknown" ? str(parsedVision?.destination, 80) : null;

      // Travellers named on the booking. The model normalizes the name; this is
      // a deterministic safety net on top (PNR "LAST/FIRST MR" order, stray
      // titles, ALL-CAPS Latin) — it never changes the script the name was
      // printed in. Special-meal code → preference is mapped here, not by the
      // model, so the mapping is exact and auditable.
      const TITLE_TOKEN = /^\(?(MR|MRS|MS|MSTR|MISS|CHD|INF|ADT|DR)\.?\)?$/i;
      const normalizePassengerName = (raw: string): { name: string; marker: "child" | "infant" | null } => {
        let marker: "child" | "infant" | null = null;
        const stripTitles = (part: string) =>
          part
            .split(/\s+/)
            .filter((tok) => {
              if (!TITLE_TOKEN.test(tok)) return true;
              const t = tok.replace(/[().]/g, "").toUpperCase();
              if (t === "CHD") marker = "child";
              if (t === "INF") marker = "infant";
              return false;
            })
            .join(" ");
        let s = raw.replace(/\s+/g, " ").trim();
        if (s.includes("/")) {
          const [last, ...rest] = s.split("/");
          s = `${stripTitles(rest.join(" "))} ${stripTitles(last)}`;
        } else {
          s = stripTitles(s);
        }
        s = s.replace(/\s+/g, " ").trim();
        // ALL-CAPS Latin (no lowercase at all) → Title Case. Hebrew has no case,
        // so a Hebrew name passes through untouched.
        if (/[A-Z]/.test(s) && !/[a-z]/.test(s)) {
          s = s.toLowerCase().replace(/(^|[\s\-'])([a-z])/g, (_m, pre: string, ch: string) => pre + ch.toUpperCase());
        }
        return { name: s.slice(0, 120), marker };
      };
      const MEAL_PREFS: Record<string, string> = {
        KSML: "kosher",
        VGML: "vegetarian",
        VLML: "vegetarian",
        AVML: "vegetarian",
        VJML: "vegetarian",
        VOML: "vegetarian",
      };
      const rawPassengers =
        finalDocType !== "unknown" && Array.isArray(parsedVision?.passengers) ? (parsedVision!.passengers as unknown[]) : [];
      const passengers = rawPassengers
        .map((raw) => {
          const p = (raw ?? {}) as Record<string, unknown>;
          const rawName = str(p.name, 160);
          if (!rawName) return null;
          const { name, marker } = normalizePassengerName(rawName);
          if (!name) return null;
          const type =
            p.type === "adult" || p.type === "child" || p.type === "infant" ? (p.type as string) : marker;
          const mealCode = (str(p.meal_code, 8) ?? "").toUpperCase();
          const pref = MEAL_PREFS[mealCode];
          return {
            name,
            type: type ?? null,
            birth_date: isoDate(p.birth_date),
            preferences: pref ? [pref] : ([] as string[]),
          };
        })
        .filter((p): p is NonNullable<typeof p> => p !== null)
        .slice(0, 12);

      await logRun({
        kind: "generate_voucher",
        tripId: body.trip_id ?? null,
        inputTokens: visionInputTokens,
        outputTokens: visionOutputTokens,
        costUsd: visionCostUsd,
        latencyMs,
        status: "ok",
        errorMessage:
          finalDocType === "unknown"
            ? `unknown_doc: stop=${visionPayload?.stop_reason} blocks=${(visionPayload?.content ?? []).map((b: { type?: string }) => b?.type).join(",")} text=${visionText.slice(0, 300)}`
            : undefined,
      });
      // `segments` / `destination` / `passengers` are additive — `data` stays the
      // first flight segment for any caller that only reads doc_type/data.
      // Non-flight documents (and unknown) always get `segments: []`.
      const outSegments = finalDocType === "flight" ? segments : [];
      return new Response(JSON.stringify({ ok: true, doc_type: finalDocType, data, segments: outSegments, destination, passengers }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Verify the caller actually owns this trip before generating anything.
    // Comparing user_id explicitly is required, not decorative: the "shared
    // trips readable" policy also applies to `authenticated`, so a plain
    // select by id succeeds for anyone's shared trip too (same issue already
    // fixed in ../ask/index.ts) — without this check any signed-in user could
    // spend the project's API budget generating content on someone else's
    // shared trip.
    const { data: trip, error: tripErr } = await supabase
      .from("trips")
      .select("id, user_id")
      .eq("id", body.trip_id)
      .maybeSingle();
    if (tripErr || !trip || trip.user_id !== auth.user.id) {
      return new Response(JSON.stringify({ error: "trip not found" }), {
        status: 404,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Used by kind:"geocode" (Nominatim lookup), which needs a Latin-script
    // query — manually-typed titles / destinations are Hebrew. AI-generated
    // items never go through it (their lat/lng come straight from the model —
    // see buildPrompt).
    // Best-effort: a translation failure just falls back to the original
    // (Hebrew) query, which will likely miss — no worse than before, never
    // blocks the response. Gated by the same daily cap as any other LLM
    // call, since unlike its caller this sub-call does cost money.
    const translateHebrewQuery = async (query: string, logKind: string): Promise<string> => {
      if (!/[֐-׿]/.test(query)) return query;
      const { data: spentToday } = await supabase.rpc("my_agent_daily_cost_usd");
      if ((spentToday ?? 0) >= DAILY_CAP_USD) return query;
      try {
        const start = Date.now();
        const tRes = await fetch(ANTHROPIC_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            output_config: EXTRACTION_OUTPUT_CONFIG,
            messages: [{
              role: "user",
              content: `Translate this Hebrew place/activity name to a short English search phrase (2-5 words, no punctuation, no explanation — just the phrase): "${query}"`,
            }],
          }),
        });
        const tLatency = Date.now() - start;
        if (!tRes.ok) {
          console.error("Query translation failed", tRes.status);
          return query;
        }
        const tPayload = await tRes.json();
        const usage = tPayload?.usage ?? {};
        const inputTokens = Number(usage.input_tokens ?? 0);
        const outputTokens = Number(usage.output_tokens ?? 0);
        const costUsd = (inputTokens / 1_000_000) * PRICE_PER_MTOK_INPUT_USD + (outputTokens / 1_000_000) * PRICE_PER_MTOK_OUTPUT_USD;
        const translated = extractText(tPayload).trim();
        await logRun({ kind: logKind, tripId: body.trip_id, inputTokens, outputTokens, costUsd, latencyMs: tLatency, status: "ok" });
        return translated || query;
      } catch (e) {
        console.error("Query translation threw", e);
        return query;
      }
    };

    // `photo` (manual add, "מובילים" picks, itinerary edit): the client sends
    // free text like "<title> <destination>", usually Hebrew. One small LLM
    // call names the exact English Wikipedia article for that place (or NONE),
    // then wikipediaPhoto looks that title up verbatim. Never an error to the
    // client: over the daily cap, NONE, or any failure → { ok: true, image_url: null }.
    if (body.kind === "photo") {
      const query = (body.query ?? "").trim().slice(0, 300);
      const photoResponse = (image_url: string | null) =>
        new Response(JSON.stringify({ ok: true, image_url }), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      if (!query) return photoResponse(null);
      const { data: spentToday } = await supabase.rpc("my_agent_daily_cost_usd");
      if ((spentToday ?? 0) >= DAILY_CAP_USD) return photoResponse(null);
      try {
        const start = Date.now();
        const tRes = await fetch(ANTHROPIC_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            output_config: EXTRACTION_OUTPUT_CONFIG,
            messages: [{
              role: "user",
              content: `Place (may be in Hebrew, usually followed by the trip destination): "${query}"

Reply with ONLY the exact title of the English Wikipedia article about this specific place — no explanation, no quotes, no URL.
Reply with the single word NONE if you are not confident an English Wikipedia article exists for exactly this place (most restaurants, cafes, shops, hotels, tours and generic activities have none).
Never answer with the article of the surrounding city, region or country — e.g. not "Paphos" for a restaurant in Paphos. In that case answer NONE.`,
            }],
          }),
        });
        const tLatency = Date.now() - start;
        if (!tRes.ok) {
          const detail = await tRes.text().catch(() => "");
          console.error("Wikipedia title lookup failed", tRes.status);
          await logRun({ kind: "generate_photo_title", tripId: body.trip_id, inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: tLatency, status: "error", errorMessage: detail });
          return photoResponse(null);
        }
        const tPayload = await tRes.json();
        const usage = tPayload?.usage ?? {};
        const inputTokens = Number(usage.input_tokens ?? 0);
        const outputTokens = Number(usage.output_tokens ?? 0);
        const costUsd = (inputTokens / 1_000_000) * PRICE_PER_MTOK_INPUT_USD + (outputTokens / 1_000_000) * PRICE_PER_MTOK_OUTPUT_USD;
        const title = parseWikipediaTitle(extractText(tPayload));
        const photo: { url: string | null; fail?: string; cached?: boolean } = title
          ? await wikipediaPhoto(title)
          : { url: null, fail: "none" };
        await logRun({
          kind: "generate_photo_title",
          tripId: body.trip_id,
          inputTokens,
          outputTokens,
          costUsd,
          latencyMs: tLatency,
          status: "ok",
          errorMessage: `diag: title=${title ?? "NONE"} photo=${photo.url ? (photo.cached ? "cached" : "found") : photo.fail}`,
        });
        return photoResponse(photo.url);
      } catch (e) {
        console.error("Wikipedia title lookup threw", e);
        return photoResponse(null);
      }
    }

    // `geocode` has no LLM call of its own (just a Nominatim lookup plus the
    // Hebrew-translation sub-call), handled early, exempt from the daily cap above.
    if (body.kind === "geocode") {
      const query = await translateHebrewQuery((body.query ?? "").trim(), "generate_geocode_translate");
      const coords = await geocodeWithNominatim(query);
      return new Response(JSON.stringify({ ok: true, lat: coords?.lat ?? null, lng: coords?.lng ?? null }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // What this trip already has in the target table — feeds the prompt's
    // "don't repeat" list, the duplicate-title filter and the shared-photo
    // check below, so pressing the AI button again adds new places instead of
    // the same ones twice. Caller's JWT (RLS applies; ownership verified
    // above). A failed read only means no dedupe context — never a failed run.
    let existing: ExistingRow[] = [];
    try {
      if (body.kind === "suggestions") {
        const { data } = await supabase
          .from("suggestions")
          .select("title, image_url, kind")
          .eq("trip_id", body.trip_id)
          .order("created_at", { ascending: true })
          .limit(1000);
        existing = (data ?? []) as ExistingRow[];
      } else if (body.kind === "itinerary") {
        const { data } = await supabase
          .from("itinerary_items")
          .select("title, image_url, day_date, start_time, category")
          .eq("trip_id", body.trip_id)
          .order("day_date", { ascending: true })
          .order("start_time", { ascending: true, nullsFirst: false })
          .limit(1000);
        existing = (data ?? []) as ExistingRow[];
      }
    } catch (e) {
      console.error("Existing rows lookup threw", e);
      existing = [];
    }
    existing = existing.filter((r) => typeof r.title === "string" && r.title.trim() !== "");

    const runStart = Date.now();
    const llm = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: buildPrompt(body, existing) }],
      }),
    });
    const latencyMs = Date.now() - runStart;

    if (!llm.ok) {
      const detail = await llm.text();
      await logRun({ kind: `generate_${body.kind}`, tripId: body.trip_id, inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs, status: "error", errorMessage: detail });
      return new Response(JSON.stringify({ error: "llm_failed", detail }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const payload = await llm.json();
    const usage = payload?.usage ?? {};
    const inputTokens = Number(usage.input_tokens ?? 0);
    const outputTokens = Number(usage.output_tokens ?? 0);
    const costUsd = (inputTokens / 1_000_000) * PRICE_PER_MTOK_INPUT_USD + (outputTokens / 1_000_000) * PRICE_PER_MTOK_OUTPUT_USD;

    const text = extractText(payload);
    const parsed = extractJson(text);
    const items = Array.isArray(parsed?.items) ? parsed!.items : [];
    // Diagnostics recorded on the agent_runs row (status stays "ok"): how many
    // JSON blocks came back, how many items survived into rows, and how photo
    // lookups went — enough to tell a parsing loss from a model or photo issue.
    const jsonBlocks = extractJsonObjects(text).length;
    let photoStats = "";
    if (items.length === 0) {
      await logRun({
        kind: `generate_${body.kind}`,
        tripId: body.trip_id,
        inputTokens,
        outputTokens,
        costUsd,
        latencyMs,
        status: "ok",
        errorMessage: `empty_result: stop=${payload?.stop_reason} blocks=${(payload?.content ?? []).map((b: { type?: string }) => b?.type).join(",")} text=${text.slice(0, 300)}`,
      });
      return new Response(JSON.stringify({ error: "no_items", inserted: 0 }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    let inserted = 0;
    let dupStats = "";

    // Both AI-generated kinds get one Wikipedia lookup per item, keyed off the
    // model's own `wikipedia_title` — the exact article about that place (see
    // WIKIPEDIA_TITLE_RULE). An item with no title gets no lookup and no photo:
    // no guessing from the Hebrew title, no search. allSettled means a slow or
    // failed lookup for one item can never fail the whole insert — it just
    // leaves that row's image_url null.
    const photoUrlAt = (results: PromiseSettledResult<{ url: string | null; fail?: string }>[], idx: number): string | null => {
      const r = results[idx];
      return r?.status === "fulfilled" ? r.value.url : null;
    };
    // `skip` marks items that aren't a place (general tips, free time,
    // transport) — no photo lookup for those.
    const lookupPhotos = async (list: Record<string, unknown>[], skip: (i: Record<string, unknown>) => boolean) => {
      const titles = list.map((i) => (skip(i) ? null : parseWikipediaTitle(i.wikipedia_title)));
      const results = await Promise.allSettled(
        list.map(async (_i, idx): Promise<{ url: string | null; fail?: string; cached?: boolean }> => {
          const title = titles[idx];
          return title ? wikipediaPhoto(title) : { url: null };
        }),
      );
      const skipped = list.filter(skip).length;
      const noTitle = titles.filter((t, idx) => !t && !skip(list[idx])).length;
      const found = results.filter((r) => r.status === "fulfilled" && r.value.url).length;
      const cached = results.filter((r) => r.status === "fulfilled" && r.value.cached).length;
      const firstFail = results
        .map((r) => (r.status === "fulfilled" ? r.value.fail : `rejected:${String(r.reason).slice(0, 60)}`))
        .find((f) => f);
      photoStats = `photos=${found}/${list.length - skipped} cached=${cached} no_title=${noTitle} skipped=${skipped}${firstFail ? ` first_fail=${firstFail}` : ""}`;
      return results;
    };

    // Safety net behind the prompt's "don't repeat" list: drop a generated
    // item whose duplicate key matches an existing row of this table or an
    // earlier item in this batch. The key is the normalized title, except in
    // the itinerary where meals, free time and transport legitimately repeat
    // day to day ("ארוחת בוקר במלון"), so those are unique per day only; a
    // place or activity stays unique across the whole trip.
    const dupKey = (r: { title: string; day_date?: string | null; category?: string | null }): string => {
      const t = normalizeTitle(r.title);
      if (!t) return "";
      const perDay = body.kind === "itinerary" && (r.category === "food" || r.category === "free" || r.category === "transport");
      return perDay ? `${r.day_date ?? ""}|${t}` : t;
    };
    const dropDuplicates = <T extends { row: { title: string; day_date?: string | null; category?: string | null } }>(list: T[]): T[] => {
      const seen = new Set(existing.map(dupKey).filter(Boolean));
      return list.filter(({ row }) => {
        const key = dupKey(row);
        if (!key) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    // One photo per place: if an image URL is already used — by an existing
    // row of this table or an earlier row of this batch — for a DIFFERENT
    // normalized title, this row's copy is a misleading repeat, so it falls
    // back to no photo. The same place may share a photo across tables
    // (suggestions vs itinerary) since each table is checked on its own.
    const clearSharedPhotos = <R extends { title: string; image_url: string | null }>(rows: R[]): { rows: R[]; cleared: number } => {
      const owner = new Map<string, string>();
      for (const r of existing) {
        if (r.image_url && !owner.has(r.image_url)) owner.set(r.image_url, normalizeTitle(r.title));
      }
      let cleared = 0;
      const out = rows.map((r) => {
        if (!r.image_url) return r;
        const key = normalizeTitle(r.title);
        const prev = owner.get(r.image_url);
        if (prev === undefined) {
          owner.set(r.image_url, key);
          return r;
        }
        if (prev === key) return r;
        cleared++;
        return { ...r, image_url: null };
      });
      return { rows: out, cleared };
    };

    // Every generated item was a duplicate (or otherwise unusable): same
    // response as the empty-reply path, but the diagnostics say which it was.
    const noNewItems = async (reason: string, dupDropped: number) => {
      await logRun({
        kind: `generate_${body.kind}`,
        tripId: body.trip_id,
        inputTokens,
        outputTokens,
        costUsd,
        latencyMs,
        status: "ok",
        errorMessage: `diag: ${reason} stop=${payload?.stop_reason} json_blocks=${jsonBlocks} items=${items.length} dup_dropped=${dupDropped} existing=${existing.length} rows=0`,
      });
      return new Response(JSON.stringify({ error: "no_items", inserted: 0 }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    };

    // The model's own best-guess coordinates (see buildPrompt) — no extra
    // latency or cost, since it's part of the same LLM call already made.
    // Not survey-grade, same precision bar as this app's existing map_url
    // (a Google-Maps search link) — good enough for a map pin.
    const latOf = (raw: unknown): number | null => {
      const v = (raw as Record<string, unknown>).lat;
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    };
    const lngOf = (raw: unknown): number | null => {
      const v = (raw as Record<string, unknown>).lng;
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    };

    // Order for both kinds: build + validate rows, drop duplicates, then look
    // up photos only for the survivors, then clear photos shared between places.
    if (body.kind === "suggestions") {
      const built = items.map((raw) => {
        const i = raw as Record<string, unknown>;
        return {
          raw: i,
          row: {
            trip_id: body.trip_id,
            kind: ["attraction", "restaurant", "tip", "gear"].includes(String(i.kind)) ? String(i.kind) : "attraction",
            title: String(i.title ?? "").slice(0, 300),
            description: i.description ? String(i.description) : null,
            tags: Array.isArray(i.tags) ? (i.tags as unknown[]).map(String).slice(0, 8) : [],
            age_min: typeof i.age_min === "number" ? i.age_min : null,
            age_max: typeof i.age_max === "number" ? i.age_max : null,
            price_level: i.price_level ? String(i.price_level) : null,
            lat: latOf(i),
            lng: lngOf(i),
          },
        };
      }).filter(({ row }) => row.title);
      const kept = dropDuplicates(built);
      const dupDropped = built.length - kept.length;
      if (!kept.length) return await noNewItems(dupDropped ? "all_duplicates" : "no_valid_rows", dupDropped);
      const photoResults = await lookupPhotos(kept.map((k) => k.raw), (i) => i.kind === "tip" || i.kind === "gear");
      const { rows, cleared } = clearSharedPhotos(kept.map((k, idx) => ({ ...k.row, image_url: photoUrlAt(photoResults, idx) })));
      const { error } = await supabase.from("suggestions").insert(rows);
      if (error) throw error;
      inserted = rows.length;
      dupStats = `dup_dropped=${dupDropped} photo_dup_cleared=${cleared} existing=${existing.length}`;
    } else if (body.kind === "itinerary") {
      const built = items.map((raw, idx) => {
        const i = raw as Record<string, unknown>;
        return {
          raw: i,
          row: {
            trip_id: body.trip_id,
            day_date: String(i.day_date ?? body.trip.start_date ?? new Date().toISOString().slice(0, 10)),
            start_time: i.start_time ? String(i.start_time) : null,
            title: String(i.title ?? "").slice(0, 300),
            description: i.description ? String(i.description) : null,
            category: ["activity", "food", "transport", "flight", "hotel", "free"].includes(String(i.category))
              ? String(i.category)
              : "activity",
            location: i.location ? String(i.location) : null,
            sort_order: idx,
            lat: latOf(i),
            lng: lngOf(i),
          },
        };
      }).filter(({ row }) => row.title && /^\d{4}-\d{2}-\d{2}$/.test(row.day_date));
      const kept = dropDuplicates(built);
      const dupDropped = built.length - kept.length;
      if (!kept.length) return await noNewItems(dupDropped ? "all_duplicates" : "no_valid_rows", dupDropped);
      const photoResults = await lookupPhotos(kept.map((k) => k.raw), (i) => i.category === "transport" || i.category === "free");
      const { rows, cleared } = clearSharedPhotos(kept.map((k, idx) => ({ ...k.row, image_url: photoUrlAt(photoResults, idx) })));
      const { error } = await supabase.from("itinerary_items").insert(rows);
      if (error) throw error;
      inserted = rows.length;
      dupStats = `dup_dropped=${dupDropped} photo_dup_cleared=${cleared} existing=${existing.length}`;
    } else {
      const rows = items.map((raw, idx) => {
        const i = raw as Record<string, unknown>;
        return {
          trip_id: body.trip_id,
          title: String(i.title ?? "").slice(0, 300),
          is_shared: i.is_shared !== false,
          sort_order: idx,
        };
      }).filter((r) => r.title);
      const { error } = await supabase.from("checklist_items").insert(rows);
      if (error) throw error;
      inserted = rows.length;
    }

    await logRun({
      kind: `generate_${body.kind}`,
      tripId: body.trip_id,
      inputTokens,
      outputTokens,
      costUsd,
      latencyMs,
      status: "ok",
      errorMessage: `diag: stop=${payload?.stop_reason} json_blocks=${jsonBlocks} items=${items.length} rows=${inserted}${dupStats ? ` ${dupStats}` : ""}${photoStats ? ` ${photoStats}` : ""}`,
    });
    return new Response(JSON.stringify({ ok: true, inserted }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
