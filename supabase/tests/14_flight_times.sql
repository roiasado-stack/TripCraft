-- Flight times as printed on the ticket (migration 028, Design A in
-- docs/plans/2026-11-16-flight-time-zones.md): the flights_local_times trigger,
-- zone validation, the brochure payload, the demo clone, and that who may write a
-- flight is unchanged. Dates in March 2027 are before Israel's DST (26.3.2027):
-- Israel is +02, Bangkok +07, so TLV 22:40 → BKK 14:50 next day is 11h10.

-- New writer: ticket wall clocks + zones → true instants ------------------------------
SELECT pg_temp.login(pg_temp.id('owner'));
INSERT INTO flights (trip_id, flight_number, from_airport, to_airport, depart_local, arrive_local, from_tz, to_tz)
VALUES (pg_temp.id('trip'), 'LY81', 'Tel Aviv (TLV)', 'Bangkok (BKK)',
        '2027-03-10 22:40', '2027-03-11 14:50', 'Asia/Jerusalem', 'Asia/Bangkok');
SELECT pg_temp.check('trigger: TLV 22:40 (+02) departs at 20:40 UTC',
  (SELECT depart_at FROM flights WHERE flight_number = 'LY81') = '2027-03-10 20:40+00');
SELECT pg_temp.check('trigger: BKK 14:50 (+07) lands at 07:50 UTC',
  (SELECT arrive_at FROM flights WHERE flight_number = 'LY81') = '2027-03-11 07:50+00');
SELECT pg_temp.check('trigger: TLV 22:40 → BKK 14:50 lasts 11h10 (not 16h10)',
  (SELECT arrive_at - depart_at FROM flights WHERE flight_number = 'LY81') = interval '11 hours 10 minutes');
SELECT pg_temp.check('trigger: the ticket times are stored as written',
  (SELECT (depart_local, arrive_local)::text FROM flights WHERE flight_number = 'LY81')
    = ('2027-03-10 22:40'::timestamp, '2027-03-11 14:50'::timestamp)::text);

-- Changing the local time moves the instant; clearing it clears the instant.
UPDATE flights SET arrive_local = '2027-03-11 15:20' WHERE flight_number = 'LY81';
SELECT pg_temp.check('trigger: a new arrival local moves arrive_at with the airport''s zone',
  (SELECT arrive_at FROM flights WHERE flight_number = 'LY81') = '2027-03-11 08:20+00');
UPDATE flights SET arrive_local = NULL WHERE flight_number = 'LY81';
SELECT pg_temp.check('trigger: clearing the arrival local clears arrive_at',
  (SELECT arrive_at FROM flights WHERE flight_number = 'LY81') IS NULL);
UPDATE flights SET arrive_local = '2027-03-11 14:50' WHERE flight_number = 'LY81';

-- Setting / changing a zone keeps the ticket time and recomputes the instant.
INSERT INTO flights (trip_id, flight_number, depart_local, arrive_local)
VALUES (pg_temp.id('trip'), 'TG900', '2027-03-12 10:00', '2027-03-12 11:30');
SELECT pg_temp.check('trigger: with no zone the local is read as Jerusalem time',
  (SELECT depart_at FROM flights WHERE flight_number = 'TG900') = '2027-03-12 08:00+00');
UPDATE flights SET from_tz = 'Asia/Bangkok', to_tz = 'Asia/Ho_Chi_Minh' WHERE flight_number = 'TG900';
SELECT pg_temp.check('trigger: setting the zones keeps the ticket times',
  (SELECT (depart_local, arrive_local)::text FROM flights WHERE flight_number = 'TG900')
    = ('2027-03-12 10:00'::timestamp, '2027-03-12 11:30'::timestamp)::text);
SELECT pg_temp.check('trigger: setting the zones recomputes the instants (BKK 10:00 → SGN 11:30 = 1h30)',
  (SELECT depart_at FROM flights WHERE flight_number = 'TG900') = '2027-03-12 03:00+00'
  AND (SELECT arrive_at - depart_at FROM flights WHERE flight_number = 'TG900') = interval '1 hour 30 minutes');

-- Old client: writes depart_at / arrive_at only --------------------------------------
INSERT INTO flights (trip_id, flight_number, depart_at, arrive_at)
VALUES (pg_temp.id('trip'), 'OLD1', '2027-03-10T20:40:00Z', '2027-07-01T05:00:00Z');
SELECT pg_temp.check('old client: depart_local is the Jerusalem wall clock (winter, +02)',
  (SELECT depart_local FROM flights WHERE flight_number = 'OLD1') = '2027-03-10 22:40');
SELECT pg_temp.check('old client: arrive_local is the Jerusalem wall clock (summer, +03)',
  (SELECT arrive_local FROM flights WHERE flight_number = 'OLD1') = '2027-07-01 08:00');
SELECT pg_temp.check('old client: the instants are kept exactly as written, zones stay unknown',
  (SELECT depart_at FROM flights WHERE flight_number = 'OLD1') = '2027-03-10 20:40+00'
  AND (SELECT arrive_at FROM flights WHERE flight_number = 'OLD1') = '2027-07-01 05:00+00'
  AND (SELECT from_tz IS NULL AND to_tz IS NULL FROM flights WHERE flight_number = 'OLD1'));
UPDATE flights SET depart_at = '2027-03-10T21:10:00Z' WHERE flight_number = 'OLD1';
SELECT pg_temp.check('old client: an edited depart_at updates depart_local in Jerusalem time',
  (SELECT depart_local FROM flights WHERE flight_number = 'OLD1') = '2027-03-10 23:10'
  AND (SELECT depart_at FROM flights WHERE flight_number = 'OLD1') = '2027-03-10 21:10+00');
-- On a row that has a zone, the old client shows the true instant in Israel time, so the
-- instant it writes is kept and the local becomes that instant at the airport.
UPDATE flights SET depart_at = '2027-03-12T04:00:00Z' WHERE flight_number = 'TG900';
SELECT pg_temp.check('old client on a zoned row: depart_at kept, depart_local = that instant in BKK',
  (SELECT depart_at FROM flights WHERE flight_number = 'TG900') = '2027-03-12 04:00+00'
  AND (SELECT depart_local FROM flights WHERE flight_number = 'TG900') = '2027-03-12 11:00');
SELECT pg_temp.check('old client: editing another field leaves both times alone',
  pg_temp.try($$UPDATE flights SET airline = 'Thai' WHERE flight_number = 'TG900'$$) = 1
  AND (SELECT (depart_at, depart_local)::text FROM flights WHERE flight_number = 'TG900')
    = ('2027-03-12 04:00+00'::timestamptz, '2027-03-12 11:00'::timestamp)::text);

-- DST edges (Postgres semantics; the stored ticket time never moves) ------------------
INSERT INTO flights (trip_id, flight_number, depart_local, arrive_local, from_tz, to_tz)
VALUES (pg_temp.id('trip'), 'DST1', '2027-03-26 02:30', '2027-10-31 01:30', 'Asia/Jerusalem', 'Asia/Jerusalem');
SELECT pg_temp.check('DST gap: 26.3.2027 02:30 (doesn''t exist) is read with the offset before the jump (+02)',
  (SELECT depart_at FROM flights WHERE flight_number = 'DST1') = '2027-03-26 00:30+00'
  AND (SELECT depart_local FROM flights WHERE flight_number = 'DST1') = '2027-03-26 02:30');
SELECT pg_temp.check('DST fold: 31.10.2027 01:30 (happens twice) is read as the later instant (+02)',
  (SELECT arrive_at FROM flights WHERE flight_number = 'DST1') = '2027-10-30 23:30+00'
  AND (SELECT arrive_local FROM flights WHERE flight_number = 'DST1') = '2027-10-31 01:30');

-- Zones must be real IANA names ---------------------------------------------------------
SELECT pg_temp.check('zone: an unknown well-shaped name is rejected (Mars/Olympus)',
  pg_temp.try($$UPDATE flights SET from_tz = 'Mars/Olympus' WHERE flight_number = 'LY81'$$) = -1);
SELECT pg_temp.check('zone: an abbreviation is rejected (IST)',
  pg_temp.try($$UPDATE flights SET to_tz = 'IST' WHERE flight_number = 'LY81'$$) = -1);
SELECT pg_temp.check('zone: a POSIX offset string is rejected (UTC+3)',
  pg_temp.try($$UPDATE flights SET to_tz = 'UTC+3' WHERE flight_number = 'LY81'$$) = -1);
SELECT pg_temp.check('zone: an invalid zone on insert is rejected',
  pg_temp.try(format($$INSERT INTO flights (trip_id, depart_local, from_tz) VALUES (%L, '2027-03-10 10:00', 'Asia/Atlantis')$$,
    pg_temp.id('trip'))) = -1);
SELECT pg_temp.check('zone: three-part names and UTC are accepted',
  pg_temp.try($$UPDATE flights SET from_tz = 'America/Argentina/Buenos_Aires', to_tz = 'UTC' WHERE flight_number = 'LY81'$$) = 1);
RESET ROLE;

-- Who may write a flight: unchanged (015) ---------------------------------------------
SELECT pg_temp.login(pg_temp.id('participant'));
SELECT pg_temp.check('participant: cannot move a flight''s local time',
  pg_temp.try($$UPDATE flights SET depart_local = '2027-03-10 06:00' WHERE flight_number = 'LY81'$$) = 0);
SELECT pg_temp.check('participant: cannot change a flight''s zone or instant',
  pg_temp.try($$UPDATE flights SET from_tz = 'Asia/Tokyo' WHERE flight_number = 'LY81'$$) = 0
  AND pg_temp.try($$UPDATE flights SET depart_at = now() WHERE flight_number = 'LY81'$$) = 0);
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('viewer'));
SELECT pg_temp.check('viewer: sees the local times but cannot change them',
  (SELECT depart_local FROM flights WHERE flight_number = 'LY81') = '2027-03-10 22:40'
  AND pg_temp.try($$UPDATE flights SET depart_local = '2027-03-10 06:00' WHERE flight_number = 'LY81'$$) = 0);
RESET ROLE;
SELECT pg_temp.check('participant / viewer: the flight is untouched',
  (SELECT depart_at FROM flights WHERE flight_number = 'LY81') = '2027-03-10 20:40+00');
SELECT pg_temp.login(pg_temp.id('editor'));
SELECT pg_temp.check('editor: can set a flight''s local time (the trigger runs for members too)',
  pg_temp.try($$UPDATE flights SET depart_local = '2027-03-10 23:00' WHERE flight_number = 'LY81'$$) = 1);
UPDATE flights SET depart_local = '2027-03-10 23:00' WHERE flight_number = 'LY81';
SELECT pg_temp.check('editor: the instant follows the editor''s local time',
  (SELECT depart_at FROM flights WHERE flight_number = 'LY81') = '2027-03-10 21:00+00');
UPDATE flights SET depart_local = '2027-03-10 22:40' WHERE flight_number = 'LY81';
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('stranger'));
SELECT pg_temp.check('stranger: cannot see or change the trip''s flights',
  (SELECT count(*) FROM flights WHERE trip_id = pg_temp.id('trip')) = 0
  AND pg_temp.try($$UPDATE flights SET depart_local = '2027-03-10 06:00' WHERE flight_number = 'LY81'$$) = 0);
RESET ROLE;
SELECT pg_temp.check('RLS on flights is unchanged: the four 015 policies, nothing for anon',
  (SELECT array_agg(policyname ORDER BY policyname) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'flights')
    = ARRAY['editors delete', 'editors update', 'editors write', 'members read']::name[]
  AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'flights' AND 'anon' = ANY (roles)));

-- Public brochure (anon) ------------------------------------------------------------------
UPDATE flights SET booking_ref = 'SECRET-REF', seats = 'SECRET-SEAT', notes = 'SECRET-NOTE' WHERE flight_number = 'LY81';
SELECT pg_temp.login_anon();
SELECT pg_temp.check('anon: still cannot read the flights table',
  pg_temp.try('SELECT * FROM flights') = -1);
SELECT pg_temp.check('anon: the brochure carries the ticket times, zones and arrival',
  (SELECT f ->> 'depart_local' = '2027-03-10T22:40:00' AND f ->> 'arrive_local' = '2027-03-11T14:50:00'
          AND f ->> 'from_tz' = 'Asia/Jerusalem' AND f ->> 'to_tz' = 'Asia/Bangkok'
          AND (f ->> 'arrive_at')::timestamptz = '2027-03-11 07:50+00'
          AND (f ->> 'depart_at')::timestamptz = '2027-03-10 20:40+00'
     FROM jsonb_array_elements(public.get_shared_trip('test-slug-0123456789') -> 'flights') f
    WHERE f ->> 'flight_number' = 'LY81'));
SELECT pg_temp.check('anon: a brochure flight has exactly the public keys (no booking_ref, seats, notes)',
  (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(
     (SELECT f FROM jsonb_array_elements(public.get_shared_trip('test-slug-0123456789') -> 'flights') f
       WHERE f ->> 'flight_number' = 'LY81')) k)
  = ARRAY['airline', 'arrive_at', 'arrive_local', 'depart_at', 'depart_local', 'flight_number',
          'from_airport', 'from_tz', 'id', 'to_airport', 'to_tz']);
SELECT pg_temp.check('anon: the brochure still leaks no ' || leak,
  position(leak in public.get_shared_trip('test-slug-0123456789')::text) = 0)
FROM unnest(ARRAY['SECRET-REF', 'SECRET-SEAT', 'SECRET-NOTE', 'booking_ref']) AS leak;
RESET ROLE;

-- Demo clone keeps the ticket times and zones ------------------------------------------
UPDATE public.trips SET is_showcase = true WHERE id = pg_temp.id('trip');
SELECT pg_temp.login(pg_temp.id('demo'), true);
CREATE TEMP TABLE clone_out ON COMMIT DROP AS SELECT public.clone_showcase_trip('test-slug-0123456789') AS id;
SELECT pg_temp.check('demo clone: the copied flight keeps local times, zones and the 11h10 duration',
  (SELECT depart_local = '2027-03-10 22:40' AND arrive_local = '2027-03-11 14:50'
          AND from_tz = 'Asia/Jerusalem' AND to_tz = 'Asia/Bangkok'
          AND depart_at = '2027-03-10 20:40+00' AND arrive_at - depart_at = interval '11 hours 10 minutes'
     FROM flights WHERE trip_id = (SELECT id FROM clone_out) AND flight_number = 'LY81'));
SELECT pg_temp.check('demo clone: an old-client row keeps its Jerusalem local times',
  (SELECT depart_local = '2027-03-10 23:10' AND depart_at = '2027-03-10 21:10+00'
     FROM flights WHERE trip_id = (SELECT id FROM clone_out) AND flight_number = 'OLD1'));
SELECT pg_temp.check('demo clone: booking details are still blanked',
  (SELECT booking_ref IS NULL AND seats IS NULL AND notes IS NULL
     FROM flights WHERE trip_id = (SELECT id FROM clone_out) AND flight_number = 'LY81'));
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);  -- the demo's sub would trip the owner-only guard
UPDATE public.trips SET is_showcase = false WHERE id = pg_temp.id('trip');

-- An agency trip and an ordinary user's trip behave the same --------------------------
INSERT INTO auth.users (id, email, aud, role, is_anonymous) VALUES
  ('00000000-0000-0000-0000-0000000000a7', 'agent-tz@test.local', 'authenticated', 'authenticated', false);
INSERT INTO ids VALUES
  ('agent',      '00000000-0000-0000-0000-0000000000a7'),
  ('agent_trip', '10000000-0000-0000-0000-0000000000a7'),
  ('plain_trip', '10000000-0000-0000-0000-0000000000f7');
INSERT INTO public.user_roles (user_id, role) VALUES (pg_temp.id('agent'), 'agent');
INSERT INTO public.agent_accounts (user_id, status, agency_name, phone) VALUES (pg_temp.id('agent'), 'active', 'Agency TZ', '050-7777777');
INSERT INTO public.trips (id, user_id, title, destination) VALUES
  (pg_temp.id('agent_trip'), pg_temp.id('agent'),    'Agency trip', 'Bangkok'),
  (pg_temp.id('plain_trip'), pg_temp.id('stranger'), 'Plain trip',  'Bangkok');
SELECT pg_temp.login(pg_temp.id('agent'));
INSERT INTO flights (trip_id, flight_number, depart_local, arrive_local, from_tz, to_tz, depart_at)
VALUES (pg_temp.id('agent_trip'), 'CMP1', '2027-03-10 22:40', '2027-03-11 14:50', 'Asia/Jerusalem', 'Asia/Bangkok', now());
INSERT INTO flights (trip_id, flight_number, depart_at) VALUES (pg_temp.id('agent_trip'), 'CMP2', '2027-03-10T20:40:00Z');
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('stranger'));
INSERT INTO flights (trip_id, flight_number, depart_local, arrive_local, from_tz, to_tz, depart_at)
VALUES (pg_temp.id('plain_trip'), 'CMP1', '2027-03-10 22:40', '2027-03-11 14:50', 'Asia/Jerusalem', 'Asia/Bangkok', now());
INSERT INTO flights (trip_id, flight_number, depart_at) VALUES (pg_temp.id('plain_trip'), 'CMP2', '2027-03-10T20:40:00Z');
RESET ROLE;
SELECT pg_temp.check('agency vs ordinary trip: a local written with a stray depart_at — the local wins on both',
  (SELECT count(DISTINCT (depart_at, arrive_at, depart_local, arrive_local)) FROM flights
    WHERE flight_number = 'CMP1' AND trip_id IN (pg_temp.id('agent_trip'), pg_temp.id('plain_trip'))) = 1
  AND (SELECT bool_and(depart_at = '2027-03-10 20:40+00') FROM flights WHERE flight_number = 'CMP1'));
SELECT pg_temp.check('agency vs ordinary trip: an old-client write gets the same Jerusalem local on both',
  (SELECT count(*) FROM flights WHERE flight_number = 'CMP2' AND depart_local = '2027-03-10 22:40') = 2);
