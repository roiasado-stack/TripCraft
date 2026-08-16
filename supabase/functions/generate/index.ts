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

const MODEL = "claude-sonnet-4-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

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

type Body = {
  trip_id: string;
  kind: "suggestions" | "itinerary" | "checklist";
  tune?: string | null;
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

function buildPrompt(body: Body): string {
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
    return `${context}

צור המלצות מותאמות אישית לטיול הזה. החזר JSON בלבד, ללא טקסט נוסף, במבנה:
{"items":[{"kind":"attraction|restaurant|tip","title":"שם בעברית","description":"תיאור קצר בעברית (1-2 משפטים) כולל למה זה מתאים למשתתפים","tags":["תג1","תג2"],"age_min":0,"age_max":99,"price_level":"low|mid|high"}]}

דרישות:
- 8 אטרקציות, 6 מסעדות, 4 טיפים מקומיים.
- התאם לגילאים ולהעדפות שצוינו. אם יש ילדים קטנים — הוסף אפשרויות מתאימות.
- אם צוין כשרות/צמחונות — התייחס לכך במסעדות.
- מקומות אמיתיים וידועים ב${trip.destination}. כל הטקסט בעברית.`;
  }

  if (kind === "itinerary") {
    const dayList = days.length ? days.join(", ") : "צור 3 ימים לדוגמה";
    return `${context}

צור מסלול יומי מוצע. הימים: ${dayList}
החזר JSON בלבד במבנה:
{"items":[{"day_date":"YYYY-MM-DD","start_time":"HH:MM","title":"שם הפעילות בעברית","description":"פרטים קצרים","category":"activity|food|transport|free","location":"שם מקום"}]}

דרישות:
- 3-5 פריטים לכל יום, בסדר הגיוני לפי שעות (בוקר/צהריים/ערב).
- התאם לקצב המשתתפים (ילדים/מבוגרים) ולהעדפות.
- day_date חייב להיות אחד מהתאריכים שצוינו. כל הטקסט בעברית.`;
  }

  return `${context}

צור רשימת ציוד/צ'קליסט מותאמת לטיול הזה. החזר JSON בלבד במבנה:
{"items":[{"title":"שם הפריט בעברית","is_shared":true}]}

דרישות:
- 15-25 פריטים. is_shared=true לפריטים משותפים למשפחה, false לפריטים אישיים.
- התאם למשתתפים (תינוקות/ילדים), ליעד, לעונה ולהעדפות. כל הטקסט בעברית.`;
}

function extractJson(text: string): { items?: unknown[] } | null {
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

    const body = (await req.json()) as Body;

    // Verify the caller actually owns this trip before generating anything.
    const { data: trip, error: tripErr } = await supabase
      .from("trips")
      .select("id")
      .eq("id", body.trip_id)
      .maybeSingle();
    if (tripErr || !trip) {
      return new Response(JSON.stringify({ error: "trip not found" }), {
        status: 404,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const llm = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        messages: [{ role: "user", content: buildPrompt(body) }],
      }),
    });

    if (!llm.ok) {
      const detail = await llm.text();
      return new Response(JSON.stringify({ error: "llm_failed", detail }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const payload = await llm.json();
    const text: string = payload?.content?.[0]?.text ?? "";
    const parsed = extractJson(text);
    const items = Array.isArray(parsed?.items) ? parsed!.items : [];
    if (items.length === 0) {
      return new Response(JSON.stringify({ error: "no_items", inserted: 0 }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    let inserted = 0;

    if (body.kind === "suggestions") {
      const rows = items.map((raw) => {
        const i = raw as Record<string, unknown>;
        return {
          trip_id: body.trip_id,
          kind: ["attraction", "restaurant", "tip", "gear"].includes(String(i.kind)) ? String(i.kind) : "attraction",
          title: String(i.title ?? "").slice(0, 300),
          description: i.description ? String(i.description) : null,
          tags: Array.isArray(i.tags) ? (i.tags as unknown[]).map(String).slice(0, 8) : [],
          age_min: typeof i.age_min === "number" ? i.age_min : null,
          age_max: typeof i.age_max === "number" ? i.age_max : null,
          price_level: i.price_level ? String(i.price_level) : null,
        };
      }).filter((r) => r.title);
      const { error } = await supabase.from("suggestions").insert(rows);
      if (error) throw error;
      inserted = rows.length;
    } else if (body.kind === "itinerary") {
      const rows = items.map((raw, idx) => {
        const i = raw as Record<string, unknown>;
        return {
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
        };
      }).filter((r) => r.title && /^\d{4}-\d{2}-\d{2}$/.test(r.day_date));
      const { error } = await supabase.from("itinerary_items").insert(rows);
      if (error) throw error;
      inserted = rows.length;
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
