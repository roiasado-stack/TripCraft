-- ============================================================================
-- 032 — Transfers at the voucher's time, and on the share page
--       (docs/plans/2026-11-28-share-transfers.md, item #69)
--
-- A voucher says "pickup 14:00": the wall clock where the pickup happens. Until
-- now every writer read that wall clock in the saving device's zone and stored
-- the instant, and every reader showed the instant in the viewer's zone, so
-- 14:00 saved in Israel showed 16:00 on a phone in the Seychelles.
--
-- 1. transfers gets the voucher's wall clock:
--      pickup_local / return_local  TIMESTAMP (no zone): the time as printed.
--    pickup_at / return_at stay, kept in step by a trigger, as an ordering key
--    (order("pickup_at")). No zone column: nothing knows a transfer's zone and
--    nothing needs its true instant (a flight's zones exist for durations).
--
-- 2. Trigger transfers_local_times (BEFORE INSERT OR UPDATE), per field — 028's
--    logic with the zone fixed to Asia/Jerusalem:
--    - local written (insert) or changed (update) → at := local AT TIME ZONE 'Asia/Jerusalem'
--    - otherwise at written / changed (an old cached client)
--        → local := at AT TIME ZONE 'Asia/Jerusalem': what that client showed an
--          Israeli user, the one who typed it.
--
-- 3. Backfill, before the trigger exists (instants stay byte-for-byte):
--    pickup_local := pickup_at AT TIME ZONE 'Asia/Jerusalem' (same for return).
--    OLD ROWS: each was stored as "the wall clock read in the saving device's
--    zone". Saved from a device on Israel time (the normal case), the local is
--    exactly what was typed or scanned — the voucher time. Saved from a device in
--    another zone, the local is off by that zone's difference from Israel on that
--    date. The data can't tell those rows apart, so nothing guesses: such a row
--    shows the shifted time until someone re-saves it in the transport tab.
--
-- 4. get_shared_trip (last defined in 028) also returns the trip's transfers,
--    boats and ferries included (they are kind 'transfer'): id, kind (only
--    'transfer' / 'car_rental'), provider, pickup_local, and return_local for a
--    car rental. Left out on purpose: pickup / drop-off place (free text — for a
--    transfer from home it is the client's home address), the phone (can be a
--    private driver's mobile), the link (booking-management links carry tokens),
--    the booking number and the notes. The provider is shown as entered, except
--    that it is dropped when it holds 7 or more digits in total (any script, after
--    NFKC so full-width forms count; counted, not matched as a run, so dashes,
--    spaces, slashes or underscores don't hide a phone number) or an '@' (email).
--    Nothing else in the function changes.
--
-- clone_showcase_trip (019) copies transfers column by column through
-- jsonb_populate_record, so the new columns come along and the trigger derives
-- the same instants. No RLS change: new columns on an existing table.
--
-- Idempotent. Paste into the SQL Editor after 031.
-- Deploy order: this migration → web.
-- ============================================================================

-- 1. Columns ------------------------------------------------------------------
ALTER TABLE public.transfers ADD COLUMN IF NOT EXISTS pickup_local TIMESTAMP;
ALTER TABLE public.transfers ADD COLUMN IF NOT EXISTS return_local TIMESTAMP;

-- 2. Trigger ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfers_local_times()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Pickup
  IF TG_OP = 'INSERT' THEN
    IF NEW.pickup_local IS NOT NULL THEN
      NEW.pickup_at := NEW.pickup_local AT TIME ZONE 'Asia/Jerusalem';
    ELSIF NEW.pickup_at IS NOT NULL THEN
      NEW.pickup_local := NEW.pickup_at AT TIME ZONE 'Asia/Jerusalem';
    END IF;
  ELSIF NEW.pickup_local IS DISTINCT FROM OLD.pickup_local THEN
    NEW.pickup_at := NEW.pickup_local AT TIME ZONE 'Asia/Jerusalem';
  ELSIF NEW.pickup_at IS DISTINCT FROM OLD.pickup_at THEN
    -- Old client: see 2. in the header.
    NEW.pickup_local := NEW.pickup_at AT TIME ZONE 'Asia/Jerusalem';
  END IF;

  -- Return (car rentals)
  IF TG_OP = 'INSERT' THEN
    IF NEW.return_local IS NOT NULL THEN
      NEW.return_at := NEW.return_local AT TIME ZONE 'Asia/Jerusalem';
    ELSIF NEW.return_at IS NOT NULL THEN
      NEW.return_local := NEW.return_at AT TIME ZONE 'Asia/Jerusalem';
    END IF;
  ELSIF NEW.return_local IS DISTINCT FROM OLD.return_local THEN
    NEW.return_at := NEW.return_local AT TIME ZONE 'Asia/Jerusalem';
  ELSIF NEW.return_at IS DISTINCT FROM OLD.return_at THEN
    NEW.return_local := NEW.return_at AT TIME ZONE 'Asia/Jerusalem';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.transfers_local_times() FROM PUBLIC, anon, authenticated;

-- 3. Backfill, before the trigger exists (instants stay byte-for-byte) ----------
DROP TRIGGER IF EXISTS transfers_local_times ON public.transfers;
UPDATE public.transfers SET pickup_local = pickup_at AT TIME ZONE 'Asia/Jerusalem'
WHERE pickup_at IS NOT NULL AND pickup_local IS NULL;
UPDATE public.transfers SET return_local = return_at AT TIME ZONE 'Asia/Jerusalem'
WHERE return_at IS NOT NULL AND return_local IS NULL;

CREATE TRIGGER transfers_local_times BEFORE INSERT OR UPDATE ON public.transfers
  FOR EACH ROW EXECUTE FUNCTION public.transfers_local_times();

-- 4. Share page payload (028) + transfers ---------------------------------------
-- No comments inside the body: the check below searches its text for private column names.
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
    -- Name, #rrggbb colour and own-folder logo path of an active agent owner; NULL otherwise.
    'agency', public.agency_branding(t.user_id),
    'flights', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'from_airport', f.from_airport, 'to_airport', f.to_airport,
        'airline', f.airline, 'flight_number', f.flight_number, 'depart_at', f.depart_at,
        'arrive_at', f.arrive_at, 'depart_local', f.depart_local, 'arrive_local', f.arrive_local,
        'from_tz', f.from_tz, 'to_tz', f.to_tz
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
    'transfers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', x.id,
        'kind', CASE WHEN x.kind = 'car_rental' THEN 'car_rental' ELSE 'transfer' END,
        'provider', CASE WHEN length(regexp_replace(normalize(x.provider, NFKC), '[^0-9٠-٩۰-۹[:digit:]]', '', 'g')) >= 7
                              OR normalize(x.provider, NFKC) ~ '@'
                         THEN NULL ELSE NULLIF(btrim(x.provider), '') END,
        'pickup_local', x.pickup_local,
        'return_local', CASE WHEN x.kind = 'car_rental' THEN x.return_local END
      ) ORDER BY x.pickup_local NULLS LAST, x.created_at)
      FROM public.transfers x WHERE x.trip_id = t.id
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

-- Check: must return zero rows -----------------------------------------------------
SELECT 'transfer with pickup_at but no pickup_local' AS problem, id::text AS detail
FROM public.transfers WHERE pickup_at IS NOT NULL AND pickup_local IS NULL
UNION ALL
SELECT 'transfer with return_at but no return_local', id::text
FROM public.transfers WHERE return_at IS NOT NULL AND return_local IS NULL
UNION ALL
-- (A time typed inside Israel's spring-forward gap, e.g. 02:30 on DST night, would also
-- show here: Postgres reads it as 03:30. Harmless — the stored local is what is displayed.)
SELECT 'transfer whose local no longer shows today''s Israel time', id::text
FROM public.transfers
WHERE pickup_local IS DISTINCT FROM (pickup_at AT TIME ZONE 'Asia/Jerusalem')
   OR return_local IS DISTINCT FROM (return_at AT TIME ZONE 'Asia/Jerusalem')
UNION ALL
SELECT 'transfers_local_times trigger missing', ''
WHERE NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.transfers'::regclass AND tgname = 'transfers_local_times' AND NOT tgisinternal)
UNION ALL
SELECT 'flights_local_times trigger missing', ''
WHERE NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.flights'::regclass AND tgname = 'flights_local_times' AND NOT tgisinternal)
UNION ALL
SELECT 'get_shared_trip: anon cannot execute it', ''
WHERE NOT has_function_privilege('anon', 'public.get_shared_trip(text)', 'EXECUTE')
UNION ALL
SELECT 'get_shared_trip exposes', leak
FROM unnest(ARRAY['client_', 'booking_ref', 'seats', 'baggage', 'is_sample', '''notes''', '''participants''', '''documents''',
                  'x.phone', 'x.url', 'x.notes', 'pickup_location', 'dropoff_location', 'x.pickup_at', 'x.return_at']) AS leak
WHERE pg_get_functiondef('public.get_shared_trip(text)'::regprocedure) LIKE '%' || leak || '%'
UNION ALL
SELECT 'get_shared_trip: does not filter image_url to Wikimedia', ''
WHERE pg_get_functiondef('public.get_shared_trip(text)'::regprocedure) NOT LIKE '%wikimedia%'
UNION ALL
SELECT 'get_shared_trip: no local flight times', ''
WHERE pg_get_functiondef('public.get_shared_trip(text)'::regprocedure) NOT LIKE '%depart_local%'
UNION ALL
SELECT 'get_shared_trip: no transfers', ''
WHERE pg_get_functiondef('public.get_shared_trip(text)'::regprocedure) NOT LIKE '%pickup_local%'
UNION ALL
SELECT 'policy for anon', tablename || '.' || policyname
FROM pg_policies WHERE schemaname IN ('public', 'storage') AND 'anon' = ANY (roles)
UNION ALL
SELECT 'grant to anon', table_name || ' ' || privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'anon' AND table_schema = 'public';
