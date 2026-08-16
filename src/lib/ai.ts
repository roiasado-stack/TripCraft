import { supabase } from "./supabase";
import type { Participant, Trip } from "./types";

export type TuneOption = "more_kids" | "calmer" | "cheaper" | "more_active";

export type GenerateKind = "suggestions" | "itinerary" | "checklist";

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
    if (error) {
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("not found") || msg.includes("failed to fetch") || msg.includes("404"))
        return { ok: false, error: "not_deployed" };
      return { ok: false, error: error.message };
    }
    return { ok: true, inserted: (data as { inserted?: number })?.inserted ?? 0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}
