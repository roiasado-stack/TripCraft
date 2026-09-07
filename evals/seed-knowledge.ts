/**
 * One-time (re-runnable) seed script for the find_kosher knowledge base.
 * Embeds every chunk in evals/knowledge-source.ts with Voyage AI and upserts
 * it into public.knowledge_chunks — service_role key required (this table
 * has no anon/authenticated grants, so the anon key can't write to it).
 *
 * Usage:
 *   node --env-file=.env evals/seed-knowledge.ts
 *
 * Needs in .env: VOYAGE_API_KEY, VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * (the last one only here — never in client code, never deployed).
 */

import { createClient } from "@supabase/supabase-js";
import { KNOWLEDGE_CHUNKS } from "./knowledge-source.ts";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-4-lite";
const EMBEDDING_DIMENSION = 1024;

async function embedDocuments(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("VOYAGE_API_KEY is not set");

  const res = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      input: texts,
      model: VOYAGE_MODEL,
      input_type: "document",
      output_dimension: EMBEDDING_DIMENSION,
    }),
  });
  if (!res.ok) throw new Error(`Voyage embeddings failed: ${res.status} ${await res.text()}`);

  const payload = await res.json();
  const data = (payload.data as { embedding: number[]; index: number }[]).slice().sort((a, b) => a.index - b.index);
  return data.map((d) => d.embedding);
}

async function main() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set in .env");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  console.log(`Embedding ${KNOWLEDGE_CHUNKS.length} chunks with ${VOYAGE_MODEL}…`);
  const embeddings = await embedDocuments(KNOWLEDGE_CHUNKS.map((c) => c.content));

  // Re-runnable: wipe and reinsert rather than trying to diff — the dataset
  // is small (~12 rows) and this is a local admin script, not a hot path.
  const { error: deleteError } = await supabase.from("knowledge_chunks").delete().not("id", "is", null);
  if (deleteError) throw deleteError;

  const rows = KNOWLEDGE_CHUNKS.map((chunk, i) => ({
    destination: chunk.destination,
    category: chunk.category,
    title: chunk.title,
    content: chunk.content,
    source_url: chunk.source_url,
    source_verified_on: chunk.source_verified_on,
    embedding: embeddings[i],
  }));

  const { error: insertError } = await supabase.from("knowledge_chunks").insert(rows);
  if (insertError) throw insertError;

  console.log(`Seeded ${rows.length} chunks across ${new Set(rows.map((r) => r.destination)).size} destinations.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
