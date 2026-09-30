-- ============================================================================
-- 016 — "Try it yourself" demo sandboxes
--
-- The owner marks a shared trip as a showcase. Its public page then offers a
-- button that signs the visitor in anonymously (Supabase anonymous sign-in —
-- enable it under Auth → Providers) and clones the trip into one they own.
--
-- Anonymous users: no public sharing, no invites (015), no file uploads, at
-- most 3 trips, and a tiny AI allowance enforced in the Edge Functions via
-- anon_agent_daily_cost_usd(). A daily pg_cron job deletes them after 7 days.
--
-- Idempotent. Paste into the SQL Editor after 015.
-- ============================================================================

ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS is_showcase BOOLEAN NOT NULL DEFAULT false;
-- Which showcase a demo trip was cloned from, so a second click reuses it.
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS demo_source_id UUID;

-- Trip guard (replaces 015's): owner-only sharing now also covers is_showcase,
-- and anonymous users can never make anything public.
CREATE OR REPLACE FUNCTION public.guard_trip_update()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'trip owner cannot change' USING ERRCODE = '42501';
    END IF;
    IF auth.uid() IS NOT NULL AND OLD.user_id <> auth.uid()
       AND (NEW.is_shared IS DISTINCT FROM OLD.is_shared
            OR NEW.share_slug IS DISTINCT FROM OLD.share_slug
            OR NEW.is_showcase IS DISTINCT FROM OLD.is_showcase) THEN
      RAISE EXCEPTION 'only the owner can change sharing' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF public.is_anon_user() AND (NEW.is_shared OR NEW.is_showcase) THEN
    RAISE EXCEPTION 'demo trips cannot be shared' USING ERRCODE = '42501';
  END IF;
  IF NEW.is_showcase AND NOT NEW.is_shared THEN
    RAISE EXCEPTION 'a showcase must be shared' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' AND public.is_anon_user()
     AND (SELECT count(*) FROM public.trips WHERE user_id = auth.uid()) >= 3 THEN
    RAISE EXCEPTION 'demo trip limit reached' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trips_guard ON public.trips;
CREATE TRIGGER trips_guard BEFORE INSERT OR UPDATE ON public.trips FOR EACH ROW EXECUTE FUNCTION public.guard_trip_update();

-- No uploads from demo sessions.
DROP POLICY IF EXISTS "own docs insert" ON storage.objects;
CREATE POLICY "own docs insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'trip-docs' AND (storage.foldername(name))[1] = auth.uid()::text AND NOT public.is_anon_user());

-- Share page payload (013) + is_showcase so the page knows to offer the button.
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
      'photos_album_url', t.photos_album_url,
      'is_showcase', t.is_showcase
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

-- Copies a showcase into a trip the caller owns and returns its id. A second
-- call returns the same copy. Booking refs and personal notes are never
-- copied: a showcase is meant to be a demo trip, but if a real one is marked
-- by mistake, this is what leaves the building.
CREATE OR REPLACE FUNCTION public.clone_showcase_trip(p_slug TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  src public.trips;
  new_id UUID;
  t TEXT;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO src FROM public.trips
   WHERE share_slug = p_slug AND is_shared AND is_showcase AND length(p_slug) >= 12;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_a_showcase' USING ERRCODE = 'P0002'; END IF;

  SELECT id INTO new_id FROM public.trips WHERE user_id = uid AND demo_source_id = src.id LIMIT 1;
  IF FOUND THEN RETURN new_id; END IF;

  INSERT INTO public.trips (user_id, title, destination, start_date, end_date, trip_type, budget_level,
                            cover_emoji, guide_name, guide_phone, image_url, demo_source_id)
  VALUES (uid, src.title, src.destination, src.start_date, src.end_date, src.trip_type, src.budget_level,
          src.cover_emoji, src.guide_name, src.guide_phone, src.image_url, src.id)
  RETURNING id INTO new_id;

  INSERT INTO public.participants (trip_id, name, age, age_range, preferences)
  SELECT new_id, name, age, age_range, preferences FROM public.participants WHERE trip_id = src.id;

  -- Row-for-row copies with a fresh id and the new trip; booking refs blanked.
  FOREACH t IN ARRAY ARRAY['flights', 'stays', 'transfers', 'itinerary_items', 'suggestions'] LOOP
    EXECUTE format(
      'INSERT INTO public.%1$I SELECT (jsonb_populate_record(NULL::public.%1$I,
         to_jsonb(r) || jsonb_build_object(''id'', gen_random_uuid(), ''trip_id'', $1, ''created_at'', now())
         || CASE WHEN to_jsonb(r) ? ''booking_ref'' THEN jsonb_build_object(''booking_ref'', NULL) ELSE ''{}''::jsonb END
         || CASE WHEN to_jsonb(r) ? ''notes'' THEN jsonb_build_object(''notes'', NULL) ELSE ''{}''::jsonb END)).*
       FROM public.%1$I r WHERE r.trip_id = $2', t)
    USING new_id, src.id;
  END LOOP;

  INSERT INTO public.checklist_items (trip_id, title, is_done, is_shared, sort_order, created_by)
  SELECT new_id, title, false, true, sort_order, uid FROM public.checklist_items
   WHERE trip_id = src.id AND is_shared;

  RETURN new_id;
END;
$$;

-- Demo AI spend today across all anonymous users (the Edge Functions' $1 cap).
CREATE OR REPLACE FUNCTION public.anon_agent_daily_cost_usd()
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(GREATEST(r.cost_usd, 0)), 0)
  FROM public.agent_runs r JOIN auth.users u ON u.id = r.user_id
  WHERE u.is_anonymous AND r.created_at >= date_trunc('day', now())
$$;

-- Daily cleanup: demo users and everything they own, 7 days after sign-in.
CREATE OR REPLACE FUNCTION public.cleanup_demo_users()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE removed INTEGER;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _expired_demo (id UUID) ON COMMIT DROP;
  DELETE FROM _expired_demo;
  INSERT INTO _expired_demo
    SELECT id FROM auth.users WHERE is_anonymous AND created_at < now() - interval '7 days';
  DELETE FROM public.trips WHERE user_id IN (SELECT id FROM _expired_demo);
  DELETE FROM public.trip_members WHERE user_id IN (SELECT id FROM _expired_demo);
  -- agent_runs are kept on purpose (see "AI spend survives deletion" below).
  DELETE FROM public.user_roles WHERE user_id IN (SELECT id FROM _expired_demo);
  DELETE FROM public.profiles WHERE id IN (SELECT id FROM _expired_demo);
  DELETE FROM auth.users WHERE id IN (SELECT id FROM _expired_demo);
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.clone_showcase_trip(text), public.anon_agent_daily_cost_usd() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clone_showcase_trip(text), public.anon_agent_daily_cost_usd() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_demo_users() FROM PUBLIC, anon, authenticated;

-- AI spend survives deletion --------------------------------------------------
-- agent_runs.trip_id was ON DELETE CASCADE (migration 004), so deleting a trip
-- deleted its usage rows — and the daily caps are sums of those rows. Spend $2,
-- delete the trip, spend again. Usage now outlives the trip.
ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_trip_id_fkey;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_trip_id_fkey
  FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE SET NULL;

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('cleanup-demo-users', '17 3 * * *', 'SELECT public.cleanup_demo_users()');

-- Check: ZERO rows = nothing in public open to anon.
SELECT 'policy' AS kind, tablename AS name, policyname AS detail
FROM pg_policies WHERE schemaname = 'public' AND 'anon' = ANY (roles)
UNION ALL
SELECT 'grant', table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'anon' AND table_schema = 'public';
