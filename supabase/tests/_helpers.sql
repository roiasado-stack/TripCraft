-- ============================================================================
-- Shared setup for every supabase/tests/*.sql file. scripts/test-db.mjs pastes
-- this in front of each test file and runs the pair inside one transaction
-- that is always rolled back, so tests never leave rows behind.
--
--   pg_temp.login(uid [, anonymous])  act as a signed-in user (RLS applies)
--   pg_temp.login_anon()              act as a logged-out visitor (role anon)
--   RESET ROLE;                       back to postgres (no RLS) for fixtures
--   pg_temp.try('<sql>')              rows affected, then rolled back;
--                                     -1 when rejected (42501: grant, RLS or guard
--                                     trigger; or a CHECK constraint)
--   pg_temp.check('label', bool)      fails the file with the label if false
-- ============================================================================

CREATE FUNCTION pg_temp.login(uid UUID, anonymous BOOLEAN DEFAULT false) RETURNS VOID
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'is_anonymous', anonymous)::text, true);
  SELECT set_config('role', 'authenticated', true);
$$;

CREATE FUNCTION pg_temp.login_anon() RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SELECT set_config('role', 'anon', true);
$$;

CREATE FUNCTION pg_temp.try(stmt TEXT) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  BEGIN
    EXECUTE stmt;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION 'undo' USING ERRCODE = 'ZZ001';
  EXCEPTION
    WHEN SQLSTATE 'ZZ001' THEN RETURN n;
    WHEN insufficient_privilege OR check_violation THEN RETURN -1;
  END;
END $$;

CREATE FUNCTION pg_temp.check(label TEXT, ok BOOLEAN) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF;
  RAISE NOTICE 'ok   %', label;
END $$;

-- The session's temp schema is created by the first CREATE above; let the
-- API roles call the helpers once a test switches to them.
DO $$ BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO authenticated, anon', pg_my_temp_schema()::regnamespace);
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, anon;

-- Fixture: one trip and one person per role ------------------------------------
-- Fixed ids so a failing label can be traced by hand.
INSERT INTO auth.users (id, email, aud, role, is_anonymous) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'owner@test.local',       'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-00000000000e', 'editor@test.local',      'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-00000000000b', 'participant@test.local', 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-00000000000c', 'viewer@test.local',      'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-00000000000d', 'pending@test.local',     'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-0000000000a1', 'removed@test.local',     'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-0000000000f1', 'stranger@test.local',    'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-0000000000d1', NULL,                     'authenticated', 'authenticated', true);

CREATE TEMP TABLE ids (k TEXT PRIMARY KEY, id UUID) ON COMMIT DROP;
INSERT INTO ids VALUES
  ('owner',       '00000000-0000-0000-0000-00000000000a'),
  ('editor',      '00000000-0000-0000-0000-00000000000e'),
  ('participant', '00000000-0000-0000-0000-00000000000b'),
  ('viewer',      '00000000-0000-0000-0000-00000000000c'),
  ('pending',     '00000000-0000-0000-0000-00000000000d'),
  ('removed',     '00000000-0000-0000-0000-0000000000a1'),
  ('stranger',    '00000000-0000-0000-0000-0000000000f1'),
  ('demo',        '00000000-0000-0000-0000-0000000000d1'),
  ('trip',        '10000000-0000-0000-0000-000000000001'),
  ('demo_trip',   '10000000-0000-0000-0000-000000000002');
GRANT SELECT ON ids TO authenticated, anon;

CREATE FUNCTION pg_temp.id(k TEXT) RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT id FROM ids WHERE ids.k = $1
$$;
GRANT EXECUTE ON FUNCTION pg_temp.id(TEXT) TO authenticated, anon;

INSERT INTO public.trips (id, user_id, title, destination, is_shared, share_slug, guide_phone, notes) VALUES
  (pg_temp.id('trip'), pg_temp.id('owner'), 'Test trip', 'Rome', true, 'test-slug-0123456789', '050-0000000', 'OWNER NOTES'),
  (pg_temp.id('demo_trip'), pg_temp.id('demo'), 'Demo trip', 'Paris', false, NULL, NULL, NULL);

INSERT INTO public.trip_members (trip_id, user_id, role, status) VALUES
  (pg_temp.id('trip'), pg_temp.id('editor'),      'editor',      'active'),
  (pg_temp.id('trip'), pg_temp.id('participant'), 'participant', 'active'),
  (pg_temp.id('trip'), pg_temp.id('viewer'),      'viewer',      'active'),
  (pg_temp.id('trip'), pg_temp.id('pending'),     'editor',      'pending'),
  (pg_temp.id('trip'), pg_temp.id('removed'),     'editor',      'removed');

INSERT INTO public.trip_invites (trip_id, role, token, requires_approval, created_by) VALUES
  (pg_temp.id('trip'), 'editor', 'test-invite-token', false, pg_temp.id('owner'));

INSERT INTO public.participants (trip_id, name, age) VALUES (pg_temp.id('trip'), 'PARTICIPANT NAME', 40);
-- Every private field carries a SECRET-* marker; 03 asserts none reaches the brochure.
INSERT INTO public.flights (trip_id, airline, flight_number, booking_ref, seats, notes) VALUES
  (pg_temp.id('trip'), 'EL AL', 'LY381', 'SECRET-REF', 'SECRET-SEAT', 'SECRET-NOTE');
INSERT INTO public.stays (trip_id, hotel_name, booking_ref, phone, notes) VALUES
  (pg_temp.id('trip'), 'Hotel Roma', 'SECRET-REF', 'SECRET-PHONE', 'SECRET-NOTE');
INSERT INTO public.transfers (trip_id, provider, booking_ref, phone, notes) VALUES
  (pg_temp.id('trip'), 'Taxi Roma', 'SECRET-REF', 'SECRET-PHONE', 'SECRET-NOTE');
INSERT INTO public.itinerary_items (trip_id, day_date, title) VALUES (pg_temp.id('trip'), '2026-11-01', 'Vatican');
INSERT INTO public.suggestions (trip_id, title) VALUES (pg_temp.id('trip'), 'Colosseum');
INSERT INTO public.checklist_items (trip_id, title, is_shared, created_by) VALUES
  (pg_temp.id('trip'), 'shared item',  true,  pg_temp.id('owner')),
  (pg_temp.id('trip'), 'owner private', false, pg_temp.id('owner'));
INSERT INTO public.documents (trip_id, name, storage_path, uploaded_by, visibility) VALUES
  (pg_temp.id('trip'), 'private passport', '00000000-0000-0000-0000-00000000000a/p.pdf', pg_temp.id('owner'), 'private'),
  (pg_temp.id('trip'), 'members voucher',  '00000000-0000-0000-0000-00000000000a/v.pdf', pg_temp.id('owner'), 'members');
INSERT INTO public.trip_chat_messages (trip_id, role, content, user_id) VALUES
  (pg_temp.id('trip'), 'user', 'owner question', pg_temp.id('owner'));
