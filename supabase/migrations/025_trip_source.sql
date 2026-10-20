-- 025 — Where an agent's trip came from (agency workspace, phase 3)
--
-- Groundwork for connecting agencies' own systems later: every agent trip
-- records how its bookings arrived and the booking number it has in the
-- agency's system, so a future import (an Edge Function fed by a booking
-- system or CRM) can find "its" trip again instead of creating a second one.
--
-- 1. trip_clients.source        'manual' | 'documents' (CHECK; a new source
--                               adds its value here in its own migration).
--    trip_clients.external_ref  the agency's own booking/file number, free text.
--    Both live on trip_clients on purpose: that table is owner-only (022) and
--    never reaches the public brochure (get_shared_trip doesn't read it).
-- 2. agent_trip_board() also returns source and external_ref (the board shows
--    and searches the booking number). Its return type changes, so it is
--    dropped and recreated, with the 022 grants restored.
--
-- Rows that exist before 025 read as 'manual': their origin was never recorded.
--
-- Apply: paste into the SQL Editor after 024. Ends with the check query that
-- must return zero rows.

-- 1. Columns -----------------------------------------------------------------------
ALTER TABLE public.trip_clients ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE public.trip_clients DROP CONSTRAINT IF EXISTS trip_clients_source_check;
ALTER TABLE public.trip_clients ADD CONSTRAINT trip_clients_source_check
  CHECK (source IN ('manual', 'documents'));

ALTER TABLE public.trip_clients ADD COLUMN IF NOT EXISTS external_ref TEXT;
ALTER TABLE public.trip_clients DROP CONSTRAINT IF EXISTS trip_clients_external_ref_check;
ALTER TABLE public.trip_clients ADD CONSTRAINT trip_clients_external_ref_check
  CHECK (external_ref IS NULL OR (length(external_ref) BETWEEN 1 AND 80));

-- 2. The board -----------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.agent_trip_board();
CREATE FUNCTION public.agent_trip_board()
RETURNS TABLE (
  id UUID,
  title TEXT,
  destination TEXT,
  start_date DATE,
  end_date DATE,
  client_name TEXT,
  client_phone TEXT,
  source TEXT,
  external_ref TEXT,
  is_shared BOOLEAN,
  share_slug TEXT,
  image_url TEXT,
  participants_count INT,
  members_joined INT,
  members_pending INT,
  passports_count INT,
  documents_count INT,
  bookings_count INT,
  needs_attention TEXT[]
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH b AS (
    SELECT t.id, t.title, t.destination, t.start_date, t.end_date, c.client_name, c.client_phone,
           c.source, c.external_ref,
           t.is_shared, t.share_slug, t.image_url,
           (SELECT count(*) FROM participants p WHERE p.trip_id = t.id)::int AS participants_count,
           (SELECT count(*) FROM trip_members m WHERE m.trip_id = t.id AND m.status = 'active')::int AS members_joined,
           (SELECT count(*) FROM trip_members m WHERE m.trip_id = t.id AND m.status = 'pending')::int AS members_pending,
           COALESCE(public.trip_passport_count(t.id), 0) AS passports_count,
           (SELECT count(*) FROM documents d WHERE d.trip_id = t.id)::int AS documents_count,
           ((SELECT count(*) FROM flights f WHERE f.trip_id = t.id)
            + (SELECT count(*) FROM stays s WHERE s.trip_id = t.id)
            + (SELECT count(*) FROM transfers x WHERE x.trip_id = t.id))::int AS bookings_count,
           (t.end_date IS NULL OR t.end_date >= current_date) AS not_over
    FROM trips t
    LEFT JOIN trip_clients c ON c.trip_id = t.id
    WHERE t.user_id = auth.uid() AND NOT t.is_template
      AND (public.has_role(auth.uid(), 'agent') OR public.has_role(auth.uid(), 'admin'))
  )
  SELECT b.id, b.title, b.destination, b.start_date, b.end_date, b.client_name, b.client_phone,
         b.source, b.external_ref,
         b.is_shared, b.share_slug, b.image_url,
         b.participants_count, b.members_joined, b.members_pending, b.passports_count,
         b.documents_count, b.bookings_count,
         CASE WHEN NOT b.not_over THEN ARRAY[]::text[] ELSE array_remove(ARRAY[
           CASE WHEN b.passports_count < b.participants_count THEN 'missing_passports' END,
           -- Nobody joined yet; families with kids never fully join, so not "fewer than travellers".
           CASE WHEN b.members_joined = 0 AND b.participants_count > 0 THEN 'not_joined' END,
           CASE WHEN b.members_pending > 0 THEN 'pending_members' END,
           CASE WHEN b.start_date IS NULL THEN 'no_dates' END,
           CASE WHEN b.start_date BETWEEN current_date AND current_date + 7 THEN 'departing_soon' END
         ], NULL) END
  FROM b
  ORDER BY b.start_date NULLS LAST, b.title
$$;
REVOKE EXECUTE ON FUNCTION public.agent_trip_board() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_trip_board() TO authenticated;

-- Check: must return zero rows -----------------------------------------------------
SELECT 'trip_clients column missing' AS problem, c AS detail
FROM unnest(ARRAY['source', 'external_ref']) AS c
WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'trip_clients' AND column_name = c)
UNION ALL
SELECT 'trip_clients policy not owner-only', policyname
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trip_clients'
  AND (coalesce(qual, '') NOT LIKE '%owns_trip%' OR coalesce(with_check, '') NOT LIKE '%owns_trip%')
UNION ALL
SELECT 'get_shared_trip reads trip_clients', ''
WHERE pg_get_functiondef('public.get_shared_trip(text)'::regprocedure) LIKE '%trip_clients%'
   OR pg_get_functiondef('public.get_shared_trip(text)'::regprocedure) LIKE '%external_ref%'
UNION ALL
SELECT 'agent_trip_board callable by anon', ''
WHERE has_function_privilege('anon', 'public.agent_trip_board()', 'EXECUTE')
UNION ALL
SELECT 'agent_trip_board not callable by authenticated', ''
WHERE NOT has_function_privilege('authenticated', 'public.agent_trip_board()', 'EXECUTE')
UNION ALL
SELECT 'agent_trip_board is SECURITY DEFINER', ''
WHERE (SELECT prosecdef FROM pg_proc WHERE oid = 'public.agent_trip_board()'::regprocedure);
