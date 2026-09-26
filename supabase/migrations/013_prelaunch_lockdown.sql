-- ============================================================================
-- 013 — Pre-launch security lockdown
--
-- Found in the 2026-09-26 pre-launch audit, all confirmed against production
-- with only the public (publishable) key:
--
-- 1. profiles had `TO anon USING (true)` — anyone could list every user's
--    full_name without logging in.
-- 2. trips + child tables had "shared read" policies keyed on is_shared only.
--    The share_slug was never required, so anyone could list ALL shared trips
--    at once, including guide_phone, notes, participants (names/ages), flight
--    booking_ref and private (is_shared=false) checklist items.
-- 3. agent_runs let users INSERT their own rows with no CHECK on cost_usd, so
--    one row with a negative cost wiped out the $2/day AI cap
--    (my_agent_daily_cost_usd just sums the column).
--
-- Fix: no table-level anon access at all. The share page reads through
-- get_shared_trip(slug), which needs the exact slug and returns only the
-- fields SharePage renders. Also adds delete_my_account() (privacy law —
-- right to erasure).
--
-- Idempotent. Paste into the SQL Editor after migrations 002–012.
-- ============================================================================

-- 1. profiles: owner-only -----------------------------------------------------
DROP POLICY IF EXISTS "public agency read" ON public.profiles;
REVOKE ALL ON public.profiles FROM anon;
-- RLS already returns nothing to anon here; this drops Supabase's default grant too.
REVOKE ALL ON public.user_roles FROM anon;

-- 2. shared trips: slug-gated RPC instead of table policies --------------------
DROP POLICY IF EXISTS "shared trips readable" ON public.trips;
REVOKE ALL ON public.trips FROM anon;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['participants','flights','stays','transfers','itinerary_items','suggestions','checklist_items','documents','trip_updates']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "shared read" ON public.%I', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END $$;

-- No repo policy uses it any more; anon has no business calling it.
REVOKE EXECUTE ON FUNCTION public.trip_is_shared(uuid) FROM PUBLIC, anon;

-- Everything /share/:slug shows, and nothing else: no booking_ref, seats,
-- notes, participants, documents or checklist. Returns NULL for an unknown,
-- unshared or too-short slug.
CREATE OR REPLACE FUNCTION public.get_shared_trip(p_slug TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'trip', jsonb_build_object(
      'id', t.id,
      'title', t.title,
      'destination', t.destination,
      'start_date', t.start_date,
      'end_date', t.end_date,
      'cover_emoji', t.cover_emoji,
      'guide_name', t.guide_name,
      'guide_phone', t.guide_phone,
      'photos_album_url', t.photos_album_url
    ),
    'agency', (
      SELECT jsonb_build_object('name', p.agency_name, 'color', p.agency_color)
      FROM public.profiles p WHERE p.id = t.user_id
    ),
    'flights', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'from_airport', f.from_airport, 'to_airport', f.to_airport,
        'airline', f.airline, 'flight_number', f.flight_number, 'depart_at', f.depart_at
      ) ORDER BY f.depart_at)
      FROM public.flights f WHERE f.trip_id = t.id
    ), '[]'::jsonb),
    'stays', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'hotel_name', s.hotel_name, 'address', s.address,
        'check_in', s.check_in, 'check_out', s.check_out, 'map_url', s.map_url
      ) ORDER BY s.check_in)
      FROM public.stays s WHERE s.trip_id = t.id
    ), '[]'::jsonb),
    'itinerary', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'day_date', i.day_date, 'start_time', i.start_time, 'title', i.title,
        'description', i.description, 'category', i.category, 'location', i.location,
        'map_url', i.map_url
      ) ORDER BY i.day_date, i.sort_order)
      FROM public.itinerary_items i WHERE i.trip_id = t.id
    ), '[]'::jsonb),
    'suggestions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', g.id, 'kind', g.kind, 'title', g.title, 'description', g.description,
        'location', g.location, 'map_url', g.map_url
      ) ORDER BY g.created_at)
      FROM public.suggestions g WHERE g.trip_id = t.id
    ), '[]'::jsonb),
    'updates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'title', u.title, 'body', u.body, 'kind', u.kind,
        'is_pinned', u.is_pinned, 'created_at', u.created_at
      ) ORDER BY u.is_pinned DESC, u.created_at DESC)
      FROM public.trip_updates u WHERE u.trip_id = t.id
    ), '[]'::jsonb)
  )
  FROM public.trips t
  WHERE t.share_slug = p_slug AND t.is_shared = true AND length(p_slug) >= 12
$$;
REVOKE EXECUTE ON FUNCTION public.get_shared_trip(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_trip(text) TO anon, authenticated;

-- 3. agent_runs: no negative spend --------------------------------------------
-- NOT VALID: enforced for every new row without failing on history. The sum
-- below also clamps, so a negative row planted before this migration can't
-- keep lifting the cap either.
ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_nonnegative;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_nonnegative
  CHECK (cost_usd >= 0 AND input_tokens >= 0 AND output_tokens >= 0 AND latency_ms >= 0) NOT VALID;

CREATE OR REPLACE FUNCTION public.my_agent_daily_cost_usd()
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(GREATEST(cost_usd, 0)), 0) FROM public.agent_runs
  WHERE user_id = auth.uid() AND created_at >= date_trunc('day', now())
$$;
REVOKE EXECUTE ON FUNCTION public.my_agent_daily_cost_usd() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_agent_daily_cost_usd() TO authenticated;

-- 4. Account deletion (right to erasure) --------------------------------------
-- Deletes the caller's rows and auth user. Trips cascade to every child table,
-- chat, updates and automation logs. Storage files can't be deleted from SQL —
-- the client removes <uid>/… from trip-docs first (SettingsPage).
CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  DELETE FROM public.trips WHERE user_id = uid;
  DELETE FROM public.agent_runs WHERE user_id = uid;
  DELETE FROM public.user_roles WHERE user_id = uid;
  DELETE FROM public.profiles WHERE id = uid;
  DELETE FROM auth.users WHERE id = uid;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.delete_my_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;

-- 5. Check -----------------------------------------------------------------
-- Should return ZERO rows: any policy still open to anon, or any table anon
-- can still SELECT, in the public schema.
SELECT 'policy' AS kind, tablename AS name, policyname AS detail
FROM pg_policies WHERE schemaname = 'public' AND 'anon' = ANY (roles)
UNION ALL
SELECT 'grant', table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'anon' AND table_schema = 'public';
