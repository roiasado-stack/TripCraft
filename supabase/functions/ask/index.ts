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
 * Deploy:
 *   supabase functions deploy ask
 *   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 *   supabase secrets set VOYAGE_API_KEY=pa-...
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { ANTHROPIC_URL, buildSnapshot, INSTRUCTIONS, matchKnowledgeDestination, MODEL, TOOLS, type Participant } from "./prompt.ts";

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

// claude-haiku-4-5 pricing (Anthropic API). Update alongside evals/run.ts's
// copy of the same numbers if pricing changes — they're two different
// runtimes (Deno vs Node) so this isn't shared as one constant.
const PRICE_PER_MTOK_INPUT_USD = 1.0;
const PRICE_PER_MTOK_OUTPUT_USD = 5.0;

// Per-user, per-day. Protects the single shared ANTHROPIC_API_KEY from a
// runaway bug or one user's abuse — this is the guard the double-send bug
// (fixed in a previous commit) should have had from day one. Only gates the
// LLM-conversation branch below, not confirm_action (a free DB write, no
// model call).
const DAILY_CAP_USD = 2.0;

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
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const NOT_COVERED = {
  available: false,
  message: "אין מקור ידע מאומת ליעד הזה במערכת (המאגר מכסה כרגע רק קפריסין, רומא ובאטומי). אל תנחש — אמור זאת למשתמש במפורש.",
};

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

type KnowledgeMatch = {
  title: string;
  content: string;
  category: string;
  source_url: string;
  source_verified_on: string;
  similarity: number;
};

/**
 * Semantic search over the 3-destination knowledge base. Two gates before a
 * result counts as "found," both required by the brief: the destination
 * itself must be covered (checked before this even runs — see the call
 * site), and matches below min_similarity are filtered server-side inside
 * match_knowledge_chunks — cosine similarity always returns *something*, so
 * without that floor an uncovered topic within a covered destination would
 * still surface an irrelevant chunk instead of an honest "not found."
 */
async function handleFindKosher(
  supabase: ReturnType<typeof createClient>,
  voyageKey: string | undefined,
  tripDestination: string,
  input: Record<string, unknown>,
): Promise<{ result: Record<string, unknown>; tokens: number }> {
  const destinationSlug = matchKnowledgeDestination(tripDestination);
  if (!destinationSlug) return { result: NOT_COVERED, tokens: 0 };
  if (!voyageKey) return { result: NOT_COVERED, tokens: 0 };

  const query = String(input.query ?? "").trim();
  if (!query) return { result: NOT_COVERED, tokens: 0 };

  try {
    const { embedding, tokens } = await embedQuery(voyageKey, query);
    const { data, error } = await supabase.rpc("match_knowledge_chunks", {
      query_embedding: embedding,
      filter_destination: destinationSlug,
      match_count: 4,
    });
    if (error) throw error;

    const matches = (data ?? []) as KnowledgeMatch[];
    if (!matches.length) return { result: NOT_COVERED, tokens };

    return {
      result: {
        available: true,
        results: matches.map((m) => ({
          title: m.title,
          content: m.content,
          source_url: m.source_url,
          source_verified_on: m.source_verified_on,
        })),
        instruction: "צטט את המקור (source_url) ואת תאריך האימות (source_verified_on) בתשובה למשתמש.",
      },
      tokens,
    };
  } catch {
    return { result: NOT_COVERED, tokens: 0 };
  }
}

function mapUrlFor(location: unknown, destination: string): string | null {
  const loc = typeof location === "string" ? location.trim() : "";
  if (!loc) return null;
  const q = [loc, destination].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY is not set" }, 500);
    // Missing is tolerated (find_kosher just returns "not covered" — see
    // handleFindKosher) rather than failing the whole request: kashrut
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

    // Ownership check, shared by both branches below. Comparing user_id
    // explicitly is required, not decorative: the "shared trips readable"
    // policy also applies to `authenticated`, so a plain select by id
    // succeeds for anyone's shared trip — without this check any signed-in
    // user could spend the project's API budget, or write itinerary/
    // suggestion rows, on someone else's shared trip.
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
        await supabase.from("agent_runs").insert({
          trip_id: body.trip_id,
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
        // Monitoring must never break the chat response.
      }
    };

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

    const { data: spentToday } = await supabase.rpc("my_agent_daily_cost_usd");
    if ((spentToday ?? 0) >= DAILY_CAP_USD) {
      return json({ error: "daily_cap_reached" }, 429);
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
          tools: TOOLS,
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
          const { result, tokens } = await handleFindKosher(supabase, voyageKey, trip.destination, input);
          await logRun({
            kind: "tool_find_kosher",
            inputTokens: tokens,
            outputTokens: 0,
            costUsd: (tokens / 1_000_000) * VOYAGE_PRICE_PER_MTOK_USD,
            latencyMs: Date.now() - toolStart,
            status: "ok",
          });
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
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
  }
});
