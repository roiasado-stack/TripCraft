-- ============================================================================
-- 019 — Remaining fixes from the feat/trip-members code review (PR #1)
--
-- 1. A member the owner removed could rejoin at once through the same, still
--    valid invite link, because removal deleted their row. Removal now marks
--    the row 'removed'; accept_trip_invite already returns an existing row
--    unchanged, and trip_role only counts 'active' rows, so they stay out.
-- 2. "Try it yourself" copied the showcase's participant names, seats,
--    baggage, phone numbers, booking links and guide contact to every
--    visitor, although the public page hides them. The copy now keeps ages
--    and preferences (they drive the itinerary) under placeholder names, and
--    blanks every contact and booking detail.
--
-- Idempotent. Paste into the SQL Editor after migrations 002–018.
-- ============================================================================

-- 1. Removed members stay removed ----------------------------------------------
ALTER TABLE public.trip_members DROP CONSTRAINT IF EXISTS trip_members_status_check;
ALTER TABLE public.trip_members ADD CONSTRAINT trip_members_status_check
  CHECK (status IN ('pending', 'active', 'removed'));

-- 2. Demo clone without personal details -----------------------------------------
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

  -- No guide contact: that is a real person's phone number.
  INSERT INTO public.trips (user_id, title, destination, start_date, end_date, trip_type, budget_level,
                            cover_emoji, image_url, demo_source_id)
  VALUES (uid, src.title, src.destination, src.start_date, src.end_date, src.trip_type, src.budget_level,
          src.cover_emoji, src.image_url, src.id)
  RETURNING id INTO new_id;

  -- Ages and preferences shape the itinerary; names become placeholders.
  INSERT INTO public.participants (trip_id, name, age, age_range, preferences)
  SELECT new_id, 'נוסע ' || row_number() OVER (ORDER BY age DESC NULLS LAST, id), age, age_range, preferences
    FROM public.participants WHERE trip_id = src.id;

  -- Row-for-row copies with a fresh id and the new trip; everything that
  -- identifies a booking or a person is blanked.
  FOREACH t IN ARRAY ARRAY['flights', 'stays', 'transfers', 'itinerary_items', 'suggestions'] LOOP
    EXECUTE format(
      'INSERT INTO public.%1$I SELECT (jsonb_populate_record(NULL::public.%1$I,
         to_jsonb(r) || jsonb_build_object(''id'', gen_random_uuid(), ''trip_id'', $1, ''created_at'', now())
         || (SELECT COALESCE(jsonb_object_agg(k, NULL), ''{}''::jsonb)
               FROM unnest(ARRAY[''booking_ref'', ''notes'', ''seats'', ''baggage'', ''phone'', ''url'']) AS k
              WHERE to_jsonb(r) ? k))).*
       FROM public.%1$I r WHERE r.trip_id = $2', t)
    USING new_id, src.id;
  END LOOP;

  INSERT INTO public.checklist_items (trip_id, title, is_done, is_shared, sort_order, created_by)
  SELECT new_id, title, false, true, sort_order, uid FROM public.checklist_items
   WHERE trip_id = src.id AND is_shared;

  RETURN new_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.clone_showcase_trip(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clone_showcase_trip(text) TO authenticated;

-- Check: must return zero rows ---------------------------------------------------
SELECT 'trip_members status check does not allow removed' AS problem
WHERE NOT EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conname = 'trip_members_status_check' AND pg_get_constraintdef(oid) LIKE '%removed%')
UNION ALL
SELECT 'clone_showcase_trip still copies guide contact'
WHERE position('src.guide_phone' in pg_get_functiondef('public.clone_showcase_trip'::regproc)) > 0;
