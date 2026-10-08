-- 021: the trip's destination photo on the public share page.
--
-- get_shared_trip (last defined in 016) also returns trip.image_url, the
-- Wikipedia photo the app looks up for the destination — but only a
-- Wikimedia URL, never an arbitrary one. Nothing else changes; the grants
-- are re-stated because CREATE OR REPLACE keeps them, for clarity only.

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
      'is_showcase', t.is_showcase,
      -- The hero photo, only when it's a Wikimedia image: image_url can be written
      -- through the API, and an arbitrary URL here would let a page owner log
      -- every visitor's IP with a tracking pixel.
      'image_url', CASE WHEN t.image_url ~ '^https://(upload|thumb)\.wikimedia\.org/' THEN t.image_url END
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

-- Check: must return zero rows ---------------------------------------------------
SELECT 'get_shared_trip: anon cannot execute it' AS problem
WHERE NOT has_function_privilege('anon', 'public.get_shared_trip(text)', 'EXECUTE')
UNION ALL
SELECT 'get_shared_trip: does not filter image_url to Wikimedia'
WHERE pg_get_functiondef('public.get_shared_trip(text)'::regprocedure) NOT LIKE '%wikimedia%'
UNION ALL
SELECT 'get_shared_trip: exposes ' || leak
FROM unnest(ARRAY['booking_ref', 'notes', 'participants', 'documents']) AS leak
WHERE pg_get_functiondef('public.get_shared_trip(text)'::regprocedure) LIKE '%''' || leak || '''%';
