import { supabase } from "./supabase";
import type { AgentCard, Participant, Trip } from "./types";

export type TuneOption = "more_kids" | "calmer" | "cheaper" | "more_active";

export type GenerateKind = "suggestions" | "itinerary" | "checklist";

/**
 * Translates a `functions.invoke()` failure into our own error vocabulary.
 *
 * supabase-js hides the real cause behind two wrappers, and neither message
 * mentions the status: a function that isn't deployed (or is unreachable)
 * throws `FunctionsFetchError` — "Failed to send a request to the Edge
 * Function" — while any non-2xx becomes `FunctionsHttpError` — "Edge Function
 * returned a non-2xx status code" — carrying the real Response on `.context`.
 * Matching on the message alone silently collapses every case into "unknown",
 * which is what used to happen here.
 */
async function mapInvokeError(error: unknown): Promise<string> {
  const e = error as { name?: string; message?: string; context?: Response };
  const msg = (e?.message ?? "").toLowerCase();

  if (
    e?.name === "FunctionsFetchError" ||
    msg.includes("failed to send a request") ||
    msg.includes("failed to fetch")
  )
    return "not_deployed";

  const status = e?.context?.status;
  if (status === 404) return "not_deployed";

  // Our own functions answer with { error: "..." } — prefer that over the wrapper.
  if (e?.context && typeof e.context.clone === "function") {
    try {
      const body = (await e.context.clone().json()) as { error?: unknown };
      if (typeof body?.error === "string") return body.error;
    } catch {
      // Non-JSON body (a platform error page, say) — fall through.
    }
  }
  if (status === 401 || status === 403) return "forbidden";
  return e?.message || "unknown";
}

export type AiResult = {
  ok: boolean;
  error?: string;
  /** number of rows the edge function inserted */
  inserted?: number;
};

/**
 * Calls the `generate` Supabase Edge Function, which runs the LLM server-side
 * (so the API key stays secret) and writes rows straight into the trip's tables.
 * See supabase/functions/generate/index.ts.
 */
export async function generateContent(
  trip: Trip,
  participants: Participant[],
  kind: GenerateKind,
  tune?: TuneOption,
): Promise<AiResult> {
  try {
    const { data, error } = await supabase.functions.invoke("generate", {
      body: {
        trip_id: trip.id,
        kind,
        tune: tune ?? null,
        trip: {
          destination: trip.destination,
          trip_type: trip.trip_type,
          budget_level: trip.budget_level,
          start_date: trip.start_date,
          end_date: trip.end_date,
        },
        participants: participants.map((p) => ({
          name: p.name,
          age: p.age,
          age_range: p.age_range,
          preferences: p.preferences,
        })),
      },
    });
    if (error) return { ok: false, error: await mapInvokeError(error) };
    return { ok: true, inserted: (data as { inserted?: number })?.inserted ?? 0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

export type AskTurn = { role: "user" | "assistant"; content: string };

export type AskResult = {
  ok: boolean;
  error?: string;
  answer?: string;
  cards?: AgentCard[];
};

/**
 * Calls the `ask` Supabase Edge Function — the conversational agent.
 * It answers in Hebrew about this specific trip and may return cards the caller
 * can insert into `suggestions` / `itinerary_items`. The function itself writes
 * nothing; persisting the conversation is the caller's job.
 */
export async function askAgent(trip: Trip, message: string, history: AskTurn[]): Promise<AskResult> {
  try {
    const { data, error } = await supabase.functions.invoke("ask", {
      body: { trip_id: trip.id, message, history },
    });
    if (error) return { ok: false, error: await mapInvokeError(error) };
    const res = data as { answer?: string; cards?: AgentCard[] };
    if (!res?.answer) return { ok: false, error: "empty_answer" };
    return { ok: true, answer: res.answer, cards: res.cards ?? [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}
