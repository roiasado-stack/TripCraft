-- ============================================================================
-- 020 — Cache for the worldwide kosher layer (find_kosher in the ask function)
--
-- find_kosher now looks kosher food and Shabbat times up live, near the trip's
-- destination (business/product/kosher-architecture.md, approvals #16 + #18):
--   geo:<destination>          Nominatim coordinates of the trip destination
--   osm:<lat>,<lng>:<radius>   OpenStreetMap Overpass, diet:kosher=yes|only
--   hebcal:<lat>,<lng>:<dates> Hebcal candle-lighting / havdalah / yom tov
-- The public Overpass and Nominatim servers are fair-use only, so caching is
-- required, not an optimisation — misses are cached too (short TTL) so a city
-- with no kosher places doesn't hit Overpass on every question.
--
-- Google Places results are NEVER stored here (Google's terms allow keeping
-- only place IDs). They are fetched live on each request and counted in
-- agent_runs (kind 'google_kosher_search') for the monthly budget cap.
--
-- Same lock-down as photo_cache (012): not trip data, not user-writable — a
-- user who could write it could plant a "kosher" restaurant every other trip
-- to that city would then see. RLS on, no policies, service_role only.
--
-- Idempotent. Paste into the SQL Editor after 019.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.kosher_cache (
  cache_key TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('nominatim', 'osm', 'hebcal')),
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE public.kosher_cache ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.kosher_cache TO service_role;
REVOKE ALL ON public.kosher_cache FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS kosher_cache_expires_idx ON public.kosher_cache (expires_at);

-- The Google monthly cap counts agent_runs rows of one kind this month.
CREATE INDEX IF NOT EXISTS agent_runs_kind_created_idx ON public.agent_runs (kind, created_at);

-- Expired rows are ignored on read; this just keeps the table small.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('cleanup-kosher-cache', '41 3 * * *',
  $$DELETE FROM public.kosher_cache WHERE expires_at < now() - interval '1 day'$$);

-- Check: must return zero rows ---------------------------------------------------
SELECT 'kosher_cache: RLS is off' AS problem
FROM pg_class WHERE oid = 'public.kosher_cache'::regclass AND NOT relrowsecurity
UNION ALL
SELECT 'kosher_cache: ' || r || ' has ' || p
FROM unnest(ARRAY['anon', 'authenticated']) AS r,
     unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p
WHERE has_table_privilege(r, 'public.kosher_cache', p)
UNION ALL
SELECT 'kosher_cache: unexpected policy ' || policyname
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'kosher_cache';
