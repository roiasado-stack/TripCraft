-- Transfers at the voucher's time, and on the share page (migration 032,
-- docs/plans/2026-11-28-share-transfers.md): the transfers_local_times trigger, old
-- clients, who may write, the brochure payload (anon, exact keys, nothing private,
-- nothing for an unshared trip) and the demo clone. March 2027 is before Israel's
-- DST (26.3.2027), so Israel is +02 there; July is +03.

-- New writer: the voucher's wall clock → the ordering instant (read as Israel time) ---
SELECT pg_temp.login(pg_temp.id('owner'));
INSERT INTO transfers (trip_id, kind, provider, pickup_location, dropoff_location, pickup_local, booking_ref, phone, url, notes)
VALUES (pg_temp.id('trip'), 'transfer', 'Sun Boats', 'SECRET-PICKUP', 'SECRET-DROPOFF', '2027-03-12 14:00',
        'SECRET-REF', 'SECRET-PHONE', 'https://x.test/SECRET-URL', 'SECRET-NOTE');
SELECT pg_temp.check('trigger: pickup 14:00 is stored as written',
  (SELECT pickup_local FROM transfers WHERE provider = 'Sun Boats') = '2027-03-12 14:00');
SELECT pg_temp.check('trigger: pickup_at is that wall clock in Israel time (12:00 UTC)',
  (SELECT pickup_at FROM transfers WHERE provider = 'Sun Boats') = '2027-03-12 12:00+00');
INSERT INTO transfers (trip_id, kind, provider, pickup_local, return_local)
VALUES (pg_temp.id('trip'), 'car_rental', 'Hertz Mahe', '2027-03-10 10:00', '2027-07-01 18:00');
SELECT pg_temp.check('trigger: a car rental''s return is derived too (summer, +03)',
  (SELECT return_at FROM transfers WHERE provider = 'Hertz Mahe') = '2027-07-01 15:00+00'
  AND (SELECT return_local FROM transfers WHERE provider = 'Hertz Mahe') = '2027-07-01 18:00');

UPDATE transfers SET pickup_local = '2027-03-12 15:30' WHERE provider = 'Sun Boats';
SELECT pg_temp.check('trigger: a new local moves the instant',
  (SELECT pickup_at FROM transfers WHERE provider = 'Sun Boats') = '2027-03-12 13:30+00');
UPDATE transfers SET pickup_local = NULL WHERE provider = 'Sun Boats';
SELECT pg_temp.check('trigger: clearing the local clears the instant',
  (SELECT pickup_at FROM transfers WHERE provider = 'Sun Boats') IS NULL);
UPDATE transfers SET pickup_local = '2027-03-12 14:00' WHERE provider = 'Sun Boats';
SELECT pg_temp.check('trigger: editing another field leaves both times alone',
  pg_temp.try($$UPDATE transfers SET provider = 'Sun Boats' WHERE provider = 'Sun Boats'$$) = 1
  AND (SELECT (pickup_local, pickup_at)::text FROM transfers WHERE provider = 'Sun Boats')
    = ('2027-03-12 14:00'::timestamp, '2027-03-12 12:00+00'::timestamptz)::text);
INSERT INTO transfers (trip_id, provider, pickup_local, pickup_at)
VALUES (pg_temp.id('trip'), 'Stray', '2027-03-12 09:00', now());
SELECT pg_temp.check('trigger: a local written with a stray pickup_at — the local wins',
  (SELECT pickup_at FROM transfers WHERE provider = 'Stray') = '2027-03-12 07:00+00');

-- Old client: writes pickup_at / return_at only ------------------------------------------
INSERT INTO transfers (trip_id, kind, provider, pickup_at, return_at)
VALUES (pg_temp.id('trip'), 'car_rental', 'Old Client', '2027-03-10T08:00:00Z', '2027-07-01T05:00:00Z');
SELECT pg_temp.check('old client: the locals are the Jerusalem wall clock (winter +02, summer +03)',
  (SELECT pickup_local FROM transfers WHERE provider = 'Old Client') = '2027-03-10 10:00'
  AND (SELECT return_local FROM transfers WHERE provider = 'Old Client') = '2027-07-01 08:00');
SELECT pg_temp.check('old client: the instants are kept exactly as written',
  (SELECT pickup_at FROM transfers WHERE provider = 'Old Client') = '2027-03-10 08:00+00'
  AND (SELECT return_at FROM transfers WHERE provider = 'Old Client') = '2027-07-01 05:00+00');
UPDATE transfers SET pickup_at = '2027-03-10T08:45:00Z' WHERE provider = 'Old Client';
SELECT pg_temp.check('old client: an edited pickup_at updates the local in Jerusalem time',
  (SELECT pickup_local FROM transfers WHERE provider = 'Old Client') = '2027-03-10 10:45');
RESET ROLE;

-- Who may write a transfer's time: unchanged (015) ----------------------------------------
SELECT pg_temp.login(pg_temp.id('participant'));
SELECT pg_temp.check('participant: cannot move a transfer''s local time or instant',
  pg_temp.try($$UPDATE transfers SET pickup_local = '2027-03-12 06:00' WHERE provider = 'Sun Boats'$$) = 0
  AND pg_temp.try($$UPDATE transfers SET pickup_at = now() WHERE provider = 'Sun Boats'$$) = 0);
SELECT pg_temp.check('participant: cannot insert a transfer with a local time',
  pg_temp.try(format($$INSERT INTO transfers (trip_id, provider, pickup_local) VALUES (%L, 'PX', '2027-03-12 08:00')$$,
                     pg_temp.id('trip'))) = -1);
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('viewer'));
SELECT pg_temp.check('viewer: sees the local time but cannot change it',
  (SELECT pickup_local FROM transfers WHERE provider = 'Sun Boats') = '2027-03-12 14:00'
  AND pg_temp.try($$UPDATE transfers SET pickup_local = '2027-03-12 06:00' WHERE provider = 'Sun Boats'$$) = 0);
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('editor'));
SELECT pg_temp.check('editor: can set a transfer''s local time (the trigger runs for members too)',
  pg_temp.try($$UPDATE transfers SET pickup_local = '2027-03-12 16:00' WHERE provider = 'Sun Boats'$$) = 1);
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('stranger'));
SELECT pg_temp.check('stranger: cannot see or change the trip''s transfers',
  (SELECT count(*) FROM transfers WHERE trip_id = pg_temp.id('trip')) = 0
  AND pg_temp.try($$UPDATE transfers SET pickup_local = '2027-03-12 06:00' WHERE provider = 'Sun Boats'$$) = 0);
RESET ROLE;
SELECT pg_temp.check('RLS on transfers is unchanged and has nothing for anon',
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transfers' AND 'anon' = ANY (roles))
  AND NOT has_table_privilege('anon', 'public.transfers', 'SELECT'));

-- Public brochure (anon) -------------------------------------------------------------------
-- A provider field holding a driver's mobile, and a kind outside the two the app writes.
INSERT INTO transfers (trip_id, kind, provider, pickup_local)
VALUES (pg_temp.id('trip'), 'ferry', 'Driver Yossi 050-1234567', '2027-03-11 07:15');
SELECT pg_temp.login_anon();
SELECT pg_temp.check('anon: still cannot read the transfers table',
  pg_temp.try('SELECT * FROM transfers') = -1);
SELECT pg_temp.check('anon: the brochure lists every transfer of the shared trip',
  jsonb_array_length(public.get_shared_trip('test-slug-0123456789') -> 'transfers') = 6);
SELECT pg_temp.check('anon: the boat shows the voucher''s 14:00, whatever the visitor''s zone',
  (SELECT x ->> 'pickup_local' = '2027-03-12T14:00:00' AND x ->> 'kind' = 'transfer'
     FROM jsonb_array_elements(public.get_shared_trip('test-slug-0123456789') -> 'transfers') x
    WHERE x ->> 'provider' = 'Sun Boats'));
SELECT pg_temp.check('anon: a brochure transfer has exactly the public keys',
  (SELECT bool_and(k = ARRAY['id', 'kind', 'pickup_local', 'provider', 'return_local'])
     FROM (SELECT array_agg(k ORDER BY k) AS k
             FROM jsonb_array_elements(public.get_shared_trip('test-slug-0123456789') -> 'transfers') WITH ORDINALITY AS e(x, n),
                  jsonb_object_keys(e.x) k
            GROUP BY e.n) per_row));
SELECT pg_temp.check('anon: the brochure leaks no ' || leak,
  position(leak in public.get_shared_trip('test-slug-0123456789')::text) = 0)
FROM unnest(ARRAY['SECRET-REF', 'SECRET-PHONE', 'SECRET-NOTE', 'SECRET-URL', 'SECRET-PICKUP', 'SECRET-DROPOFF',
                  'pickup_location', 'dropoff_location', 'booking_ref', 'pickup_at', '050-1234567']) AS leak;
SELECT pg_temp.check('anon: a provider holding a phone number is dropped, its time still shown',
  (SELECT x -> 'provider' = 'null'::jsonb AND x ->> 'pickup_local' = '2027-03-11T07:15:00'
     FROM jsonb_array_elements(public.get_shared_trip('test-slug-0123456789') -> 'transfers') x
    WHERE x ->> 'pickup_local' = '2027-03-11T07:15:00'));
SELECT pg_temp.check('anon: an unknown kind is shown as a transfer',
  (SELECT x ->> 'kind' FROM jsonb_array_elements(public.get_shared_trip('test-slug-0123456789') -> 'transfers') x
    WHERE x ->> 'pickup_local' = '2027-03-11T07:15:00') = 'transfer');
SELECT pg_temp.check('anon: a car rental carries its return time; a transfer never does',
  (SELECT x ->> 'return_local' FROM jsonb_array_elements(public.get_shared_trip('test-slug-0123456789') -> 'transfers') x
    WHERE x ->> 'provider' = 'Hertz Mahe') = '2027-07-01T18:00:00'
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.get_shared_trip('test-slug-0123456789') -> 'transfers') x
                   WHERE x ->> 'kind' = 'transfer' AND x -> 'return_local' <> 'null'::jsonb));
SELECT pg_temp.check('anon: transfers come in voucher-time order, undated ones last',
  (SELECT array_agg(coalesce(x ->> 'provider', '-') ORDER BY n)
     FROM jsonb_array_elements(public.get_shared_trip('test-slug-0123456789') -> 'transfers') WITH ORDINALITY AS e(x, n))
  = ARRAY['Hertz Mahe', 'Old Client', '-', 'Stray', 'Sun Boats', 'Taxi Roma']);
RESET ROLE;

-- Nothing for a trip that isn't shared --------------------------------------------------
INSERT INTO ids VALUES ('private_trip', '10000000-0000-0000-0000-0000000000c2');
INSERT INTO public.trips (id, user_id, title, destination, is_shared, share_slug) VALUES
  (pg_temp.id('private_trip'), pg_temp.id('owner'), 'Private trip', 'Mahe', false, 'private-slug-0123456789');
INSERT INTO transfers (trip_id, provider, pickup_local) VALUES (pg_temp.id('private_trip'), 'PRIVATE-FERRY', '2027-03-12 11:00');
SELECT pg_temp.login_anon();
SELECT pg_temp.check('anon: an unshared trip with a slug returns nothing',
  public.get_shared_trip('private-slug-0123456789') IS NULL);
SELECT pg_temp.check('anon: another trip''s transfer never reaches a shared brochure',
  position('PRIVATE-FERRY' in public.get_shared_trip('test-slug-0123456789')::text) = 0);
SELECT pg_temp.check('anon: a wrong or short slug returns nothing',
  public.get_shared_trip('test-slug-0123456788') IS NULL AND public.get_shared_trip('test-slug') IS NULL);
RESET ROLE;
UPDATE public.trips SET is_shared = false WHERE id = pg_temp.id('trip');
SELECT pg_temp.login_anon();
SELECT pg_temp.check('anon: once sharing is turned off, the transfers are gone with the trip',
  public.get_shared_trip('test-slug-0123456789') IS NULL);
RESET ROLE;
UPDATE public.trips SET is_shared = true WHERE id = pg_temp.id('trip');

-- Demo clone keeps the voucher times, blanks the booking details ---------------------------
UPDATE public.trips SET is_showcase = true WHERE id = pg_temp.id('trip');
SELECT pg_temp.login(pg_temp.id('demo'), true);
CREATE TEMP TABLE clone_out ON COMMIT DROP AS SELECT public.clone_showcase_trip('test-slug-0123456789') AS id;
SELECT pg_temp.check('demo clone: the copied boat keeps its local time and instant',
  (SELECT pickup_local = '2027-03-12 14:00' AND pickup_at = '2027-03-12 12:00+00'
     FROM transfers WHERE trip_id = (SELECT id FROM clone_out) AND provider = 'Sun Boats'));
SELECT pg_temp.check('demo clone: an old-client row keeps its Jerusalem local times',
  (SELECT pickup_local = '2027-03-10 10:45' AND return_local = '2027-07-01 08:00'
     FROM transfers WHERE trip_id = (SELECT id FROM clone_out) AND provider = 'Old Client'));
SELECT pg_temp.check('demo clone: booking number, phone, link and notes are blanked',
  (SELECT booking_ref IS NULL AND phone IS NULL AND url IS NULL AND notes IS NULL
     FROM transfers WHERE trip_id = (SELECT id FROM clone_out) AND provider = 'Sun Boats'));
SELECT pg_temp.check('demo user: cannot change the real trip''s transfer times',
  pg_temp.try($$UPDATE transfers SET pickup_local = '2027-03-10 06:00' WHERE trip_id = pg_temp.id('trip')$$) = 0);
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);  -- the demo's sub would trip the owner-only guard
UPDATE public.trips SET is_showcase = false WHERE id = pg_temp.id('trip');

-- Provider filter (review fix): digits are counted, not matched as a run --------------------
-- Every separator a phone number can hide behind, other digit scripts, and an email are
-- dropped; a provider with a few digits of its own ("24/7") is kept as entered.
INSERT INTO transfers (trip_id, provider, pickup_local) VALUES
  (pg_temp.id('trip'), 'PF-EN-DASH 050–123–4567', '2027-04-01 10:00'),
  (pg_temp.id('trip'), E'PF-NBSP 050 123 4567', '2027-04-01 10:01'),
  (pg_temp.id('trip'), 'PF-SLASH 050/123/4567', '2027-04-01 10:02'),
  (pg_temp.id('trip'), 'PF-UNDERSCORE 050_123_4567', '2027-04-01 10:03'),
  (pg_temp.id('trip'), 'PF-ARABIC ٠٥٠١٢٣٤٥٦٧', '2027-04-01 10:04'),
  (pg_temp.id('trip'), 'PF-PERSIAN ۰۵۰۱۲۳۴۵۶۷', '2027-04-01 10:05'),
  (pg_temp.id('trip'), 'PF-EMAIL driver@example.com', '2027-04-01 10:06'),
  (pg_temp.id('trip'), 'Europcar 24/7', '2027-04-01 10:07');
SELECT pg_temp.login_anon();
SELECT pg_temp.check('anon: provider dropped (' || leak || ')',
  position(leak in public.get_shared_trip('test-slug-0123456789')::text) = 0)
FROM unnest(ARRAY['PF-EN-DASH', 'PF-NBSP', 'PF-SLASH', 'PF-UNDERSCORE', 'PF-ARABIC', 'PF-PERSIAN', 'PF-EMAIL',
                  '4567', '٤٥٦٧', '۴۵۶۷', 'driver@example.com']) AS leak;
SELECT pg_temp.check('anon: the dropped providers'' transfers still show, with their times',
  (SELECT count(*) FROM jsonb_array_elements(public.get_shared_trip('test-slug-0123456789') -> 'transfers') x
    WHERE x ->> 'pickup_local' LIKE '2027-04-01T10:0%' AND x -> 'provider' = 'null'::jsonb) = 7);
SELECT pg_temp.check('anon: a provider with a few digits of its own is kept as entered (Europcar 24/7)',
  EXISTS (SELECT 1 FROM jsonb_array_elements(public.get_shared_trip('test-slug-0123456789') -> 'transfers') x
           WHERE x ->> 'provider' = 'Europcar 24/7' AND x ->> 'pickup_local' = '2027-04-01T10:07:00'));
RESET ROLE;
