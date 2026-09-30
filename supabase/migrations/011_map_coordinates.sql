-- Adds lat/lng coordinates to suggestions and itinerary items, for Stage B's
-- interactive map view. No RLS changes needed — existing owner/shared-read
-- policies on these tables already cover SELECT * (same reasoning as 010).

ALTER TABLE public.suggestions ADD COLUMN IF NOT EXISTS lat NUMERIC;
ALTER TABLE public.suggestions ADD COLUMN IF NOT EXISTS lng NUMERIC;
ALTER TABLE public.itinerary_items ADD COLUMN IF NOT EXISTS lat NUMERIC;
ALTER TABLE public.itinerary_items ADD COLUMN IF NOT EXISTS lng NUMERIC;
