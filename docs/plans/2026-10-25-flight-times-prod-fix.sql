-- Flights / car rentals scanned before the 2026-09-29 fix (78b64dd) were saved 3 hours late
-- (2 in winter): the voucher's local 07:40 was stored as 07:40 UTC.
-- Run in the PRODUCTION SQL Editor by Roi only. Step 1 only reads.

-- STEP 1 (read only): every flight and transfer created up to the day after the fix.
-- shown_now   = what an Israeli user sees today
-- if_fixed    = what they would see after the fix (the stored clock read as Israel time)
-- Compare shown_now with the voucher; if the voucher says if_fixed, that row needs the fix.
SELECT 'flight' AS kind, f.id, t.title AS trip, f.flight_number AS what,
       to_char(f.depart_at AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD HH24:MI') AS shown_now,
       to_char(f.depart_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI')            AS if_fixed,
       to_char(f.created_at AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD HH24:MI') AS created
FROM public.flights f JOIN public.trips t ON t.id = f.trip_id
WHERE f.created_at < '2026-09-30 00:00+03' AND f.depart_at IS NOT NULL
UNION ALL
SELECT 'transfer', x.id, t.title, coalesce(x.provider, x.kind),
       to_char(x.pickup_at AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD HH24:MI'),
       to_char(x.pickup_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'),
       to_char(x.created_at AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD HH24:MI')
FROM public.transfers x JOIN public.trips t ON t.id = x.trip_id
WHERE x.created_at < '2026-09-30 00:00+03' AND x.pickup_at IS NOT NULL
ORDER BY created;

-- STEP 2 (writes): only for the ids you confirmed against the voucher in step 1.
-- Reads the stored clock as Israel time, so summer (−3h) and winter (−2h) are both right.
-- Replace the placeholder ids, run, then re-run step 1 to see shown_now match the vouchers.
-- BEGIN;
-- UPDATE public.flights SET
--   depart_at = (depart_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jerusalem',
--   arrive_at = (arrive_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jerusalem'
-- WHERE id IN ('00000000-0000-0000-0000-000000000000');
-- UPDATE public.transfers SET
--   pickup_at = (pickup_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jerusalem',
--   return_at = (return_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jerusalem'
-- WHERE id IN ('00000000-0000-0000-0000-000000000000');
-- COMMIT;
