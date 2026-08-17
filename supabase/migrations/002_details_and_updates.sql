-- ============================================================================
-- TripCraft — migration 002
-- Richer flight/stay/transfer details, shared photo album, and trip updates.
-- Safe to run more than once.
-- ============================================================================

-- Shared photo album (Google Photos / iCloud / any link) --------------------
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS photos_album_url TEXT;

-- Fuller flight details ------------------------------------------------------
ALTER TABLE public.flights ADD COLUMN IF NOT EXISTS from_terminal TEXT;
ALTER TABLE public.flights ADD COLUMN IF NOT EXISTS to_terminal   TEXT;
ALTER TABLE public.flights ADD COLUMN IF NOT EXISTS seats         TEXT;
ALTER TABLE public.flights ADD COLUMN IF NOT EXISTS baggage       TEXT;
ALTER TABLE public.flights ADD COLUMN IF NOT EXISTS notes         TEXT;

-- Contact details for hotels and transport ----------------------------------
ALTER TABLE public.stays     ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.stays     ADD COLUMN IF NOT EXISTS url   TEXT;
ALTER TABLE public.transfers ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.transfers ADD COLUMN IF NOT EXISTS url   TEXT;

-- Map links for anything with a place ---------------------------------------
ALTER TABLE public.suggestions     ADD COLUMN IF NOT EXISTS location  TEXT;
ALTER TABLE public.suggestions     ADD COLUMN IF NOT EXISTS map_url   TEXT;
ALTER TABLE public.itinerary_items ADD COLUMN IF NOT EXISTS map_url   TEXT;
ALTER TABLE public.stays           ADD COLUMN IF NOT EXISTS map_url   TEXT;

-- Important updates / announcements for a trip -------------------------------
CREATE TABLE IF NOT EXISTS public.trip_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  kind TEXT NOT NULL DEFAULT 'info',   -- info | warning | urgent
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_updates TO authenticated;
GRANT SELECT ON public.trip_updates TO anon;
GRANT ALL ON public.trip_updates TO service_role;
ALTER TABLE public.trip_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner all" ON public.trip_updates;
CREATE POLICY "owner all" ON public.trip_updates FOR ALL TO authenticated
  USING (public.owns_trip(trip_id)) WITH CHECK (public.owns_trip(trip_id));

DROP POLICY IF EXISTS "shared read" ON public.trip_updates;
CREATE POLICY "shared read" ON public.trip_updates FOR SELECT TO anon, authenticated
  USING (public.trip_is_shared(trip_id));

CREATE INDEX IF NOT EXISTS trip_updates_trip_idx ON public.trip_updates (trip_id);
