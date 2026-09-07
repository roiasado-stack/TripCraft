/**
 * Regression harness for the `ask` trip agent (Module 02 — Evaluation).
 *
 * Fires every question in questions.jsonl at the exact system prompt +
 * snapshot logic from supabase/functions/ask/prompt.ts, against the fixed
 * fixture-trip.ts context, and grades each answer with plain substring
 * rules — no LLM-as-judge yet (per the project brief: add one only if time
 * remains). Run before any change to the prompt, the model, or (once it
 * exists) the RAG knowledge source, and compare against evals/baseline.json.
 *
 * Usage:
 *   node evals/run.ts              # run + print report
 *   node evals/run.ts --save       # also (re)write evals/baseline.json
 *
 * Needs ANTHROPIC_API_KEY in .env (a local dev key — separate from the
 * ANTHROPIC_API_KEY Supabase secret the deployed Edge Functions use).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { buildSnapshot, INSTRUCTIONS, MODEL, TOOLS } from "../supabase/functions/ask/prompt.ts";
import {
  FIXTURE_CHECKLIST_OPEN,
  FIXTURE_FLIGHTS,
  FIXTURE_ITINERARY,
  FIXTURE_PARTICIPANTS,
  FIXTURE_STAYS,
  FIXTURE_SUGGESTIONS,
  FIXTURE_TRIP,
} from "./fixture-trip.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// claude-haiku-4-5 pricing (Anthropic API, as of this eval's baseline run).
// Update this constant, not the numbers in the report, when pricing changes.
const PRICE_PER_MTOK_INPUT_USD = 1.0;
const PRICE_PER_MTOK_OUTPUT_USD = 5.0;

// Pre-defined pass/fail gate for the regression script's exit code.
// Initial guesses — revisit once the baseline run exists and again after the
// RAG knowledge source lands (Day 9–11), since that's the change these
// thresholds exist to catch regressions or improvements against.
const MIN_ACCURACY = 0.7;
const MIN_CORRECT_REFUSAL_RATE = 0.7;
const MAX_HALLUCINATION_RATE = 0.2;

// Deliberately generous: a missed phrase here undercounts correct refusals,
// which is worse for a baseline than an occasional false positive. Broadened
// once already (2026-09-04) after the first real run flagged genuine
// refusals the original short list didn't recognize (e.g. "אני לא רואה את
// הפרטים האלה", "לא צוינו").
const REFUSAL_PHRASES = [
  "אין לי מידע",
  "אין לי גישה",
  "לא ידוע לי",
  "אני לא יודע",
  "אינני יודע",
  "לא בטוח",
  "אין לי את המידע",
  "לא יכול לדעת",
  "לא ניתן לדעת",
  "אין לי נתונים",
  "אין לי דרך לדעת",
  "לא רואה את הפרטים",
  "לא רואה פרטים",
  "לא צוינו",
  "לא צוין",
  "אין לי פרטים",
  "לא מופיע",
  "לא ניתן לאתר",
  "אין לי תיעוד",
  "לא מצאתי",
  "אינני רואה",
  "לא רשום",
  "אין מידע",
  "לא כלול במידע",
  "לא נמצא במידע",
  "כדאי לבדוק",
  "כדאי שתבדקו",
  "מומלץ לבדוק",
  "אני ממליץ לבדוק",
  "לא יכול להגיד",
  "לא ניתן לאשר",
  "אין לי אישור",
  "לא באפשרותי",
  "אין לי יכולת לדעת",
  "לא יש לי גישה",
  "אני לא בקשר",
  "אי אפשר לדעת",
  "לא יכול לתת לך",
];

type Category = "factual" | "retrieval" | "refusal";

interface EvalQuestion {
  id: string;
  category: Category;
  question: string;
  requiredGroups?: string[][];
  listOverlap?: { candidates: string[]; min: number };
  forbidden?: string[];
  expectRefusal?: boolean;
  notes?: string;
}

interface EvalResult {
  id: string;
  category: Category;
  question: string;
  answer: string;
  pass: boolean;
  hallucinated: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  toolCalls?: string[];
  error?: string;
}

function loadQuestions(): EvalQuestion[] {
  const raw = fs.readFileSync(path.join(HERE, "questions.jsonl"), "utf-8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EvalQuestion);
}

function normalize(text: string): string {
  return text.toLowerCase();
}

function containsAny(haystack: string, needles: string[]): boolean {
  const h = normalize(haystack);
  return needles.some((n) => h.includes(normalize(n)));
}

function grade(q: EvalQuestion, answer: string): { pass: boolean; hallucinated: boolean } {
  const hallucinated = q.forbidden ? containsAny(answer, q.forbidden) : false;

  if (q.category === "refusal") {
    const refused = containsAny(answer, REFUSAL_PHRASES);
    return { pass: refused && !hallucinated, hallucinated };
  }

  let pass = true;
  if (q.requiredGroups) {
    pass = q.requiredGroups.every((group) => containsAny(answer, group));
  }
  if (q.listOverlap) {
    const matched = q.listOverlap.candidates.filter((c) => containsAny(answer, [c])).length;
    pass = pass && matched >= q.listOverlap.min;
  }
  return { pass, hallucinated };
}

function buildSystemPrompt(): string {
  const snapshot = buildSnapshot(
    FIXTURE_TRIP,
    FIXTURE_PARTICIPANTS,
    FIXTURE_ITINERARY,
    FIXTURE_STAYS,
    FIXTURE_FLIGHTS,
    FIXTURE_SUGGESTIONS,
    FIXTURE_CHECKLIST_OPEN,
  );
  return `${INSTRUCTIONS}\n\n--- פרטי הטיול ---\n${snapshot}`;
}

/**
 * ask/index.ts's find_kosher is now a real pgvector search (Day 9-11), but
 * the fixture trip here is Rhodes — not one of the 3 covered destinations
 * (Cyprus/Rome/Batumi) — so the real function would also return "not
 * covered" for it, without ever calling the embeddings API. This stub stays
 * accurate for that reason, not because it's unmaintained; if the fixture
 * trip ever moves to a covered destination, this needs to become a real
 * match_knowledge_chunks call instead.
 */
function handleFindKosher(): Record<string, unknown> {
  return {
    available: false,
    message: "אין עדיין מקור ידע מאומת לכשרות/שבת עבור היעד הזה במערכת. אל תנחש — אמור זאת למשתמש במפורש.",
  };
}

const MAX_TOOL_ITERATIONS = 4;

/** Mirrors the tool-use loop in ask/index.ts: find_kosher executes inline,
 *  add_to_itinerary/add_suggestion are acknowledged but never actually
 *  written (there's no real trip to write into here). */
async function askOnce(client: Anthropic, system: string, question: string) {
  const start = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let answer = "";
  const toolCalls: string[] = [];

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools: TOOLS as unknown as Anthropic.Tool[],
      messages,
    });
    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;

    const textBlock = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (textBlock) answer = textBlock;

    const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUseBlocks.length === 0) break;

    messages.push({ role: "assistant", content: response.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      toolCalls.push(block.name);
      const result =
        block.name === "find_kosher" ? handleFindKosher() : { status: "queued_for_user_approval" };
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return { answer, latencyMs: Date.now() - start, inputTokens, outputTokens, toolCalls };
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is not set (add it to .env — see evals/run.ts header comment).");
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });
  const questions = loadQuestions();
  const system = buildSystemPrompt();

  const results: EvalResult[] = [];

  for (const q of questions) {
    process.stdout.write(`${q.id} … `);
    try {
      const { answer, latencyMs, inputTokens, outputTokens, toolCalls } = await askOnce(client, system, q.question);
      const { pass, hallucinated } = grade(q, answer);
      const costUsd = (inputTokens / 1_000_000) * PRICE_PER_MTOK_INPUT_USD + (outputTokens / 1_000_000) * PRICE_PER_MTOK_OUTPUT_USD;
      results.push({
        id: q.id,
        category: q.category,
        question: q.question,
        answer,
        pass,
        hallucinated,
        latencyMs,
        inputTokens,
        outputTokens,
        costUsd,
        toolCalls,
      });
      const toolsNote = toolCalls.length ? ` [${toolCalls.join(",")}]` : "";
      console.log(`${pass ? "PASS" : "FAIL"}${hallucinated ? " (hallucination)" : ""} — ${latencyMs}ms${toolsNote}`);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      results.push({
        id: q.id,
        category: q.category,
        question: q.question,
        answer: "",
        pass: false,
        hallucinated: false,
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        error,
      });
      console.log(`ERROR — ${error}`);
    }
  }

  const factualRetrieval = results.filter((r) => r.category === "factual" || r.category === "retrieval");
  const refusal = results.filter((r) => r.category === "refusal");

  const accuracy = factualRetrieval.length ? factualRetrieval.filter((r) => r.pass).length / factualRetrieval.length : 0;
  const correctRefusalRate = refusal.length ? refusal.filter((r) => r.pass).length / refusal.length : 0;
  const hallucinationRate = results.length ? results.filter((r) => r.hallucinated).length / results.length : 0;
  const avgLatencyMs = results.length ? results.reduce((s, r) => s + r.latencyMs, 0) / results.length : 0;
  const totalCostUsd = results.reduce((s, r) => s + r.costUsd, 0);
  const avgCostUsd = results.length ? totalCostUsd / results.length : 0;

  const summary = {
    ranAt: new Date().toISOString(),
    model: MODEL,
    counts: { total: results.length, factualRetrieval: factualRetrieval.length, refusal: refusal.length },
    metrics: {
      accuracy: round(accuracy),
      correctRefusalRate: round(correctRefusalRate),
      hallucinationRate: round(hallucinationRate),
      avgLatencyMs: Math.round(avgLatencyMs),
      avgCostUsd: round(avgCostUsd, 6),
      totalCostUsd: round(totalCostUsd, 6),
    },
    thresholds: {
      minAccuracy: MIN_ACCURACY,
      minCorrectRefusalRate: MIN_CORRECT_REFUSAL_RATE,
      maxHallucinationRate: MAX_HALLUCINATION_RATE,
    },
    results,
  };

  console.log("\n--- Summary ---");
  console.log(`accuracy (factual+retrieval):  ${pct(accuracy)}  (gate ≥ ${pct(MIN_ACCURACY)})`);
  console.log(`correct-refusal rate:          ${pct(correctRefusalRate)}  (gate ≥ ${pct(MIN_CORRECT_REFUSAL_RATE)})`);
  console.log(`hallucination rate:            ${pct(hallucinationRate)}  (gate ≤ ${pct(MAX_HALLUCINATION_RATE)})`);
  console.log(`avg response time:             ${Math.round(avgLatencyMs)}ms`);
  console.log(`avg cost / question:           $${avgCostUsd.toFixed(6)}`);
  console.log(`total cost (${results.length} questions):        $${totalCostUsd.toFixed(4)}`);

  const gatePass =
    accuracy >= MIN_ACCURACY && correctRefusalRate >= MIN_CORRECT_REFUSAL_RATE && hallucinationRate <= MAX_HALLUCINATION_RATE;
  console.log(`\nGate: ${gatePass ? "PASS" : "FAIL"}`);

  if (process.argv.includes("--save")) {
    fs.writeFileSync(path.join(HERE, "baseline.json"), JSON.stringify(summary, null, 2) + "\n");
    console.log(`\nSaved evals/baseline.json`);
  }

  process.exit(gatePass ? 0 : 1);
}

function round(n: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

main();
