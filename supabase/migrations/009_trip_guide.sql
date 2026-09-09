-- ============================================================================
-- TripCraft — migration 009
-- Guide contact for an agent-run organized trip ("organized" trip_type only —
-- see WizardPage.tsx, gated to isAgent so a private traveler never sees the
-- field for their own trip). Lives on trips, not participants: a guide isn't
-- someone the app plans activities/ages/preferences around, just a contact
-- to show the client. Covered by the existing "own trips" / "shared trips
-- readable" RLS policies — no new policy needed, it's just two more columns
-- on an already-readable row.
-- ============================================================================

ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS guide_name TEXT;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS guide_phone TEXT;
