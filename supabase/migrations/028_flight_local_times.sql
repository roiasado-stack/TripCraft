-- ============================================================================
-- 028 — Flight times as printed on the ticket (Design A,
--       docs/plans/2026-11-16-flight-time-zones.md, sub-phase 5b)
--
-- A ticket says "TLV 22:40 → BKK 14:50": each time is the wall clock of its own
-- airport. Until now every writer read that wall clock in the browser's zone
-- (Israel) and stored the instant, so durations across zones were wrong
-- (16h10 instead of 11h10) and a viewer abroad saw other times.
--
-- 1. flights gets the ticket's wall clock and the airports' zones:
--      depart_local / arrive_local  TIMESTAMP (no zone): the time as printed
--      from_tz / to_tz              IANA zone names, NULL = unknown
--    depart_at / arrive_at stay, as true instants, kept in step by a trigger,
--    so everything that orders or compares by them (the n8n reminder,
--    order("depart_at"), the next-flight check) keeps working.
--
-- 2. Trigger flights_local_times (BEFORE INSERT OR UPDATE), per side
--    (departure shown; arrival is the same with arrive_* and to_tz):
--    - depart_local written (insert) or changed (update)
--        → depart_at := depart_local AT TIME ZONE coalesce(from_tz, 'Asia/Jerusalem')
--    - otherwise depart_at written / changed: an old client (cached bundle,
--      import path not yet moved to the new columns)
--        → depart_local := depart_at AT TIME ZONE coalesce(from_tz, 'Asia/Jerusalem')
--      NOTE: an old client builds depart_at from the time the user typed, read as
--      Israel time, and shows it back in Israel time. With no zone on the row
--      (every row old clients create), the Jerusalem wall clock is exactly what
--      that user typed and sees. With a zone set, the old client is showing the
--      true instant in Israel time, so depart_at is kept as written and the
--      local is that instant at the airport.
--    - otherwise from_tz changed → depart_at recomputed from depart_local: the
--      ticket time stays, the instant moves. That is how setting a zone on an
--      existing row fixes its duration.
--    Postgres semantics at DST edges (ticket times are kept as written either way):
--    - a local in a spring-forward gap (27.3.2026 02:30 in Jerusalem doesn't
--      exist) is read with the offset before the jump: 02:30+02 = 03:30+03;
--    - a local in a fall-back fold (25.10.2026 01:30 happens twice) is read as
--      the later of the two instants (standard time, +02).
--    Only the instant (and so a duration) can be off by that hour; the
--    displayed ticket time is the stored local and never moves.
--
-- 3. Zones: a CHECK on the IANA shape (Area/Location, or UTC), and the trigger
--    rejects a well-shaped name Postgres doesn't know ('Mars/Olympus') with a
--    check_violation. A CHECK can't do that itself: zone lookups aren't immutable.
--
-- 4. Backfill: depart_local = depart_at AT TIME ZONE 'Asia/Jerusalem' (same for
--    arrival) on every existing row — exactly what an Israeli viewer sees today,
--    so nothing visibly moves. Zones stay NULL here: guessing them from free
--    text belongs in the reviewed, separate script
--    docs/plans/2026-11-16-flight-zones-backfill.sql (Roi runs it after the
--    readers ship). The backfill runs before the trigger exists, so no instant
--    is touched (a fold-hour instant would otherwise move by an hour).
--
-- 5. get_shared_trip (last defined in 023) also returns arrive_at, the local
--    times and the zones of each flight. Nothing else in it changes.
--
-- clone_showcase_trip (019) copies flights column by column through
-- jsonb_populate_record, so the new columns come along; the trigger then
-- derives the same instants. No RLS change: new columns on an existing table.
--
-- Idempotent. Paste into the SQL Editor after 027.
-- Deploy order: this migration → Edge Functions → web.
-- ============================================================================

-- 1. Columns ------------------------------------------------------------------
ALTER TABLE public.flights ADD COLUMN IF NOT EXISTS depart_local TIMESTAMP;
ALTER TABLE public.flights ADD COLUMN IF NOT EXISTS arrive_local TIMESTAMP;
ALTER TABLE public.flights ADD COLUMN IF NOT EXISTS from_tz TEXT;
ALTER TABLE public.flights ADD COLUMN IF NOT EXISTS to_tz TEXT;

-- 3. Zone shape: "Asia/Bangkok", "America/Argentina/Buenos_Aires", "UTC".
-- Excludes abbreviations ("IST") and POSIX strings ("UTC+3", "Ab/c1"), which Postgres
-- would accept but read in surprising ways. No digits outside Etc/GMT±N: a digit-free
-- name can't parse as a POSIX string, so a failed lookup is never cached (each cached
-- fake name cost ~25 KB of the connection's memory — a demo user could loop it).
ALTER TABLE public.flights DROP CONSTRAINT IF EXISTS flights_from_tz_check;
ALTER TABLE public.flights ADD CONSTRAINT flights_from_tz_check
  CHECK (from_tz IS NULL OR from_tz ~ '^(UTC|Etc/GMT[+-]?([0-9]|1[0-4])|[A-Z][A-Za-z_]+(/[A-Z][A-Za-z_-]*){1,2})$');
ALTER TABLE public.flights DROP CONSTRAINT IF EXISTS flights_to_tz_check;
ALTER TABLE public.flights ADD CONSTRAINT flights_to_tz_check
  CHECK (to_tz IS NULL OR to_tz ~ '^(UTC|Etc/GMT[+-]?([0-9]|1[0-4])|[A-Z][A-Za-z_]+(/[A-Z][A-Za-z_-]*){1,2})$');

-- 2. Trigger ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.flights_local_times()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  z TEXT;
BEGIN
  -- A well-shaped zone Postgres doesn't know is refused like a CHECK would be.
  -- The shape is checked first: this trigger runs before the CHECK constraints, and
  -- looking up a POSIX-like string makes Postgres cache it (see the CHECK above).
  FOREACH z IN ARRAY ARRAY[NEW.from_tz, NEW.to_tz] LOOP
    CONTINUE WHEN z IS NULL;
    IF z !~ '^(UTC|Etc/GMT[+-]?([0-9]|1[0-4])|[A-Z][A-Za-z_]+(/[A-Z][A-Za-z_-]*){1,2})$' THEN
      RAISE EXCEPTION 'unknown time zone: %', z USING ERRCODE = 'check_violation';
    END IF;
    BEGIN
      PERFORM now() AT TIME ZONE z;
    EXCEPTION WHEN invalid_parameter_value THEN
      RAISE EXCEPTION 'unknown time zone: %', z USING ERRCODE = 'check_violation';
    END;
  END LOOP;

  -- Departure
  IF TG_OP = 'INSERT' THEN
    IF NEW.depart_local IS NOT NULL THEN
      NEW.depart_at := NEW.depart_local AT TIME ZONE coalesce(NEW.from_tz, 'Asia/Jerusalem');
    ELSIF NEW.depart_at IS NOT NULL THEN
      NEW.depart_local := NEW.depart_at AT TIME ZONE coalesce(NEW.from_tz, 'Asia/Jerusalem');
    END IF;
  ELSIF NEW.depart_local IS DISTINCT FROM OLD.depart_local THEN
    NEW.depart_at := NEW.depart_local AT TIME ZONE coalesce(NEW.from_tz, 'Asia/Jerusalem');
  ELSIF NEW.depart_at IS DISTINCT FROM OLD.depart_at THEN
    -- Old client: see the NOTE in the header.
    NEW.depart_local := NEW.depart_at AT TIME ZONE coalesce(NEW.from_tz, 'Asia/Jerusalem');
  ELSIF NEW.from_tz IS DISTINCT FROM OLD.from_tz AND NEW.depart_local IS NOT NULL THEN
    NEW.depart_at := NEW.depart_local AT TIME ZONE coalesce(NEW.from_tz, 'Asia/Jerusalem');
  END IF;

  -- Arrival
  IF TG_OP = 'INSERT' THEN
    IF NEW.arrive_local IS NOT NULL THEN
      NEW.arrive_at := NEW.arrive_local AT TIME ZONE coalesce(NEW.to_tz, 'Asia/Jerusalem');
    ELSIF NEW.arrive_at IS NOT NULL THEN
      NEW.arrive_local := NEW.arrive_at AT TIME ZONE coalesce(NEW.to_tz, 'Asia/Jerusalem');
    END IF;
  ELSIF NEW.arrive_local IS DISTINCT FROM OLD.arrive_local THEN
    NEW.arrive_at := NEW.arrive_local AT TIME ZONE coalesce(NEW.to_tz, 'Asia/Jerusalem');
  ELSIF NEW.arrive_at IS DISTINCT FROM OLD.arrive_at THEN
    NEW.arrive_local := NEW.arrive_at AT TIME ZONE coalesce(NEW.to_tz, 'Asia/Jerusalem');
  ELSIF NEW.to_tz IS DISTINCT FROM OLD.to_tz AND NEW.arrive_local IS NOT NULL THEN
    NEW.arrive_at := NEW.arrive_local AT TIME ZONE coalesce(NEW.to_tz, 'Asia/Jerusalem');
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.flights_local_times() FROM PUBLIC, anon, authenticated;

-- 4. Backfill, before the trigger exists (instants stay byte-for-byte) ----------
DROP TRIGGER IF EXISTS flights_local_times ON public.flights;
UPDATE public.flights SET depart_local = depart_at AT TIME ZONE 'Asia/Jerusalem'
WHERE depart_at IS NOT NULL AND depart_local IS NULL;
UPDATE public.flights SET arrive_local = arrive_at AT TIME ZONE 'Asia/Jerusalem'
WHERE arrive_at IS NOT NULL AND arrive_local IS NULL;

CREATE TRIGGER flights_local_times BEFORE INSERT OR UPDATE ON public.flights
  FOR EACH ROW EXECUTE FUNCTION public.flights_local_times();

-- 5. Share page payload (023) + local times and zones of each flight ------------
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
SELECT 'flight with depart_at but no depart_local' AS problem, id::text AS detail
FROM public.flights WHERE depart_at IS NOT NULL AND depart_local IS NULL
UNION ALL
SELECT 'flight with arrive_at but no arrive_local', id::text
FROM public.flights WHERE arrive_at IS NOT NULL AND arrive_local IS NULL
UNION ALL
SELECT 'flight whose local no longer shows today''s Israel time', id::text
FROM public.flights
WHERE from_tz IS NULL AND depart_local IS DISTINCT FROM (depart_at AT TIME ZONE 'Asia/Jerusalem')
   OR to_tz IS NULL AND arrive_local IS DISTINCT FROM (arrive_at AT TIME ZONE 'Asia/Jerusalem')
UNION ALL
SELECT 'flights_local_times trigger missing', ''
WHERE NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.flights'::regclass AND tgname = 'flights_local_times' AND NOT tgisinternal)
UNION ALL
SELECT 'get_shared_trip: anon cannot execute it', ''
WHERE NOT has_function_privilege('anon', 'public.get_shared_trip(text)', 'EXECUTE')
UNION ALL
SELECT 'get_shared_trip exposes', leak
FROM unnest(ARRAY['client_', 'booking_ref', 'seats', 'baggage', '''notes''', '''participants''', '''documents''']) AS leak
WHERE pg_get_functiondef('public.get_shared_trip(text)'::regprocedure) LIKE '%' || leak || '%'
UNION ALL
SELECT 'get_shared_trip: does not filter image_url to Wikimedia', ''
WHERE pg_get_functiondef('public.get_shared_trip(text)'::regprocedure) NOT LIKE '%wikimedia%'
UNION ALL
SELECT 'get_shared_trip: no local flight times', ''
WHERE pg_get_functiondef('public.get_shared_trip(text)'::regprocedure) NOT LIKE '%depart_local%'
UNION ALL
SELECT 'policy for anon', tablename || '.' || policyname
FROM pg_policies WHERE schemaname IN ('public', 'storage') AND 'anon' = ANY (roles)
UNION ALL
SELECT 'grant to anon', table_name || ' ' || privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'anon' AND table_schema = 'public';
