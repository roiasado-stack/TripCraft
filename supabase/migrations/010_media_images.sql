-- ============================================================================
-- TripCraft — migration 010
-- Rich media cards: optional cover images for trips, suggestions, and
-- itinerary items. Plain pasted URLs for now — no Storage upload yet.
-- Covered by the existing "own trips"/"owner all" + "shared trips readable"/
-- "shared read" RLS policies on each table (SELECT * already includes the
-- new column) — no policy changes needed.
-- Safe to run more than once.
-- ============================================================================

ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE public.suggestions ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE public.itinerary_items ADD COLUMN IF NOT EXISTS image_url TEXT;
