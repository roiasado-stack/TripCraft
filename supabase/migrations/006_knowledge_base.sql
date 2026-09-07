-- ============================================================================
-- TripCraft — migration 006
-- pgvector knowledge source for find_kosher (Chabad houses, kosher-certified
-- food, Shabbat-times lookup links, points of interest) — 3 destinations only
-- (Cyprus, Rome, Batumi), each fact sourced and dated. See brief §5 שלב ד.
-- Safe to run more than once. Row content itself is seeded separately by
-- evals/seed-knowledge.ts (needs real embeddings, can't be plain SQL).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  destination TEXT NOT NULL,            -- cyprus | rome | batumi — matches the slug ask/prompt.ts derives from trip.destination
  category TEXT NOT NULL,               -- chabad | kosher | shabbat | poi
  title TEXT NOT NULL,
  content TEXT NOT NULL,                -- Hebrew, embedded and shown to the model verbatim
  source_url TEXT NOT NULL,
  source_verified_on DATE NOT NULL,
  embedding VECTOR(1024) NOT NULL,      -- voyage-4-lite, output_dimension 1024
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Locked down: no direct grants to anon/authenticated. The only access path
-- is match_knowledge_chunks() below (SECURITY DEFINER) — same pattern as
-- has_role/owns_trip/my_agent_daily_cost_usd elsewhere in this schema. This
-- is public reference data (not per-user), but it still only ships through
-- the one function that also enforces the destination + similarity gate.
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.knowledge_chunks TO service_role;
REVOKE ALL ON public.knowledge_chunks FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS knowledge_chunks_destination_idx ON public.knowledge_chunks (destination);
-- No ANN index (ivfflat/hnsw): with ~15-20 rows total, a sequential scan is
-- instant. Add one if the knowledge base grows past a few thousand rows.

-- min_similarity is a starting guess, not a measured number — there's no
-- real query traffic yet to tune it against. Revisit once find_kosher has
-- actually been used a few times (agent_runs has the tool's call history).
CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  query_embedding VECTOR(1024),
  filter_destination TEXT,
  match_count INT DEFAULT 5,
  min_similarity FLOAT DEFAULT 0.3
)
RETURNS TABLE (
  title TEXT,
  content TEXT,
  category TEXT,
  source_url TEXT,
  source_verified_on DATE,
  similarity FLOAT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT title, content, category, source_url, source_verified_on,
         1 - (embedding <=> query_embedding) AS similarity
  FROM public.knowledge_chunks
  WHERE destination = filter_destination
    AND 1 - (embedding <=> query_embedding) >= min_similarity
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
REVOKE EXECUTE ON FUNCTION public.match_knowledge_chunks(vector, text, int, float) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(vector, text, int, float) TO authenticated;
