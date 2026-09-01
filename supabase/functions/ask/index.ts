/**
 * TripCraft agent — Supabase Edge Function (Deno).
 *
 * Answers free-form Hebrew questions about one trip, and may return a few
 * recommendation cards the client can add to the trip with one tap.
 *
 * Owner-only. Writes nothing: the caller persists both turns into
 * `trip_chat_messages` itself (same shape as the `passports` kind in
 * ../generate/index.ts, which also returns parsed items and writes nothing).
 *
 * Deploy:
 *   supabase functions deploy ask
 *   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = "claude-haiku-4-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

/** How many past turns of the conversation we replay to the model. */
const MAX_HISTORY = 12;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Turn = { role: "user" | "assistant"; content: string };

type Body = {
  trip_id: string;
  message: string;
  history?: Turn[];
};

type Participant = {
  name: string;
  age: number | null;
  age_range: string | null;
  preferences: string[] | null;
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
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

function extractJson(text: string): Record<string, unknown> | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Compact Hebrew snapshot of the trip, used as the agent's system context. */
function buildSnapshot(
  trip: Record<string, unknown>,
  participants: Participant[],
  itinerary: Record<string, unknown>[],
  stays: Record<string, unknown>[],
  flights: Record<string, unknown>[],
  suggestions: Record<string, unknown>[],
  checklistOpen: number,
): string {
  const lines: string[] = [];

  lines.push(`יעד: ${trip.destination}`);
  lines.push(`סוג טיול: ${trip.trip_type}`);
  lines.push(`תקציב: ${trip.budget_level ?? "לא צוין"}`);
  lines.push(`תאריכים: ${trip.start_date ?? "?"} עד ${trip.end_date ?? "?"}`);
  if (trip.notes) lines.push(`הערות הבעלים: ${trip.notes}`);

  lines.push("", "משתתפים:", describeParticipants(participants));

  if (stays.length) {
    lines.push("", "לינה:");
    for (const s of stays) {
      const where = s.address ? ` — ${s.address}` : "";
      lines.push(`- ${s.hotel_name}${where} (${s.check_in ?? "?"} עד ${s.check_out ?? "?"})`);
    }
  }

  if (flights.length) {
    lines.push("", "טיסות:");
    for (const f of flights) {
      lines.push(
        `- ${f.direction === "inbound" ? "חזור" : "הלוך"}: ${f.from_airport ?? "?"} → ${f.to_airport ?? "?"}` +
          `${f.depart_at ? ` ביציאה ${f.depart_at}` : ""}`,
      );
    }
  }

  if (itinerary.length) {
    lines.push("", "המסלול הקיים:");
    for (const i of itinerary) {
      lines.push(`- ${i.day_date}${i.start_time ? ` ${String(i.start_time).slice(0, 5)}` : ""}: ${i.title}`);
    }
  }

  if (suggestions.length) {
    lines.push("", "המלצות שכבר נשמרו (אל תציע אותן שוב):");
    lines.push(suggestions.map((s) => s.title).join(", "));
  }

  if (checklistOpen > 0) lines.push("", `בצ'קליסט נותרו ${checklistOpen} פריטים פתוחים.`);

  return lines.join("\n");
}

const INSTRUCTIONS = `אתה סוכן נסיעות ישראלי שמלווה משפחה בטיול ספציפי. אתה עונה בעברית בלבד, בגוף שני, בטון חברי וענייני.

כללים:
- ענה תמיד בהקשר של הטיול שמתואר למטה — היעד, התאריכים, המשתתפים והגילאים שלהם.
- אם צוינה כשרות או צמחונות אצל מישהו מהמשתתפים, התייחס לזה בכל המלצה על אוכל.
- תשובה קצרה וקונקרטית. 2-5 משפטים, בלי הקדמות ובלי "אשמח לעזור".
- מקומות אמיתיים בלבד. אם אתה לא בטוח שמקום קיים או פתוח — אמור זאת במפורש במקום להמציא.
- אין לך גישה לאינטרנט ולא למחירים או שעות פתיחה עדכניים. אל תמציא מחיר, שעה או כתובת מדויקת.
- אל תציע מחדש מקומות שכבר מופיעים ברשימת ההמלצות השמורות.

החזר JSON בלבד, ללא טקסט לפניו או אחריו, במבנה:
{"answer":"התשובה בעברית","cards":[{"kind":"attraction|restaurant|tip|gear","title":"שם המקום בעברית","description":"למה זה מתאים למשתתפים, משפט או שניים","tags":["תג"],"price_level":"low|mid|high","location":"שם המקום לחיפוש במפות"}]}

על cards:
- רק כשהשאלה באמת מבקשת המלצות על מקומות או פעילויות. לשאלה כללית ("מה כדאי לארוז?") החזר cards ריק וענה ב-answer.
- לכל היותר 5 כרטיסים, ורק כאלה שהמשתמש יכול להוסיף לטיול.
- אל תחזור על תוכן הכרטיסים בתוך answer — שם רק הסבר קצר או המלצה מה לבחור.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY is not set" }, 500);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);

    // Client bound to the caller's JWT → RLS enforced on every read.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const body = (await req.json()) as Body;
    const message = (body.message ?? "").trim();
    if (!message) return json({ error: "empty_message" }, 400);

    // Ownership check. Comparing user_id explicitly is required, not decorative:
    // the "shared trips readable" policy also applies to `authenticated`, so a
    // plain select by id succeeds for anyone's shared trip. This function writes
    // nothing, so RLS on a later insert would not catch it — without this check
    // any signed-in user could spend the project's API budget on someone else's
    // shared trip.
    const [{ data: auth }, { data: trip }] = await Promise.all([
      supabase.auth.getUser(),
      supabase
        .from("trips")
        .select("id, user_id, destination, trip_type, budget_level, start_date, end_date, notes")
        .eq("id", body.trip_id)
        .maybeSingle(),
    ]);
    if (!auth?.user || !trip || trip.user_id !== auth.user.id) {
      return json({ error: "forbidden" }, 403);
    }

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
        messages: [...history, { role: "user", content: message }],
      }),
    });

    if (!llm.ok) {
      const detail = await llm.text();
      return json({ error: "llm_failed", detail }, 502);
    }

    const payload = await llm.json();
    const text: string = payload?.content?.[0]?.text ?? "";

    // Soft fallback: a malformed JSON reply still becomes a usable answer rather
    // than an error the user sees. The chat must never break on parsing.
    const parsed = extractJson(text);
    const answer = typeof parsed?.answer === "string" && parsed.answer.trim() ? parsed.answer.trim() : text.trim();
    if (!answer) return json({ error: "empty_answer" }, 502);

    const rawCards = Array.isArray(parsed?.cards) ? (parsed.cards as unknown[]) : [];
    const cards = rawCards
      .slice(0, 5)
      .map((raw) => {
        const c = raw as Record<string, unknown>;
        return {
          kind: ["attraction", "restaurant", "tip", "gear"].includes(String(c.kind))
            ? String(c.kind)
            : "attraction",
          title: String(c.title ?? "").trim().slice(0, 300),
          description: c.description ? String(c.description).slice(0, 800) : null,
          tags: Array.isArray(c.tags) ? (c.tags as unknown[]).map(String).slice(0, 8) : [],
          price_level: ["low", "mid", "high"].includes(String(c.price_level)) ? String(c.price_level) : null,
          location: c.location ? String(c.location).slice(0, 300) : null,
        };
      })
      .filter((c) => c.title);

    return json({ ok: true, answer, cards });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
