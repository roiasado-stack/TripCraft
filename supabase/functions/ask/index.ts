/**
 * TripCraft agent — Supabase Edge Function (Deno).
 *
 * Answers free-form Hebrew questions about one trip, using a real Anthropic
 * tool-use loop (see ./prompt.ts for the tool definitions):
 *   - find_kosher is read-only and executes inline in the loop: semantic
 *     search (Voyage AI embeddings + pgvector) over a knowledge base that
 *     covers exactly 3 destinations (see evals/knowledge-source.ts). A trip
 *     anywhere else gets an honest "not covered" — matchKnowledgeDestination
 *     in prompt.ts gates this before any embeddings call is even made.
 *   - add_to_itinerary / add_suggestion are writes, and the loop never
 *     touches the database for them. It only records what Claude proposed
 *     and returns it to the client as a `pendingActions` entry; the client
 *     shows an approval card, and the actual insert only happens if the user
 *     confirms — a second request to this same function with
 *     `confirm_action` set (see that branch below). That gap between
 *     "proposed" and "written" is the human-in-the-loop gate.
 *
 * Owner-only, same as before. The conversational branch writes nothing
 * itself (the caller persists both turns into `trip_chat_messages`); the
 * confirm_action branch is the only thing in this file that writes, and it
 * only ever writes to itinerary_items or suggestions — never documents,
 * never user_roles.
 *
 * find_kosher is also live worldwide (./kosher.ts): curated items first, then
 * places tagged kosher on OpenStreetMap and found by Google Places near the
 * destination, plus Hebcal Shabbat/yom tov times — each result carrying its
 * trust tier. A request with `kosher` set runs the same lookup without the
 * model, for the Suggestions and Itinerary screens.
 *
 * Deploy:
 *   supabase functions deploy ask
 *   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 *   supabase secrets set VOYAGE_API_KEY=pa-...
 *   supabase secrets set GOOGLE_PLACES_API_KEY=...   (optional: without it, OSM only)
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { ANTHROPIC_URL, buildSnapshot, INSTRUCTIONS, matchKnowledgeDestination, MODEL, TOOLS, type Participant } from "./prompt.ts";
import {
  type CuratedItem,
  geocodeDestination,
  googleGeocode,
  isTooWide,
  type KosherPlace,
  mergePlaces,
  searchGoogleKosher,
  searchOsmKosher,
  searchRadiusM,
  shabbatTimes,
  type ShabbatInfo,
  TIER_LABEL,
  toCuratedItem,
} from "./kosher.ts";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-4-lite";
const VOYAGE_DIMENSION = 1024;
// Cheap enough ($0.02/Mtok, 200M tokens free per account) that this barely
// registers, but agent_runs should still reflect real spend, not zero.
const VOYAGE_PRICE_PER_MTOK_USD = 0.02;

/** How many past turns of the conversation we replay to the model. */
const MAX_HISTORY = 12;
/** Bounds worst-case cost/latency of one question — find_kosher can chain a
 *  couple of times, but the loop must not run indefinitely. */
const MAX_TOOL_ITERATIONS = 4;

// claude-haiku-5-5 pricing (Anthropic API, prompts up to 100k tokens — ours are
// far below). Update alongside evals/run.ts's copy of the same numbers if
// pricing changes — they're two different runtimes (Deno vs Node) so this
// isn't shared as one constant.
const PRICE_PER_MTOK_INPUT_USD = 0.1;
const PRICE_PER_MTOK_OUTPUT_USD = 0.5;

// Per-user, per-day. Protects the single shared ANTHROPIC_API_KEY from a
// runaway bug or one user's abuse — this is the guard the double-send bug
// (fixed in a previous commit) should have had from day one. Only gates the
// LLM-conversation branch below, not confirm_action (a free DB write, no
// model call).
const DAILY_CAP_USD = 2.0;

// App-wide, per-day (migration 014): the per-user cap alone doesn't bound
// total spend while signup is open. Shared with the other Edge Function —
// both read the same agent_runs total.
const APP_DAILY_CAP_USD = 15.0;

// "Try it yourself" visitors (anonymous sessions, migration 016): a taste of
// the AI, not a free tier — a few questions each, and a hard ceiling for all
// of them together.
const DEMO_DAILY_CAP_USD = 0.1;
const DEMO_APP_DAILY_CAP_USD = 1.0;

// Google Places kosher search, approved budget $20/month (approvals #18). A
// Text Search Pro call is about $0.032, so 600 calls ≈ $19 even if the monthly
// free tier didn't exist. Counted as cost-0 agent_runs rows (kind below) so
// they don't eat the AI caps; the count itself is the cap. The per-user limit
// keeps one person from using up the month.
const GOOGLE_KOSHER_KIND = "google_kosher_search";
const GOOGLE_KOSHER_MONTHLY_CALLS = 600;
const GOOGLE_KOSHER_PER_USER_PER_DAY = 20;

/** Reserves one Google call against the caps; false = don't call Google. */
async function reserveGoogleCall(userId: string, tripId: string): Promise<boolean> {
  const db = adminDb();
  if (!db) return false;
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const [month, mine] = await Promise.all([
    db.from("agent_runs").select("id", { count: "exact", head: true }).eq("kind", GOOGLE_KOSHER_KIND).gte("created_at", monthStart),
    db.from("agent_runs").select("id", { count: "exact", head: true }).eq("kind", GOOGLE_KOSHER_KIND).eq("user_id", userId).gte("created_at", dayStart),
  ]);
  // A failed count is treated as "over": the cap must fail closed.
  if (month.error || mine.error) return false;
  if ((month.count ?? 0) >= GOOGLE_KOSHER_MONTHLY_CALLS || (mine.count ?? 0) >= GOOGLE_KOSHER_PER_USER_PER_DAY) return false;
  const { error } = await db.from("agent_runs").insert({ trip_id: tripId, user_id: userId, kind: GOOGLE_KOSHER_KIND, cost_usd: 0, status: "ok" });
  return !error;
}

/** True once the caller, the demo pool (for anonymous callers) or the whole app has hit today's cap. */
// deno-lint-ignore no-explicit-any
async function overDailyCap(supabase: any, isAnonymous: boolean): Promise<boolean> {
  const [mine, app, demo] = await Promise.all([
    supabase.rpc("my_agent_daily_cost_usd"),
    supabase.rpc("app_agent_daily_cost_usd"),
    isAnonymous ? supabase.rpc("anon_agent_daily_cost_usd") : Promise.resolve({ data: 0 }),
  ]);
  if ((app.data ?? 0) >= APP_DAILY_CAP_USD) return true;
  if (isAnonymous) return (mine.data ?? 0) >= DEMO_DAILY_CAP_USD || (demo.data ?? 0) >= DEMO_APP_DAILY_CAP_USD;
  return (mine.data ?? 0) >= DAILY_CAP_USD;
}

// Service-role client for agent_runs writes, which users can't do themselves (018).
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

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Turn = { role: "user" | "assistant"; content: string };
type PendingAction = { tool: "add_to_itinerary" | "add_suggestion"; id: string; input: Record<string, unknown> };

type Body = {
  trip_id: string;
  message?: string;
  history?: Turn[];
  confirm_action?: PendingAction;
  /** Kosher places and Shabbat times for the screens (no model call). */
  kosher?: { city?: string; shabbat_only?: boolean };
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

/** Embeds one query string with Voyage AI. input_type "query" (vs
 *  "document", used when seeding — see evals/seed-knowledge.ts) applies
 *  Voyage's asymmetric retrieval prompt, which measurably improves match
 *  quality over embedding both sides the same way. */
async function embedQuery(voyageKey: string, text: string): Promise<{ embedding: number[]; tokens: number }> {
  const res = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${voyageKey}` },
    body: JSON.stringify({ input: text, model: VOYAGE_MODEL, input_type: "query", output_dimension: VOYAGE_DIMENSION }),
  });
  if (!res.ok) throw new Error(`voyage_failed: ${res.status} ${await res.text()}`);
  const payload = await res.json();
  return { embedding: payload.data[0].embedding, tokens: Number(payload.usage?.total_tokens ?? 0) };
}

type KnowledgeRow = {
  title: string;
  content: string;
  category: string;
  source_url: string;
  source_verified_on: string;
};

/**
 * The curated layer for one of the 3 covered cities. With a question and a
 * Voyage key: semantic search, where match_knowledge_chunks drops matches
 * under its similarity floor (cosine similarity always returns *something*,
 * so without it an uncovered topic would surface an irrelevant chunk). With
 * no question (the Suggestions screen) or no key: that city's kosher and
 * Chabad items, read with the service role (the table has no user grants).
 */
async function curatedLayer(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  voyageKey: string | undefined,
  slug: string,
  query: string,
): Promise<{ items: CuratedItem[]; tokens: number }> {
  try {
    if (voyageKey && query) {
      const { embedding, tokens } = await embedQuery(voyageKey, query);
      const { data, error } = await supabase.rpc("match_knowledge_chunks", {
        query_embedding: embedding,
        filter_destination: slug,
        match_count: 4,
      });
      if (error) throw error;
      return { items: ((data ?? []) as KnowledgeRow[]).map(toCuratedItem), tokens };
    }
    const { data } = (await adminDb()
      ?.from("knowledge_chunks")
      .select("title, content, category, source_url, source_verified_on")
      .eq("destination", slug)
      .in("category", ["kosher", "chabad"])
      .order("category")) ?? { data: [] };
    return { items: ((data ?? []) as KnowledgeRow[]).map(toCuratedItem), tokens: 0 };
  } catch (e) {
    console.error("curated kosher lookup failed", e);
    return { items: [], tokens: 0 };
  }
}

type GoogleStatus = "used" | "no_key" | "cap" | "demo" | "failed" | "skipped";

type KosherLookup = {
  /** Where we searched: the trip destination, or the city the agent asked about. */
  place: string;
  point: { lat: number; lng: number; label: string } | null;
  /** Geocoded to a whole country/large region — no live search around it. */
  too_wide: boolean;
  curated: CuratedItem[];
  places: KosherPlace[];
  synagogues: KosherPlace[];
  shabbat: ShabbatInfo | null;
  google: GoogleStatus;
  osm_failed: boolean;
  search_links: { kosher: string; chabad: string };
  voyage_tokens: number;
  translate_cost_usd: number;
  /** Where the coordinates came from, for the agent_runs diag line. */
  geo: string;
};

/**
 * One kosher lookup, shared by the agent's find_kosher tool and the
 * no-model `kosher` request. Every source fails soft: a down service only
 * shrinks the answer, it never fails the request.
 */
async function kosherLookup(opts: {
  // deno-lint-ignore no-explicit-any
  supabase: any;
  apiKey: string;
  voyageKey: string | undefined;
  trip: { id: string; destination: string; start_date: string | null; end_date: string | null };
  userId: string;
  isAnonymous: boolean;
  city: string;
  query: string;
  wantPlaces: boolean;
  wantShabbat: boolean;
}): Promise<KosherLookup> {
  const place = (opts.city || opts.trip.destination || "").trim().slice(0, 200);
  const db = adminDb();
  const result: KosherLookup = {
    place,
    point: null,
    too_wide: false,
    curated: [],
    places: [],
    synagogues: [],
    shabbat: null,
    google: "skipped",
    osm_failed: false,
    search_links: {
      kosher: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`kosher restaurant ${place}`)}`,
      chabad: `https://www.chabad.org/centers/default_cdo/jewish/directory.htm?searchQuery=${encodeURIComponent(place)}`,
    },
    voyage_tokens: 0,
    translate_cost_usd: 0,
    geo: "none",
  };
  const googleKey = Deno.env.get("GOOGLE_PLACES_API_KEY");

  // Hebrew destination Nominatim can't read → one short model call, at most
  // once per destination (geocodeDestination caches hits and misses).
  const translate = async (q: string): Promise<string> => {
    if (await overDailyCap(opts.supabase, opts.isAnonymous)) return q;
    try {
      const res = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": opts.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 40,
          messages: [{
            role: "user",
            content: `Translate this Hebrew travel destination to its English place name, as you would type it into a map search (e.g. "Milan, Italy"). Reply with the name only: "${q}"`,
          }],
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return q;
      const payload = await res.json();
      const usage = payload?.usage ?? {};
      result.translate_cost_usd +=
        (Number(usage.input_tokens ?? 0) / 1_000_000) * PRICE_PER_MTOK_INPUT_USD +
        (Number(usage.output_tokens ?? 0) / 1_000_000) * PRICE_PER_MTOK_OUTPUT_USD;
      const text = (payload?.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join(" ");
      return text.split("\n")[0].replace(/["׳״]/g, "").trim().slice(0, 100) || q;
    } catch {
      return q;
    }
  };

  // Google as the geocoder of last resort — budget-counted, never for demo visitors.
  const geocodeFallback = googleKey && !opts.isAnonymous
    ? async (q: string) => ((await reserveGoogleCall(opts.userId, opts.trip.id)) ? googleGeocode(googleKey, q) : null)
    : undefined;

  const slug = matchKnowledgeDestination(place);
  const [curated, geocoded] = await Promise.all([
    slug && opts.wantPlaces ? curatedLayer(opts.supabase, opts.voyageKey, slug, opts.query) : Promise.resolve({ items: [], tokens: 0 }),
    geocodeDestination(db, place, translate, geocodeFallback),
  ]);
  result.curated = curated.items;
  result.voyage_tokens = curated.tokens;
  result.geo = geocoded.error ? `${geocoded.via} (${geocoded.error})` : geocoded.via;
  const point = geocoded.point;
  if (!point) return result;
  result.point = { lat: point.lat, lng: point.lng, label: point.label };

  if (opts.wantShabbat && opts.trip.start_date && opts.trip.end_date) {
    result.shabbat = await shabbatTimes(db, point.lat, point.lng, opts.trip.start_date, opts.trip.end_date);
  }
  if (!opts.wantPlaces) return result;
  if (isTooWide(point)) {
    result.too_wide = true;
    return result;
  }

  const radius = searchRadiusM(point);
  const googleSearch = async (): Promise<KosherPlace[]> => {
    if (!googleKey) {
      result.google = "no_key";
      return [];
    }
    // Demo visitors never spend Google quota (same rule as generate's place photos).
    if (opts.isAnonymous) {
      result.google = "demo";
      return [];
    }
    if (!(await reserveGoogleCall(opts.userId, opts.trip.id))) {
      result.google = "cap";
      return [];
    }
    try {
      const found = await searchGoogleKosher(googleKey, point.lat, point.lng, radius);
      result.google = "used";
      return found;
    } catch (e) {
      console.error("google kosher search failed", e);
      result.google = "failed";
      return [];
    }
  };
  const [osm, google] = await Promise.all([
    searchOsmKosher(db, point.lat, point.lng, radius).catch(() => {
      result.osm_failed = true;
      return [] as KosherPlace[];
    }),
    googleSearch(),
  ]);
  result.synagogues = mergePlaces(osm.filter((p) => p.kind === "synagogue"), []).slice(0, 5);
  result.places = mergePlaces(osm.filter((p) => p.kind !== "synagogue"), google);
  return result;
}

/** The find_kosher tool result: tiers spelled out so the model can't blur them. */
function kosherToolResult(k: KosherLookup): Record<string, unknown> {
  // The curated "shabbat" items are only links saying "no fixed time — check
  // Chabad". Next to real Hebcal times the model followed them and withheld
  // the times, so they're dropped whenever times were calculated.
  const curated = k.shabbat?.days.length ? k.curated.filter((c) => c.category !== "shabbat") : k.curated;
  const verified = curated.filter((c) => c.tier === "verified");
  const staleCurated = curated.filter((c) => c.tier === "unverified");
  const shabbat = k.shabbat?.days.length
    ? {
        source: k.shabbat.source_label,
        time_zone: k.shabbat.tzid,
        // On a restricted day (second night of yom tov, or yom tov after
        // Shabbat) the listed time is the earliest lighting, after nightfall and
        // from an existing flame — not the time Shabbat/yom tov begins.
        days: k.shabbat.days.map((d) => ({
          date: d.date,
          candle_lighting: d.candles && d.restricted
            ? `לא לפני ${d.candles} — אחרי צאת השבת/החג, מאש קיימת (זו לא שעת כניסה)`
            : d.candles,
          havdalah: d.havdalah,
          yom_tov: d.holiday,
        })),
        how_to_read:
          "שעת כניסת שבת/חג היא candle_lighting ביום שלפני היום המוגבל (ערב שבת או ערב חג). אם היום הראשון של הטיול כבר שבת או חג, הכניסה הייתה ביום שלפני הטיול — אמור זאת.",
      }
    : null;
  const hasAnything = verified.length || staleCurated.length || k.places.length || k.synagogues.length;

  return {
    searched_near: k.point?.label ?? k.place,
    coverage: verified.length ? "verified" : k.places.length || staleCurated.length ? "map_only" : "none",
    verified_items: verified.map((c) => ({
      tier: c.tier, label: c.label, title: c.title, content: c.content,
      source_url: c.source_url, source_verified_on: c.source_verified_on,
    })),
    unverified_items: [
      ...staleCurated.map((c) => ({ tier: c.tier, label: c.label, title: c.title, content: c.content, source_url: c.source_url })),
      ...k.places.map((p) => ({
        tier: p.tier,
        label: TIER_LABEL.unverified,
        name: p.name,
        type: p.kind,
        address: p.address,
        distance_km_from_center: p.distance_km,
        source: p.source_label,
        map_tag: p.osm_diet === "only" ? "kosher only" : p.osm_diet === "yes" ? "has kosher options" : null,
        map_checked_on: p.checked_on,
      })),
    ],
    synagogues: k.synagogues.map((s) => ({ name: s.name, address: s.address, source: s.source_label })),
    shabbat_times: shabbat,
    ...(k.too_wide
      ? { needs_city: `"${k.place}" הוא מדינה או אזור גדול מדי לחיפוש. שאל את המשתמש באיזו עיר, וקרא שוב לכלי עם city.` }
      : {}),
    ...(!k.point && !curated.length ? { needs_city: `לא הצלחתי לאתר את "${k.place}" במפה. שאל את המשתמש באיזו עיר מדובר.` } : {}),
    // A source that was down is "couldn't check", not "nothing there".
    ...(k.osm_failed
      ? { lookup_error: "חיפוש המפה לא היה זמין כרגע. אמור שלא ניתן היה לבדוק עכשיו (לא שאין מקומות), והפנה לחיפוש החי ולבית חב״ד." }
      : {}),
    ...(!hasAnything && !k.osm_failed && k.point && !k.too_wide
      ? { no_info: `${TIER_LABEL.none}: לא נמצאו מקומות כשרים מסומנים ליד ${k.place}. אל תמציא שמות — הפנה לחיפוש החי ולבית חב״ד.` }
      : {}),
    search_links: k.search_links,
    instruction:
      "נסח לפי רמת האמינות (tier/label) של כל פריט, בלי להעלות רמה. verified: ציין מקור ותאריך בדיקה. unverified: כתוב ליד כל מקום \"נמצא במפה — לא מאומת, יש לוודא השגחה\", ולעולם אל תכתוב שהוא כשר. אם יש shabbat_times ונשאלת על שבת או חג — מסור את השעות עצמן לפי התאריכים (הדלקת נרות והבדלה), וציין שהן חישוב אוטומטי של Hebcal שיש לבדוק מול בית חב״ד או רב מקומי. אם אין מידע — אמור \"אין מידע\" והצע את search_links.",
  };
}

function mapUrlFor(location: unknown, destination: string): string | null {
  const loc = typeof location === "string" ? location.trim() : "";
  if (!loc) return null;
  const q = [loc, destination].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // Estimated usage row held while the model runs, so parallel questions count
  // against the caps in flight (see generate/index.ts). logRun replaces it with
  // the real row; finally deletes it if no model call happened.
  let reservation: string | null = null;

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY is not set" }, 500);
    // Missing is tolerated (find_kosher just skips the curated semantic search
    // — see curatedLayer) rather than failing the whole request: kashrut
    // lookup is one tool among several, not core to the agent working at all.
    const voyageKey = Deno.env.get("VOYAGE_API_KEY");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);

    // Client bound to the caller's JWT → RLS enforced on every read and write.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const body = (await req.json()) as Body;

    // Role check, shared by the branches below (migration 015). Viewers can
    // read the trip but not use the agent; RLS would also refuse their writes,
    // but checking here keeps them from spending the API budget at all. The
    // kosher lookup is read-only trip information, so viewers get it too.
    const [{ data: auth }, { data: trip }, { data: role }] = await Promise.all([
      supabase.auth.getUser(),
      supabase
        .from("trips")
        .select("id, user_id, destination, trip_type, budget_level, start_date, end_date, notes")
        .eq("id", body.trip_id)
        .maybeSingle(),
      supabase.rpc("trip_role", { _trip_id: body.trip_id }),
    ]);
    const allowedRoles = body.kosher ? ["owner", "editor", "participant", "viewer"] : ["owner", "editor", "participant"];
    if (!auth?.user || !trip || !allowedRoles.includes(role)) {
      return json({ error: "forbidden" }, 403);
    }
    const canEditItinerary = role === "owner" || role === "editor";
    const isAnonymous = auth.user.is_anonymous === true;

    const logRun = async (fields: {
      kind: string;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      latencyMs: number;
      status: "ok" | "error";
      errorMessage?: string;
    }) => {
      try {
        // Service role only (migration 018): users can't write usage rows, or a
        // fake cost could fill the app-wide cap and switch AI off for everyone.
        const row = {
          trip_id: body.trip_id,
          user_id: auth.user.id,
          kind: fields.kind,
          input_tokens: fields.inputTokens,
          output_tokens: fields.outputTokens,
          cost_usd: fields.costUsd,
          latency_ms: fields.latencyMs,
          status: fields.status,
          error_message: fields.errorMessage?.slice(0, 500) ?? null,
        };
        if (reservation && fields.kind === "ask") {
          const id = reservation;
          reservation = null;
          await adminDb()?.from("agent_runs").update(row).eq("id", id);
        } else {
          await adminDb()?.from("agent_runs").insert(row);
        }
      } catch {
        // Monitoring must never break the chat response.
      }
    };

    // --- Branch 0: kosher places / Shabbat times for the screens, no model ----
    // Google is only searched when places are asked for (a button press on the
    // Suggestions screen), never for the Itinerary's Shabbat line.
    if (body.kosher) {
      const k = await kosherLookup({
        supabase,
        apiKey,
        voyageKey,
        trip,
        userId: auth.user.id,
        isAnonymous,
        city: typeof body.kosher.city === "string" ? body.kosher.city : "",
        query: "",
        wantPlaces: !body.kosher.shabbat_only,
        wantShabbat: true,
      });
      if (k.translate_cost_usd > 0) {
        await logRun({ kind: "kosher_geocode_translate", inputTokens: 0, outputTokens: 0, costUsd: k.translate_cost_usd, latencyMs: 0, status: "ok" });
      }
      return json({
        ok: true,
        place: k.place,
        point: k.point,
        too_wide: k.too_wide,
        curated: k.curated,
        places: k.places,
        synagogues: k.synagogues,
        shabbat: k.shabbat,
        google: k.google,
        osm_failed: k.osm_failed,
        search_links: k.search_links,
      });
    }

    // --- Branch 1: confirm and execute a previously proposed tool call ------
    // A second, separate request from the client, made only after the user
    // clicks "approve" on the card. Re-checking ownership above (not just
    // trusting the client) is what makes this branch, not the tool-use loop
    // below, the actual security boundary for the write.
    if (body.confirm_action) {
      const action = body.confirm_action;
      const start = Date.now();
      try {
        if (action.tool === "add_to_itinerary") {
          if (!canEditItinerary) return json({ error: "forbidden" }, 403);
          const dayDate = String(action.input.day_date ?? "");
          const title = String(action.input.title ?? "").trim().slice(0, 300);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dayDate) || !title) {
            return json({ error: "invalid_input" }, 400);
          }
          const location = action.input.location;
          const { error } = await supabase.from("itinerary_items").insert({
            trip_id: body.trip_id,
            day_date: dayDate,
            start_time: action.input.start_time ? String(action.input.start_time) : null,
            title,
            description: action.input.description ? String(action.input.description).slice(0, 800) : null,
            category: ["activity", "food", "transport", "flight", "hotel", "free"].includes(String(action.input.category))
              ? String(action.input.category)
              : "activity",
            location: typeof location === "string" ? location.slice(0, 300) : null,
            map_url: mapUrlFor(location, trip.destination),
          });
          if (error) throw error;
        } else if (action.tool === "add_suggestion") {
          const title = String(action.input.title ?? "").trim().slice(0, 300);
          if (!title) return json({ error: "invalid_input" }, 400);
          const location = action.input.location;
          const { error } = await supabase.from("suggestions").insert({
            trip_id: body.trip_id,
            kind: ["attraction", "restaurant", "tip", "gear"].includes(String(action.input.kind))
              ? String(action.input.kind)
              : "attraction",
            title,
            description: action.input.description ? String(action.input.description).slice(0, 800) : null,
            tags: Array.isArray(action.input.tags) ? (action.input.tags as unknown[]).map(String).slice(0, 8) : [],
            price_level: ["low", "mid", "high"].includes(String(action.input.price_level))
              ? String(action.input.price_level)
              : null,
            location: typeof location === "string" ? location.slice(0, 300) : null,
            map_url: mapUrlFor(location, trip.destination),
          });
          if (error) throw error;
        } else {
          return json({ error: "unknown_tool" }, 400);
        }

        await logRun({
          kind: `tool_${action.tool}_confirmed`,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          latencyMs: Date.now() - start,
          status: "ok",
        });
        return json({ ok: true });
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : "unknown";
        await logRun({
          kind: `tool_${action.tool}_confirmed`,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          latencyMs: Date.now() - start,
          status: "error",
          errorMessage,
        });
        return json({ error: "write_failed" }, 500);
      }
    }

    // --- Branch 2: conversation turn (may call tools) ------------------------
    const message = (body.message ?? "").trim();
    if (!message) return json({ error: "empty_message" }, 400);

    if (await overDailyCap(supabase, isAnonymous)) {
      return json({ error: "daily_cap_reached" }, 429);
    }
    // Held estimate (about 4x the measured average question) until the real cost is logged.
    const { data: held } = (await adminDb()
      ?.from("agent_runs")
      .insert({ trip_id: body.trip_id, user_id: auth.user.id, kind: "ask", cost_usd: 0.02, status: "pending" })
      .select("id")
      .single()) ?? { data: null };
    if (held) reservation = (held as { id: string }).id;

    const [participants, itinerary, stays, flights, suggestions, checklist] = await Promise.all([
      supabase.from("participants").select("name, age, age_range, preferences").eq("trip_id", body.trip_id),
      supabase
        .from("itinerary_items")
        .select("day_date, start_time, title")
        .eq("trip_id", body.trip_id)
        .order("day_date")
        .order("sort_order"),
      supabase.from("stays").select("hotel_name, address, check_in, check_out").eq("trip_id", body.trip_id),
      supabase.from("flights").select("direction, from_airport, to_airport, depart_at").eq("trip_id", body.trip_id),
      supabase.from("suggestions").select("title").eq("trip_id", body.trip_id),
      supabase
        .from("checklist_items")
        .select("id", { count: "exact", head: true })
        .eq("trip_id", body.trip_id)
        .eq("is_done", false),
    ]);

    const snapshot = buildSnapshot(
      trip,
      (participants.data as Participant[]) ?? [],
      (itinerary.data as Record<string, unknown>[]) ?? [],
      (stays.data as Record<string, unknown>[]) ?? [],
      (flights.data as Record<string, unknown>[]) ?? [],
      (suggestions.data as Record<string, unknown>[]) ?? [],
      checklist.count ?? 0,
    );

    const history = (body.history ?? [])
      .filter((t) => (t.role === "user" || t.role === "assistant") && t.content?.trim())
      .slice(-MAX_HISTORY)
      .map((t) => ({ role: t.role, content: t.content }));

    // deno-lint-ignore no-explicit-any
    const convo: any[] = [...history, { role: "user", content: message }];
    const pendingActions: PendingAction[] = [];
    let finalAnswer = "";
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const runStart = Date.now();
    let llmError: string | null = null;

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const llm = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 2000,
          // The snapshot is stable for the whole conversation, so cache it: on
          // follow-up turns the cached prefix costs ~10%. Snapshots shorter than
          // the minimum cacheable prefix simply won't cache — that is harmless.
          system: [
            {
              type: "text",
              text: `${INSTRUCTIONS}\n\n--- פרטי הטיול ---\n${snapshot}`,
              cache_control: { type: "ephemeral" },
            },
          ],
          // Participants can't write the itinerary, so the agent isn't offered
          // a card they could never approve.
          tools: canEditItinerary ? TOOLS : TOOLS.filter((t) => t.name !== "add_to_itinerary"),
          messages: convo,
        }),
      });

      if (!llm.ok) {
        llmError = await llm.text();
        break;
      }

      const payload = await llm.json();
      const usage = payload?.usage ?? {};
      totalInputTokens += Number(usage.input_tokens ?? 0);
      totalOutputTokens += Number(usage.output_tokens ?? 0);

      // deno-lint-ignore no-explicit-any
      const content: any[] = Array.isArray(payload?.content) ? payload.content : [];
      const textBlock = content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (textBlock) finalAnswer = textBlock;

      const toolUseBlocks = content.filter((b) => b.type === "tool_use");
      if (payload?.stop_reason !== "tool_use" || toolUseBlocks.length === 0) break;

      convo.push({ role: "assistant", content });
      // deno-lint-ignore no-explicit-any
      const toolResults: any[] = [];

      for (const block of toolUseBlocks) {
        const input = (block.input ?? {}) as Record<string, unknown>;
        if (block.name === "find_kosher") {
          const toolStart = Date.now();
          const k = await kosherLookup({
            supabase,
            apiKey,
            voyageKey,
            trip,
            userId: auth.user.id,
            isAnonymous,
            city: typeof input.city === "string" ? input.city : "",
            query: String(input.query ?? "").trim().slice(0, 500),
            wantPlaces: true,
            wantShabbat: true,
          });
          await logRun({
            kind: "tool_find_kosher",
            inputTokens: k.voyage_tokens,
            outputTokens: 0,
            costUsd: (k.voyage_tokens / 1_000_000) * VOYAGE_PRICE_PER_MTOK_USD + k.translate_cost_usd,
            latencyMs: Date.now() - toolStart,
            status: "ok",
            errorMessage: `diag: geo=${k.geo} shabbat=${k.shabbat?.days.length ?? "none"} google=${k.google} osm=${k.osm_failed ? "failed" : k.places.length} curated=${k.curated.length}`,
          });
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(kosherToolResult(k)) });
        } else if (block.name === "add_to_itinerary" || block.name === "add_suggestion") {
          pendingActions.push({ tool: block.name, id: block.id, input });
          await logRun({
            kind: `tool_${block.name}`,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            latencyMs: 0,
            status: "ok",
          });
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify({ status: "queued_for_user_approval" }),
          });
        } else {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify({ error: "unknown_tool" }),
            is_error: true,
          });
        }
      }
      convo.push({ role: "user", content: toolResults });
    }

    const latencyMs = Date.now() - runStart;
    const costUsd =
      (totalInputTokens / 1_000_000) * PRICE_PER_MTOK_INPUT_USD + (totalOutputTokens / 1_000_000) * PRICE_PER_MTOK_OUTPUT_USD;

    if (llmError) {
      await logRun({ kind: "ask", inputTokens: totalInputTokens, outputTokens: totalOutputTokens, costUsd, latencyMs, status: "error", errorMessage: llmError });
      return json({ error: "llm_failed", detail: llmError }, 502);
    }

    if (!finalAnswer) {
      await logRun({ kind: "ask", inputTokens: totalInputTokens, outputTokens: totalOutputTokens, costUsd, latencyMs, status: "error", errorMessage: "no_final_answer" });
      finalAnswer = "לא הצלחתי לגבש תשובה הפעם. נסה לנסח את השאלה אחרת.";
    } else {
      await logRun({ kind: "ask", inputTokens: totalInputTokens, outputTokens: totalOutputTokens, costUsd, latencyMs, status: "ok" });
    }

    return json({ ok: true, answer: finalAnswer, cards: [], pendingActions });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  } finally {
    if (reservation) await adminDb()?.from("agent_runs").delete().eq("id", reservation);
  }
});
