-- A private account owns one trip (migration 029): what counts, what doesn't,
-- the ways around it that must stay closed, and the users it must not touch
-- (agents, admins, demo visitors, members of someone else's trip).

-- Fixture -------------------------------------------------------------------------------
INSERT INTO auth.users (id, email, aud, role, is_anonymous) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'private@test.local', 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-0000000000c2', 'agent@test.local',   'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-0000000000c3', 'admin@test.local',   'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-0000000000c4', 'asker@test.local',   'authenticated', 'authenticated', false);
INSERT INTO ids VALUES
  ('private', '00000000-0000-0000-0000-0000000000c1'),
  ('agent',   '00000000-0000-0000-0000-0000000000c2'),
  ('admin',   '00000000-0000-0000-0000-0000000000c3'),
  ('asker',   '00000000-0000-0000-0000-0000000000c4'),
  ('plain',   '10000000-0000-0000-0000-0000000000c1');
INSERT INTO public.user_roles (user_id, role) VALUES (pg_temp.id('agent'), 'agent'), (pg_temp.id('admin'), 'admin');
INSERT INTO public.agent_accounts (user_id, status, agency_name) VALUES (pg_temp.id('agent'), 'active', 'Agency C');
-- The fixture trip becomes a showcase; 'plain' is somebody's ordinary shared trip.
INSERT INTO public.trips (id, user_id, title, destination, is_shared, share_slug)
VALUES (pg_temp.id('plain'), pg_temp.id('agent'), 'Plain', 'Oslo', true, 'plain-slug-0123456789');
UPDATE public.trips SET is_showcase = true WHERE id = pg_temp.id('plain');

-- A new private user ---------------------------------------------------------------------
SELECT pg_temp.login(pg_temp.id('private'));
SELECT pg_temp.check('private: quota starts at 1 allowed, 0 used, no sample',
  public.my_trip_quota() = '{"limit": 1, "used": 0, "has_sample": false}'::jsonb);
INSERT INTO trips (user_id, title, destination) VALUES (pg_temp.id('private'), 'first', 'Rome');
SELECT pg_temp.check('private: the second trip is blocked',
  pg_temp.try(format('INSERT INTO trips (user_id, title, destination) VALUES (%L, %L, %L)', pg_temp.id('private'), 'second', 'x')) = -1);
SELECT pg_temp.check('private: a template is a trip too (no bypass through is_template)',
  pg_temp.try(format('INSERT INTO trips (user_id, title, destination, is_template) VALUES (%L, %L, %L, true)', pg_temp.id('private'), 'tpl', 'x')) = -1);
SELECT pg_temp.check('private: a trip that already ended still counts',
  pg_temp.try(format('INSERT INTO trips (user_id, title, destination, end_date) VALUES (%L, %L, %L, current_date - 30)', pg_temp.id('private'), 'old', 'x')) = -1);

DO $$ BEGIN
  INSERT INTO public.trips (user_id, title, destination) VALUES (pg_temp.id('private'), 'second', 'x');
  RAISE EXCEPTION 'FAIL: private: the second trip raises private_trip_limit_reached';
EXCEPTION WHEN check_violation THEN
  IF SQLERRM <> 'private_trip_limit_reached' THEN RAISE EXCEPTION 'FAIL: wrong error %', SQLERRM; END IF;
  RAISE NOTICE 'ok   private: the second trip raises private_trip_limit_reached';
END $$;

-- The sample trip is free, once
INSERT INTO trips (user_id, title, destination, is_sample) VALUES (pg_temp.id('private'), 'sample', 'Rhodes', true);
SELECT pg_temp.check('private: a second sample is blocked',
  pg_temp.try(format('INSERT INTO trips (user_id, title, destination, is_sample) VALUES (%L, %L, %L, true)', pg_temp.id('private'), 'sample2', 'x')) = -1);

-- A showcase copy is free, once per showcase, and only a real one
SELECT pg_temp.check('private: "try it yourself" copy of a showcase works at the limit',
  public.clone_showcase_trip('plain-slug-0123456789') IS NOT NULL);
SELECT pg_temp.check('private: asking again returns the same copy',
  public.clone_showcase_trip('plain-slug-0123456789') = (SELECT id FROM trips WHERE user_id = pg_temp.id('private') AND demo_source_id IS NOT NULL));
SELECT pg_temp.check('private: a forged copy of a non-showcase trip is rejected',
  pg_temp.try(format('INSERT INTO trips (user_id, title, destination, demo_source_id) VALUES (%L, %L, %L, %L)',
    pg_temp.id('private'), 'forged', 'x', pg_temp.id('trip'))) = -1);
SELECT pg_temp.check('private: a forged copy of a random id is rejected',
  pg_temp.try(format('INSERT INTO trips (user_id, title, destination, demo_source_id) VALUES (%L, %L, %L, gen_random_uuid())',
    pg_temp.id('private'), 'forged', 'x')) = -1);
SELECT pg_temp.check('private: a second copy of the same showcase is rejected',
  pg_temp.try(format('INSERT INTO trips (user_id, title, destination, demo_source_id) VALUES (%L, %L, %L, %L)',
    pg_temp.id('private'), 'copy2', 'x', pg_temp.id('plain'))) = -1);
SELECT pg_temp.check('private: a sample that claims to be a copy is rejected',
  pg_temp.try(format('INSERT INTO trips (user_id, title, destination, is_sample, demo_source_id) VALUES (%L, %L, %L, true, %L)',
    pg_temp.id('private'), 'both', 'x', pg_temp.id('plain'))) = -1);

SELECT pg_temp.check('private: quota now shows 1 used and the sample',
  public.my_trip_quota() = '{"limit": 1, "used": 1, "has_sample": true}'::jsonb);

-- Updates that would turn a counted trip into an uncounted one
SELECT pg_temp.check('private: cannot mark the real trip as a showcase copy',
  pg_temp.try(format('UPDATE trips SET demo_source_id = %L WHERE user_id = %L AND title = %L',
    pg_temp.id('trip'), pg_temp.id('private'), 'first')) = -1);
SELECT pg_temp.check('private: cannot mark the real trip as the sample',
  pg_temp.try(format('UPDATE trips SET is_sample = true WHERE user_id = %L AND title = %L', pg_temp.id('private'), 'first')) = -1);
SELECT pg_temp.check('private: cannot clear demo_source_id on the copy',
  pg_temp.try(format('UPDATE trips SET demo_source_id = NULL WHERE user_id = %L AND demo_source_id IS NOT NULL', pg_temp.id('private'))) = -1);
SELECT pg_temp.check('private: at the limit, the sample cannot become a real trip',
  pg_temp.try(format('UPDATE trips SET is_sample = false WHERE user_id = %L AND is_sample', pg_temp.id('private'))) = -1);
SELECT pg_temp.check('private: editing the own trip still works',
  pg_temp.try(format('UPDATE trips SET title = %L, end_date = current_date + 9 WHERE user_id = %L AND title = %L',
    'renamed', pg_temp.id('private'), 'first')) = 1);
SELECT pg_temp.check('private: editing the sample still works',
  pg_temp.try(format('UPDATE trips SET title = %L WHERE user_id = %L AND is_sample', 'my sample', pg_temp.id('private'))) = 1);

-- The override and the closed doors around it
SELECT pg_temp.check('private: cannot read user_trip_limits',
  pg_temp.try('SELECT * FROM public.user_trip_limits') = -1);
SELECT pg_temp.check('private: cannot give themselves an override',
  pg_temp.try(format('INSERT INTO public.user_trip_limits (user_id, max_trips) VALUES (%L, 50)', pg_temp.id('private'))) = -1);
SELECT pg_temp.check('private: cannot call the internal limit functions',
  pg_temp.try(format('SELECT public.private_trip_limit(%L)', pg_temp.id('private'))) = -1
  AND pg_temp.try(format('SELECT public.private_trip_count(%L)', pg_temp.id('private'))) = -1);
RESET ROLE;
INSERT INTO public.user_trip_limits (user_id, max_trips, note) VALUES (pg_temp.id('private'), 2, 'test');
SELECT pg_temp.login(pg_temp.id('private'));
SELECT pg_temp.check('override 2: quota says 2',
  (public.my_trip_quota() ->> 'limit')::int = 2);
SELECT pg_temp.check('override 2: a second trip works',
  pg_temp.try(format('INSERT INTO trips (user_id, title, destination) VALUES (%L, %L, %L)', pg_temp.id('private'), 'second', 'x')) = 1);
SELECT pg_temp.check('override 2: the sample can become a real trip while there is room',
  pg_temp.try(format('UPDATE trips SET is_sample = false WHERE user_id = %L AND is_sample', pg_temp.id('private'))) = 1);
RESET ROLE;
DELETE FROM public.user_trip_limits WHERE user_id = pg_temp.id('private');

-- Deleting frees the slot (one trip at a time)
SELECT pg_temp.login(pg_temp.id('private'));
-- (pg_temp.try rolls back, so the rename above never stuck: the trip is still 'first'.)
DELETE FROM trips WHERE user_id = pg_temp.id('private') AND title = 'first';
SELECT pg_temp.check('private: after deleting the trip, a new one works',
  pg_temp.try(format('INSERT INTO trips (user_id, title, destination) VALUES (%L, %L, %L)', pg_temp.id('private'), 'next', 'x')) = 1);
SELECT pg_temp.check('private: after deleting, quota shows 0 used',
  (public.my_trip_quota() ->> 'used')::int = 0);
RESET ROLE;

-- An existing account that already owns two trips -----------------------------------------
SELECT set_config('request.jwt.claims', '', true);  -- as the SQL Editor: no signed-in caller
INSERT INTO public.trips (user_id, title, destination) VALUES (pg_temp.id('owner'), 'Owner second', 'Paris');
SELECT pg_temp.login(pg_temp.id('owner'));
SELECT pg_temp.check('existing 2-trip user: keeps and edits both',
  pg_temp.try(format('UPDATE trips SET notes = %L WHERE user_id = %L', 'edited', pg_temp.id('owner'))) = 2);
SELECT pg_temp.check('existing 2-trip user: cannot add a third',
  pg_temp.try(format('INSERT INTO trips (user_id, title, destination) VALUES (%L, %L, %L)', pg_temp.id('owner'), 'third', 'x')) = -1);
SELECT pg_temp.check('existing 2-trip user: quota shows 2 used of 1',
  public.my_trip_quota() = '{"limit": 1, "used": 2, "has_sample": false}'::jsonb);
RESET ROLE;

-- A member of someone else's trip: joining never counts --------------------------------------
SELECT pg_temp.login(pg_temp.id('editor'));
SELECT pg_temp.check('member: the joined trip is not counted',
  (public.my_trip_quota() ->> 'used')::int = 0);
SELECT pg_temp.check('member: can still open an own first trip',
  pg_temp.try(format('INSERT INTO trips (user_id, title, destination) VALUES (%L, %L, %L)', pg_temp.id('editor'), 'mine', 'x')) = 1);
SELECT pg_temp.check('member (editor): still edits the owner''s trip',
  pg_temp.try(format('UPDATE trips SET notes = %L WHERE id = %L', 'from editor', pg_temp.id('trip'))) = 1);
RESET ROLE;

-- A user whose agent request is still pending is a private user -------------------------------
SELECT pg_temp.login(pg_temp.id('asker'));
SELECT pg_temp.check('pending agent: request sits as pending',
  public.request_agent_access('Asker Travel', null) = 'pending');
INSERT INTO trips (user_id, title, destination) VALUES (pg_temp.id('asker'), 'one', 'x');
SELECT pg_temp.check('pending agent: the one-trip rule applies until approval',
  pg_temp.try(format('INSERT INTO trips (user_id, title, destination) VALUES (%L, %L, %L)', pg_temp.id('asker'), 'two', 'x')) = -1);
RESET ROLE;

-- Users the rule must not touch ----------------------------------------------------------------
SELECT pg_temp.login(pg_temp.id('agent'));
SELECT pg_temp.check('agent: no private limit in the quota',
  public.my_trip_quota() ->> 'limit' IS NULL);
INSERT INTO trips (user_id, title, destination) VALUES (pg_temp.id('agent'), 'client 1', 'x');
INSERT INTO trips (user_id, title, destination) VALUES (pg_temp.id('agent'), 'client 2', 'x');
SELECT pg_temp.check('agent: cannot mark a client trip as the sample (would stay uncounted after a suspension)',
  pg_temp.try(format('UPDATE trips SET is_sample = true WHERE user_id = %L AND title = %L', pg_temp.id('agent'), 'client 1')) = -1);
SELECT pg_temp.check('agent: opens many trips (3 owned so far, a 4th works)',
  pg_temp.try(format('INSERT INTO trips (user_id, title, destination) VALUES (%L, %L, %L)', pg_temp.id('agent'), 'client 3', 'x')) = 1);
RESET ROLE;

SELECT pg_temp.login(pg_temp.id('admin'));
INSERT INTO trips (user_id, title, destination) VALUES (pg_temp.id('admin'), 'admin 1', 'x');
SELECT pg_temp.check('admin: not limited',
  pg_temp.try(format('INSERT INTO trips (user_id, title, destination) VALUES (%L, %L, %L)', pg_temp.id('admin'), 'admin 2', 'x')) = 1);
RESET ROLE;

-- Demo visitor keeps 016's rule (3 trips), not this one
SELECT pg_temp.login(pg_temp.id('demo'), true);
SELECT pg_temp.check('demo: no private limit in the quota',
  public.my_trip_quota() ->> 'limit' IS NULL);
INSERT INTO trips (user_id, title, destination) VALUES (pg_temp.id('demo'), 'demo 2', 'x');
SELECT pg_temp.check('demo: a third trip still works (016 allows 3)',
  pg_temp.try(format('INSERT INTO trips (user_id, title, destination) VALUES (%L, %L, %L)', pg_temp.id('demo'), 'demo 3', 'x')) = 1);
SELECT pg_temp.check('demo: cannot forge a showcase copy either (an upgraded account would keep it uncounted)',
  pg_temp.try(format('INSERT INTO trips (user_id, title, destination, demo_source_id) VALUES (%L, %L, %L, gen_random_uuid())',
    pg_temp.id('demo'), 'forged', 'x')) = -1);
SELECT pg_temp.check('demo: cannot turn a trip into the sample',
  pg_temp.try(format('UPDATE trips SET is_sample = true WHERE id = %L', pg_temp.id('demo_trip'))) = -1);
INSERT INTO trips (user_id, title, destination) VALUES (pg_temp.id('demo'), 'demo 3', 'x');
SELECT pg_temp.check('demo: the fourth is blocked by 016',
  pg_temp.try(format('INSERT INTO trips (user_id, title, destination) VALUES (%L, %L, %L)', pg_temp.id('demo'), 'demo 4', 'x')) = -1);
RESET ROLE;

-- Agent suspended → private again: their many trips stay, no new one
SELECT pg_temp.login(pg_temp.id('admin'));
SELECT public.admin_decide_agent(pg_temp.id('agent'), false);
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('agent'));
SELECT pg_temp.check('suspended agent: becomes private (limit 1)',
  (public.my_trip_quota() ->> 'limit')::int = 1);
SELECT pg_temp.check('suspended agent: cannot open a new trip',
  pg_temp.try(format('INSERT INTO trips (user_id, title, destination) VALUES (%L, %L, %L)', pg_temp.id('agent'), 'client 4', 'x')) = -1);
SELECT pg_temp.check('suspended agent: still edits an existing trip',
  pg_temp.try(format('UPDATE trips SET notes = %L WHERE user_id = %L AND title = %L', 'n', pg_temp.id('agent'), 'client 1')) = 1);
RESET ROLE;

-- Logged-out visitor ---------------------------------------------------------------------------
SELECT pg_temp.login_anon();
SELECT pg_temp.check('anon: cannot call my_trip_quota',
  pg_temp.try('SELECT public.my_trip_quota()') = -1);
RESET ROLE;

-- SQL Editor (no signed-in caller) is not limited ------------------------------------------------
SELECT pg_temp.check('SQL Editor: can add a trip for a private user at the limit',
  pg_temp.try(format('INSERT INTO trips (user_id, title, destination) VALUES (%L, %L, %L)', pg_temp.id('owner'), 'by hand', 'x')) = 1);

-- Showcase copies: free only from an agency's (or admin's) showcase -------------------------
-- Any owner can switch "try it yourself" on (ShareSheet), so a copy of a private
-- user's own showcase must count, or share -> try it -> share the copy -> try it ...
-- mints trips without end.
INSERT INTO auth.users (id, email, aud, role, is_anonymous) VALUES
  ('00000000-0000-0000-0000-0000000000e7', 'chain@test.local',  'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-0000000000e8', 'friend@test.local', 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-0000000000e9', 'shop@test.local',   'authenticated', 'authenticated', false);
INSERT INTO ids VALUES
  ('chain',  '00000000-0000-0000-0000-0000000000e7'),
  ('friend', '00000000-0000-0000-0000-0000000000e8'),
  ('shop',   '00000000-0000-0000-0000-0000000000e9'),
  ('chain_trip', '10000000-0000-0000-0000-0000000000e7'),
  ('shop_show',  '10000000-0000-0000-0000-0000000000e9');
INSERT INTO public.user_roles (user_id, role) VALUES (pg_temp.id('shop'), 'agent');
INSERT INTO public.agent_accounts (user_id, status, agency_name) VALUES (pg_temp.id('shop'), 'active', 'Shop');
INSERT INTO public.trips (id, user_id, title, destination, is_shared, is_showcase, share_slug) VALUES
  (pg_temp.id('shop_show'), pg_temp.id('shop'), 'Agency demo', 'Rome', true, true, 'shop-show-0123456789');

SELECT pg_temp.login(pg_temp.id('chain'));
INSERT INTO trips (id, user_id, title, destination) VALUES (pg_temp.id('chain_trip'), pg_temp.id('chain'), 'mine', 'Rome');
UPDATE trips SET is_shared = true, share_slug = 'chain-slug-0123456789' WHERE id = pg_temp.id('chain_trip');
UPDATE trips SET is_showcase = true WHERE id = pg_temp.id('chain_trip');
SELECT pg_temp.check('private: "try it" on the own showcase is blocked at the limit (no trip minting)',
  pg_temp.try($$SELECT public.clone_showcase_trip('chain-slug-0123456789')$$) = -1);
SELECT pg_temp.check('private: a direct insert copying the own showcase is blocked at the limit',
  pg_temp.try(format('INSERT INTO trips (user_id, title, destination, demo_source_id) VALUES (%L, %L, %L, %L)',
    pg_temp.id('chain'), 'copy of mine', 'x', pg_temp.id('chain_trip'))) = -1);
SELECT pg_temp.check('private: an agency showcase copy is still free at the limit',
  public.clone_showcase_trip('shop-show-0123456789') IS NOT NULL);
SELECT pg_temp.check('private: ...and does not count',
  (public.my_trip_quota() ->> 'used')::int = 1);
-- The free copy, re-shared as a showcase, must not be a free source for anyone.
UPDATE trips SET is_shared = true, share_slug = 'chain-copy-0123456789', is_showcase = true
 WHERE user_id = pg_temp.id('chain') AND demo_source_id = pg_temp.id('shop_show');
RESET ROLE;

SELECT pg_temp.login(pg_temp.id('friend'));
SELECT pg_temp.check('private friend: "try it" on another private user''s showcase works while there is room',
  public.clone_showcase_trip('chain-slug-0123456789') IS NOT NULL);
SELECT pg_temp.check('private friend: ...and that copy is a counted trip',
  (public.my_trip_quota() ->> 'used')::int = 1);
SELECT pg_temp.check('private friend: at the limit, a copy of a private user''s re-shared copy is blocked',
  pg_temp.try($$SELECT public.clone_showcase_trip('chain-copy-0123456789')$$) = -1);
RESET ROLE;

-- A demo visitor's "try it" on a private user's showcase is unchanged: works, second click returns the same copy.
SELECT set_config('request.jwt.claims', '', true);
DELETE FROM public.trips WHERE user_id = pg_temp.id('demo') AND id <> pg_temp.id('demo_trip');  -- room under 016's 3 trips
SELECT pg_temp.login(pg_temp.id('demo'), true);
CREATE TEMP TABLE demo_copy ON COMMIT DROP AS SELECT public.clone_showcase_trip('chain-slug-0123456789') AS id;
SELECT pg_temp.check('demo: "try it" on a private user''s showcase works and is idempotent',
  (SELECT id FROM demo_copy) IS NOT NULL
  AND public.clone_showcase_trip('chain-slug-0123456789') = (SELECT id FROM demo_copy));
RESET ROLE;

-- One statement, two rows (a PostgREST bulk insert)
SELECT pg_temp.login(pg_temp.id('stranger'));
SELECT pg_temp.check('private: two trips in one INSERT statement are blocked',
  pg_temp.try(format('INSERT INTO trips (user_id, title, destination) VALUES (%L, %L, %L), (%L, %L, %L)',
    pg_temp.id('stranger'), 'a', 'x', pg_temp.id('stranger'), 'b', 'x')) = -1);
RESET ROLE;

-- Editors of someone else's trip
SELECT pg_temp.login(pg_temp.id('editor'));
SELECT pg_temp.check('editor: cannot mark the owner''s trip as the sample',
  pg_temp.try(format('UPDATE trips SET is_sample = true WHERE id = %L', pg_temp.id('trip'))) = -1);
SELECT pg_temp.check('editor: cannot attach demo_source_id to the owner''s trip',
  pg_temp.try(format('UPDATE trips SET demo_source_id = %L WHERE id = %L', pg_temp.id('shop_show'), pg_temp.id('trip'))) = -1);
RESET ROLE;

-- The showcase owner is never stuck because someone copied it (no FK on demo_source_id; an
-- ON DELETE SET NULL added later would trip demo_source_locked)
SELECT pg_temp.login(pg_temp.id('shop'));
SELECT pg_temp.check('showcase owner: can unshare and delete a showcase that has copies',
  pg_temp.try(format('UPDATE trips SET is_shared = false WHERE id = %L', pg_temp.id('shop_show'))) = 1
  AND pg_temp.try(format('DELETE FROM trips WHERE id = %L', pg_temp.id('shop_show'))) = 1);
RESET ROLE;

-- An editor can't spend the owner's slot by turning the owner's sample into a real trip
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
INSERT INTO public.trips (id, user_id, title, destination, is_sample)
VALUES ('10000000-0000-0000-0000-0000000000ea', pg_temp.id('friend'), 'friend sample', 'Rhodes', true);
DELETE FROM public.trips WHERE user_id = pg_temp.id('friend') AND NOT is_sample;  -- the friend has room again
INSERT INTO public.trip_members (trip_id, user_id, role, status)
VALUES ('10000000-0000-0000-0000-0000000000ea', pg_temp.id('editor'), 'editor', 'active');
SELECT pg_temp.login(pg_temp.id('editor'));
SELECT pg_temp.check('editor: cannot turn the owner''s sample into a real trip (spending the owner''s slot)',
  pg_temp.try($$UPDATE trips SET is_sample = false WHERE id = '10000000-0000-0000-0000-0000000000ea'$$) = -1);
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('friend'));
SELECT pg_temp.check('owner: can turn their own sample into their one trip while there is room',
  pg_temp.try($$UPDATE trips SET is_sample = false WHERE id = '10000000-0000-0000-0000-0000000000ea'$$) = 1);
RESET ROLE;
