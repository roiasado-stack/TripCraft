-- ============================================================================
-- Flight time zones for EXISTING rows (Design A, docs/plans/2026-11-16-flight-time-zones.md)
--
-- Migration 028 gave every flight its ticket wall clock (depart_local / arrive_local =
-- what an Israeli viewer saw until now) and left the zones NULL. This script sets
-- from_tz / to_tz from the airport text, which fixes durations: with a zone, the
-- flights_local_times trigger recomputes the instant from the local time. The ticket
-- time itself (the local) never moves — the checks in STEP 3 prove it.
--
-- Run by Roi only, in the SQL Editor, one step at a time, AFTER 028 and after the 5c
-- readers are live (old cached clients show depart_at in Israel time; once a row has
-- a zone that instant is the true one, so they'd show e.g. BKK 14:50 as 09:50).
-- Steps 0 and 2 only read flights. Steps 1–2 write only to the private `ops` schema
-- (not exposed through the API). Step 3 writes flights inside BEGIN/COMMIT.
--
-- Rows held back for review (STEP 2 lists them; STEP 3 skips them):
-- - created before 30.9.2026: until 78b64dd (29.9) scanned times were stored as UTC,
--   so their local may be 3h (2h in winter) late — see 2026-10-25-flight-times-3h.md
--   and 2026-10-25-flight-times-prod-fix.sql. Check against the voucher; if it is
--   wrong, set the ticket time directly, e.g.
--     UPDATE public.flights SET depart_local = '2026-10-04 07:40' WHERE id = '…';
--   (the trigger recomputes depart_at), then clear the hold in ops.flight_zone_plan.
-- - both zones known and the new duration ≤ 0 or > 20h: a local typed in the wrong
--   zone (like the WAW 21:40-shown-as-22:40 row). Check the voucher the same way.
-- ============================================================================


-- STEP 0 (read only): every airport text in use. Download the result as CSV
-- ("airports.csv"), then on a machine with the repo:
--   node scripts/flight-zones-values.mjs airports.csv > flight-zone-map.sql
-- It resolves each text with the app's own iataOf() + zoneOf() and prints STEP 1's
-- INSERT. Texts it can't resolve are listed as comments and stay without a zone.
SELECT airport, count(*) AS n
FROM (SELECT from_airport AS airport FROM public.flights
      UNION ALL
      SELECT to_airport FROM public.flights) x
WHERE airport IS NOT NULL AND btrim(airport) <> ''
GROUP BY airport
ORDER BY n DESC, airport;


-- STEP 1 (writes ops only): the map. Paste the whole output of the node script
-- under these two lines and run them together. Read its comment lines first: they
-- list the airport texts left without a zone.
CREATE SCHEMA IF NOT EXISTS ops;
REVOKE ALL ON SCHEMA ops FROM PUBLIC, anon, authenticated;
-- <paste flight-zone-map.sql here>


-- STEP 2 (reads flights, writes ops only): the plan — which zones each row gets, the
-- duration it will show, and why a row is held. Re-run it after any manual fix.
DROP TABLE IF EXISTS ops.flight_zone_plan;
CREATE TABLE ops.flight_zone_plan AS
SELECT f.id, f.trip_id, f.flight_number, f.from_airport, f.to_airport, f.created_at,
       f.depart_local, f.arrive_local,
       f.arrive_at - f.depart_at AS duration_now,
       coalesce(f.from_tz, mf.zone) AS from_tz,
       coalesce(f.to_tz, mt.zone) AS to_tz,
       (f.arrive_local AT TIME ZONE coalesce(f.to_tz, mt.zone, 'Asia/Jerusalem'))
         - (f.depart_local AT TIME ZONE coalesce(f.from_tz, mf.zone, 'Asia/Jerusalem')) AS duration_new,
       CASE
         WHEN f.created_at < '2026-09-30 00:00+03' THEN 'created before 30.9 (may be stored 3h late)'
         WHEN coalesce(f.from_tz, mf.zone) IS NOT NULL AND coalesce(f.to_tz, mt.zone) IS NOT NULL
              AND (f.arrive_local AT TIME ZONE coalesce(f.to_tz, mt.zone))
                  - (f.depart_local AT TIME ZONE coalesce(f.from_tz, mf.zone)) <= interval '0'
           THEN 'new duration <= 0'
         WHEN coalesce(f.from_tz, mf.zone) IS NOT NULL AND coalesce(f.to_tz, mt.zone) IS NOT NULL
              AND (f.arrive_local AT TIME ZONE coalesce(f.to_tz, mt.zone))
                  - (f.depart_local AT TIME ZONE coalesce(f.from_tz, mf.zone)) > interval '20 hours'
           THEN 'new duration > 20h'
       END AS hold
FROM public.flights f
LEFT JOIN ops.flight_zone_map mf ON f.from_tz IS NULL AND mf.airport = f.from_airport
LEFT JOIN ops.flight_zone_map mt ON f.to_tz IS NULL AND mt.airport = f.to_airport
WHERE mf.zone IS NOT NULL OR mt.zone IS NOT NULL;   -- only rows that gain a zone

-- The review report (read only): held rows first, then everything else.
SELECT p.hold, t.title AS trip, p.flight_number, p.from_airport, p.to_airport,
       to_char(p.depart_local, 'YYYY-MM-DD HH24:MI') AS departs_ticket,
       to_char(p.arrive_local, 'YYYY-MM-DD HH24:MI') AS lands_ticket,
       p.from_tz, p.to_tz, p.duration_now, p.duration_new,
       to_char(p.created_at AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD') AS created, p.id
FROM ops.flight_zone_plan p JOIN public.trips t ON t.id = p.trip_id
ORDER BY p.hold IS NULL, p.hold, t.title, p.depart_local;

-- After checking a held row against its voucher (and fixing its local if needed):
-- UPDATE ops.flight_zone_plan SET hold = NULL WHERE id IN ('00000000-0000-0000-0000-000000000000');


-- STEP 3 (writes flights): set the zones of every row in the plan with no hold.
-- Known edge: a ticket time in the hour Israel's clocks fall back (e.g. 25.10.2026
-- 01:00–02:00) is ambiguous; with its zone set, Postgres reads it as the later (+02)
-- instant, so such a row's instant can move by one hour while its shown time stays.
BEGIN;

-- Every row in the plan, held ones too, so the checks can prove held rows stayed as they were.
CREATE TABLE ops.flights_zone_backup_20261116 AS
SELECT f.id, p.hold, f.depart_at, f.arrive_at, f.depart_local, f.arrive_local, f.from_tz, f.to_tz
FROM public.flights f JOIN ops.flight_zone_plan p ON p.id = f.id;

-- Only fills a NULL zone; a zone a writer already stored is kept. The trigger keeps
-- the local and recomputes depart_at / arrive_at from it.
UPDATE public.flights f
SET from_tz = coalesce(f.from_tz, p.from_tz),
    to_tz   = coalesce(f.to_tz, p.to_tz)
FROM ops.flight_zone_plan p
WHERE p.id = f.id AND p.hold IS NULL;

-- Check: must return zero rows. If any row comes back, run ROLLBACK instead of COMMIT.
SELECT 'ticket time moved' AS problem, b.id::text AS detail
FROM ops.flights_zone_backup_20261116 b JOIN public.flights f ON f.id = b.id
WHERE f.depart_local IS DISTINCT FROM b.depart_local OR f.arrive_local IS DISTINCT FROM b.arrive_local
UNION ALL
SELECT 'instant does not follow the local in its zone', f.id::text
FROM ops.flights_zone_backup_20261116 b JOIN public.flights f ON f.id = b.id
WHERE b.hold IS NULL
  AND (f.depart_at IS DISTINCT FROM (f.depart_local AT TIME ZONE coalesce(f.from_tz, 'Asia/Jerusalem'))
       OR f.arrive_at IS DISTINCT FROM (f.arrive_local AT TIME ZONE coalesce(f.to_tz, 'Asia/Jerusalem')))
UNION ALL
SELECT 'zone not set as planned', f.id::text
FROM ops.flight_zone_plan p JOIN public.flights f ON f.id = p.id
WHERE p.hold IS NULL AND (f.from_tz IS DISTINCT FROM p.from_tz OR f.to_tz IS DISTINCT FROM p.to_tz)
UNION ALL
SELECT 'held row was changed', f.id::text
FROM ops.flights_zone_backup_20261116 b JOIN public.flights f ON f.id = b.id
WHERE b.hold IS NOT NULL
  AND (f.depart_at, f.arrive_at, f.from_tz, f.to_tz) IS DISTINCT FROM (b.depart_at, b.arrive_at, b.from_tz, b.to_tz)
UNION ALL
SELECT 'duration <= 0 or > 20h after the change', f.id::text
FROM ops.flights_zone_backup_20261116 b JOIN public.flights f ON f.id = b.id
WHERE b.hold IS NULL AND f.from_tz IS NOT NULL AND f.to_tz IS NOT NULL
  AND (f.arrive_at - f.depart_at <= interval '0' OR f.arrive_at - f.depart_at > interval '20 hours')
UNION ALL
SELECT 'flight with a time but no ticket time', f.id::text
FROM public.flights f
WHERE (f.depart_at IS NOT NULL AND f.depart_local IS NULL) OR (f.arrive_at IS NOT NULL AND f.arrive_local IS NULL);

COMMIT;


-- RESTORE (only if something looks wrong afterwards): puts back the zones and the exact
-- instants. With depart_at changed and the zone back to NULL, the trigger derives the
-- local in Jerusalem time — the value it had before, which the first check confirms.
-- BEGIN;
-- UPDATE public.flights f
-- SET from_tz = b.from_tz, to_tz = b.to_tz, depart_at = b.depart_at, arrive_at = b.arrive_at
-- FROM ops.flights_zone_backup_20261116 b WHERE b.id = f.id AND b.hold IS NULL;
-- SELECT 'not restored', f.id FROM public.flights f JOIN ops.flights_zone_backup_20261116 b ON b.id = f.id
-- WHERE (f.depart_at, f.arrive_at, f.depart_local, f.arrive_local, f.from_tz, f.to_tz)
--       IS DISTINCT FROM (b.depart_at, b.arrive_at, b.depart_local, b.arrive_local, b.from_tz, b.to_tz);
-- COMMIT;

-- CLEANUP (a week later, once the trips look right): DROP SCHEMA ops CASCADE;
