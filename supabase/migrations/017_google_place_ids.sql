-- ============================================================================
-- 017 — Google place IDs for real venue photos
--
-- Restaurants rarely have a Wikipedia photo. Google Places has one for almost
-- every venue, but its terms forbid storing the photo or even its reference;
-- only the place ID may be kept indefinitely. So we store the ID and the
-- generate function fetches a fresh photo URL each time a card is shown.
--
-- '' means "looked up, Google has no match" so the lookup isn't repeated.
--
-- Idempotent. Paste into the SQL Editor after 016.
-- ============================================================================

ALTER TABLE public.suggestions ADD COLUMN IF NOT EXISTS google_place_id TEXT;
ALTER TABLE public.itinerary_items ADD COLUMN IF NOT EXISTS google_place_id TEXT;

-- Check: ZERO rows = nothing in public open to anon.
SELECT 'policy' AS kind, tablename AS name, policyname AS detail
FROM pg_policies WHERE schemaname = 'public' AND 'anon' = ANY (roles)
UNION ALL
SELECT 'grant', table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'anon' AND table_schema = 'public';
