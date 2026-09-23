-- ============================================================================
-- TripCraft — migration 012
-- Photo cache for the generate function's Unsplash lookups.
--
-- The free Unsplash key allows 50 searches an hour and one trip creation used
-- ~40, so a dry run plus a second run hit "403 Rate Limit Exceeded". Landmarks
-- repeat across runs, suggestions and itinerary, so each normalized search
-- phrase is looked up once and the result reused.
--
-- Not trip data, and never user-writable: only the Edge Function (service
-- role) reads or writes it. If users could write here, one of them could plant
-- an image that every other trip then shows for "Tombs of the Kings Paphos".
-- Same lock-down as automation_logs: RLS on, no policies, service_role only.
-- Safe to run more than once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.photo_cache (
  query_key TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.photo_cache ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.photo_cache TO service_role;
REVOKE ALL ON public.photo_cache FROM anon, authenticated;
