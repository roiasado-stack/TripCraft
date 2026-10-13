-- Travel-agent accounts (migration 022): requesting access, admin approval,
-- per-agent isolation, the trip limit and the agent board.

-- Fixture: an admin and two approved agents, each owning one trip -------------------
INSERT INTO auth.users (id, email, aud, role, is_anonymous) VALUES
  ('00000000-0000-0000-0000-0000000000ad', 'admin@test.local',   'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-0000000000a5', 'agent-a@test.local', 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-0000000000b5', 'agent-b@test.local', 'authenticated', 'authenticated', false);
INSERT INTO ids VALUES
  ('admin',        '00000000-0000-0000-0000-0000000000ad'),
  ('agent_a',      '00000000-0000-0000-0000-0000000000a5'),
  ('agent_b',      '00000000-0000-0000-0000-0000000000b5'),
  ('agent_a_trip', '10000000-0000-0000-0000-0000000000a5'),
  ('agent_b_trip', '10000000-0000-0000-0000-0000000000b5');
INSERT INTO public.user_roles (user_id, role) VALUES
  (pg_temp.id('admin'), 'admin'), (pg_temp.id('agent_a'), 'agent'), (pg_temp.id('agent_b'), 'agent');
INSERT INTO public.agent_accounts (user_id, status, agency_name, phone) VALUES
  (pg_temp.id('agent_a'), 'active', 'Agency A', '050-1111111'),
  (pg_temp.id('agent_b'), 'active', 'Agency B', '050-2222222');
INSERT INTO public.trips (id, user_id, title, destination, start_date, end_date) VALUES
  (pg_temp.id('agent_a_trip'), pg_temp.id('agent_a'), 'A family', 'Rome',   current_date + 3,  current_date + 10),
  (pg_temp.id('agent_b_trip'), pg_temp.id('agent_b'), 'B family', 'Prague', current_date + 30, current_date + 35);
INSERT INTO public.trip_clients (trip_id, client_name, client_phone) VALUES
  (pg_temp.id('agent_a_trip'), 'CLIENT-A', '050-AAA'),
  (pg_temp.id('agent_b_trip'), 'CLIENT-B', '050-BBB');
-- Agent A's trip: three travellers, two passports (one a member's private upload
-- the agent can't read), one joined member, one waiting. Agent B's: one traveller, nobody joined.
INSERT INTO public.participants (id, trip_id, name) VALUES
  ('20000000-0000-0000-0000-0000000000a1', pg_temp.id('agent_a_trip'), 'Dana'),
  ('20000000-0000-0000-0000-0000000000a2', pg_temp.id('agent_a_trip'), 'Yoni'),
  ('20000000-0000-0000-0000-0000000000a3', pg_temp.id('agent_a_trip'), 'Noa'),
  ('20000000-0000-0000-0000-0000000000b1', pg_temp.id('agent_b_trip'), 'Avi');
INSERT INTO public.documents (trip_id, participant_id, category, name, storage_path, uploaded_by, visibility) VALUES
  (pg_temp.id('agent_a_trip'), '20000000-0000-0000-0000-0000000000a1', 'passport', 'Dana passport',
   pg_temp.id('agent_a') || '/dana.pdf', pg_temp.id('agent_a'), 'private'),
  (pg_temp.id('agent_a_trip'), '20000000-0000-0000-0000-0000000000a2', 'passport', 'Yoni passport',
   pg_temp.id('viewer') || '/yoni.pdf', pg_temp.id('viewer'), 'private');
INSERT INTO public.trip_members (trip_id, user_id, role, status) VALUES
  (pg_temp.id('agent_a_trip'), pg_temp.id('viewer'),  'viewer', 'active'),
  (pg_temp.id('agent_a_trip'), pg_temp.id('pending'), 'viewer', 'pending');
INSERT INTO public.flights (trip_id, airline) VALUES (pg_temp.id('agent_a_trip'), 'EL AL');
-- Agent A spent $1.50 on AI this month and made two Google searches today.
INSERT INTO public.agent_runs (user_id, kind, cost_usd) VALUES
  (pg_temp.id('agent_a'), 'ask', 1.5),
  (pg_temp.id('agent_a'), 'google_kosher_search', 0),
  (pg_temp.id('agent_a'), 'google_kosher_search', 0);

-- A regular user asks for access ---------------------------------------------------------
SELECT pg_temp.login(pg_temp.id('stranger'));
SELECT pg_temp.check('user: cannot insert an agent account directly (even a pending one)',
  pg_temp.try(format('INSERT INTO agent_accounts (user_id, agency_name) VALUES (%L, %L)', pg_temp.id('stranger'), 'x')) = -1);
SELECT pg_temp.check('user: request_agent_access returns pending',
  public.request_agent_access('  Gesher Travel  ', '050-3333333') = 'pending');
SELECT pg_temp.check('user: the request is stored as pending with the default limits',
  (SELECT row(status, agency_name, ai_daily_usd, ai_monthly_usd, google_daily, max_active_trips)::text
   FROM agent_accounts WHERE user_id = pg_temp.id('stranger'))
  = row('pending', 'Gesher Travel', 3.00, 15.00, 20, 30)::text);
SELECT pg_temp.check('user: requesting does not grant the agent role',
  NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = pg_temp.id('stranger') AND role = 'agent'));
SELECT pg_temp.check('user: a pending request has no agent limits',
  public.my_agent_limits() IS NULL);
SELECT pg_temp.check('user: cannot set their own request to active',
  pg_temp.try(format('UPDATE agent_accounts SET status = %L WHERE user_id = %L', 'active', pg_temp.id('stranger'))) = -1);
SELECT pg_temp.check('user: cannot approve themselves',
  pg_temp.try(format('SELECT public.admin_decide_agent(%L, true)', pg_temp.id('stranger'))) = -1);
SELECT pg_temp.check('user: cannot change limits or list agents',
  pg_temp.try(format('SELECT public.admin_set_agent_limits(%L, 100, 1000, 999, 999)', pg_temp.id('stranger'))) = -1
  AND pg_temp.try('SELECT * FROM public.admin_list_agents()') = -1);
SELECT pg_temp.check('user: cannot read another user''s limits through agent_limits',
  pg_temp.try(format('SELECT public.agent_limits(%L)', pg_temp.id('agent_a'))) = -1);
SELECT pg_temp.check('user: sees only their own agent account row',
  (SELECT array_agg(user_id) FROM agent_accounts) = ARRAY[pg_temp.id('stranger')]);
SELECT pg_temp.check('user: an empty agency name is rejected',
  pg_temp.try($$SELECT public.request_agent_access('   ', null)$$) = -1);
SELECT pg_temp.check('user: asking again while pending returns pending',
  public.request_agent_access('Gesher Tours', null) = 'pending');
SELECT pg_temp.check('user: asking again edits the pending request',
  (SELECT agency_name FROM agent_accounts WHERE user_id = pg_temp.id('stranger')) = 'Gesher Tours');
RESET ROLE;

-- The trip owner is not an agent: the board is empty ----------------------------------
SELECT pg_temp.login(pg_temp.id('owner'));
SELECT pg_temp.check('non-agent: agent_trip_board returns nothing, even for trips they own',
  (SELECT count(*) FROM public.agent_trip_board()) = 0);
SELECT pg_temp.check('non-agent: my_agent_limits is NULL', public.my_agent_limits() IS NULL);
RESET ROLE;

-- Admin approves --------------------------------------------------------------------------
SELECT pg_temp.login(pg_temp.id('admin'));
SELECT pg_temp.check('admin: sees every agent account',
  (SELECT count(*) FROM agent_accounts) = 3);
SELECT pg_temp.check('admin: list_agents shows email, status and usage',
  (SELECT email = 'agent-a@test.local' AND status = 'active' AND ai_month_usd = 1.5 AND ai_today_usd = 1.5
          AND google_searches_today = 2 AND google_photos_today = 0 AND active_trips = 1
   FROM public.admin_list_agents() WHERE user_id = pg_temp.id('agent_a')));
SELECT pg_temp.check('admin: pending requests come first',
  (SELECT user_id FROM public.admin_list_agents() LIMIT 1) = pg_temp.id('stranger'));
SELECT pg_temp.check('admin: approve returns active',
  public.admin_decide_agent(pg_temp.id('stranger'), true) = 'active');
SELECT pg_temp.check('admin: approval grants the agent role and records the decision',
  public.has_role(pg_temp.id('stranger'), 'agent')
  AND (SELECT decided_by FROM agent_accounts WHERE user_id = pg_temp.id('stranger')) = pg_temp.id('admin'));
SELECT pg_temp.check('admin: negative limits are rejected',
  pg_temp.try(format('SELECT public.admin_set_agent_limits(%L, -1, 15, 20, 30)', pg_temp.id('stranger'))) = -1);
SELECT pg_temp.check('admin: limits above the ceilings are rejected',
  pg_temp.try(format('SELECT public.admin_set_agent_limits(%L, 51, 15, 20, 30)', pg_temp.id('stranger'))) = -1
  AND pg_temp.try(format('SELECT public.admin_set_agent_limits(%L, 3, 501, 20, 30)', pg_temp.id('stranger'))) = -1
  AND pg_temp.try(format('SELECT public.admin_set_agent_limits(%L, 3, 15, 201, 30)', pg_temp.id('stranger'))) = -1
  AND pg_temp.try(format('SELECT public.admin_set_agent_limits(%L, 3, 15, 20, 501)', pg_temp.id('stranger'))) = -1);
SELECT public.admin_set_agent_limits(pg_temp.id('stranger'), 5, 25, 40, 2);
SELECT pg_temp.check('admin: can change an agent''s limits',
  (SELECT row(ai_daily_usd, ai_monthly_usd, google_daily, max_active_trips)::text
   FROM agent_accounts WHERE user_id = pg_temp.id('stranger')) = row(5.00, 25.00, 40, 2)::text);
RESET ROLE;

SELECT pg_temp.login(pg_temp.id('stranger'));
SELECT pg_temp.check('approved agent: my_agent_limits returns their limits',
  (public.my_agent_limits() ->> 'ai_daily_usd')::numeric = 5
  AND (public.my_agent_limits() ->> 'google_daily')::int = 40);
SELECT pg_temp.check('approved agent: asking again returns active',
  public.request_agent_access('Other name', null) = 'active');
SELECT pg_temp.check('approved agent: asking again does not change an active account',
  (SELECT agency_name FROM agent_accounts WHERE user_id = pg_temp.id('stranger')) = 'Gesher Tours');
RESET ROLE;

-- Agents are isolated from each other ---------------------------------------------------
SELECT pg_temp.login(pg_temp.id('agent_a'));
SELECT pg_temp.check('agent A: sees only their own account row',
  (SELECT array_agg(user_id) FROM agent_accounts) = ARRAY[pg_temp.id('agent_a')]);
SELECT pg_temp.check('agent A: cannot see agent B''s trip or its client',
  (SELECT count(*) FROM trips WHERE id = pg_temp.id('agent_b_trip')) = 0
  AND (SELECT array_agg(client_name) FROM trip_clients) = ARRAY['CLIENT-A']);
SELECT pg_temp.check('agent A: cannot write a client onto someone else''s trip',
  pg_temp.try(format('UPDATE trip_clients SET client_phone = %L WHERE trip_id = %L', 'x', pg_temp.id('agent_b_trip'))) = 0
  AND pg_temp.try(format('INSERT INTO trip_clients (trip_id, client_name) VALUES (%L, %L)', pg_temp.id('trip'), 'x')) = -1);
SELECT pg_temp.check('agent A: can update their own trip''s client',
  pg_temp.try(format('UPDATE trip_clients SET client_phone = %L WHERE trip_id = %L', '050-NEW', pg_temp.id('agent_a_trip'))) = 1);
SELECT pg_temp.check('agent A: trip_passport_count answers only for trips they own',
  public.trip_passport_count(pg_temp.id('agent_b_trip')) IS NULL
  AND public.trip_passport_count(pg_temp.id('trip')) IS NULL);
SELECT pg_temp.check('agent A: still cannot read the member''s private passport itself',
  (SELECT count(*) FROM documents WHERE trip_id = pg_temp.id('agent_a_trip')) = 1);
SELECT pg_temp.check('agent A: the board has exactly their own trip',
  (SELECT array_agg(id) FROM public.agent_trip_board()) = ARRAY[pg_temp.id('agent_a_trip')]);
SELECT pg_temp.check('agent A: board counts travellers, passports (incl. a member''s private upload), members and bookings',
  (SELECT row(client_name, participants_count, passports_count, members_joined, members_pending, documents_count, bookings_count)::text
   FROM public.agent_trip_board()) = row('CLIENT-A', 3, 2, 1, 1, 1, 1)::text);
SELECT pg_temp.check('agent A: board flags what needs attention',
  (SELECT needs_attention FROM public.agent_trip_board())
  = ARRAY['missing_passports', 'pending_members', 'departing_soon']);
SELECT pg_temp.check('agent A: my_agent_limits has this month''s AI spend',
  (public.my_agent_limits() ->> 'month_cost_usd')::numeric = 1.5);
SELECT pg_temp.check('agent A: cannot change their own limits',
  pg_temp.try(format('SELECT public.admin_set_agent_limits(%L, 100, 1000, 999, 999)', pg_temp.id('agent_a'))) = -1
  AND pg_temp.try(format('UPDATE agent_accounts SET ai_daily_usd = 100 WHERE user_id = %L', pg_temp.id('agent_a'))) = -1);
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('agent_b'));
SELECT pg_temp.check('agent B: the board has only B''s trip',
  (SELECT array_agg(id) FROM public.agent_trip_board()) = ARRAY[pg_temp.id('agent_b_trip')]);
SELECT pg_temp.check('agent B: not_joined fires when there are travellers and nobody joined',
  (SELECT needs_attention FROM public.agent_trip_board()) = ARRAY['missing_passports', 'not_joined']);
SELECT pg_temp.check('agent B: cannot see agent A''s account row',
  (SELECT count(*) FROM agent_accounts WHERE user_id = pg_temp.id('agent_a')) = 0);
RESET ROLE;

-- Trip limit (the approved user above now has max_active_trips = 2) ---------------------
SELECT pg_temp.login(pg_temp.id('stranger'));
INSERT INTO trips (user_id, title, destination) VALUES (pg_temp.id('stranger'), 'one', 'x');
INSERT INTO trips (user_id, title, destination, end_date) VALUES (pg_temp.id('stranger'), 'over', 'x', current_date - 1);
SELECT pg_temp.check('agent: a trip that already ended does not count against the limit',
  pg_temp.try(format('INSERT INTO trips (user_id, title, destination) VALUES (%L, %L, %L)', pg_temp.id('stranger'), 'two', 'x')) = 1);
INSERT INTO trips (user_id, title, destination) VALUES (pg_temp.id('stranger'), 'two', 'x');
SELECT pg_temp.check('agent: the trip limit stops the next active trip',
  pg_temp.try(format('INSERT INTO trips (user_id, title, destination) VALUES (%L, %L, %L)', pg_temp.id('stranger'), 'three', 'x')) = -1);
SELECT pg_temp.check('agent at the limit: inserting a trip that already ended still works',
  pg_temp.try(format('INSERT INTO trips (user_id, title, destination, end_date) VALUES (%L, %L, %L, current_date - 1)',
    pg_temp.id('stranger'), 'past', 'x')) = 1);
SELECT pg_temp.check('agent: a template does not count and is not blocked',
  pg_temp.try(format('INSERT INTO trips (user_id, title, destination, is_template) VALUES (%L, %L, %L, true)',
    pg_temp.id('stranger'), 'tpl', 'x')) = 1);
RESET ROLE;

-- Suspension -------------------------------------------------------------------------------
SELECT pg_temp.login(pg_temp.id('admin'));
SELECT pg_temp.check('admin: suspend returns suspended',
  public.admin_decide_agent(pg_temp.id('stranger'), false) = 'suspended');
DO $$ BEGIN
  PERFORM public.admin_decide_agent(pg_temp.id('owner'), true);
  RAISE EXCEPTION 'FAIL: admin: deciding on a user with no request fails';
EXCEPTION WHEN no_data_found THEN
  RAISE NOTICE 'ok   admin: deciding on a user with no request fails (and grants nothing)';
END $$;
RESET ROLE;
SELECT pg_temp.check('suspended: the agent role is gone',
  NOT public.has_role(pg_temp.id('stranger'), 'agent'));
SELECT pg_temp.login(pg_temp.id('stranger'));
SELECT pg_temp.check('suspended: no agent limits and an empty board',
  public.my_agent_limits() IS NULL AND (SELECT count(*) FROM public.agent_trip_board()) = 0);
SELECT pg_temp.check('suspended: the trip limit no longer applies (back to a regular user)',
  pg_temp.try(format('INSERT INTO trips (user_id, title, destination) VALUES (%L, %L, %L)', pg_temp.id('stranger'), 'three', 'x')) = 1);
SELECT pg_temp.check('suspended: asking again returns suspended',
  public.request_agent_access('Again', null) = 'suspended');
SELECT pg_temp.check('suspended: asking again does not reopen the account',
  (SELECT status FROM agent_accounts WHERE user_id = pg_temp.id('stranger')) = 'suspended');
RESET ROLE;

-- Logged-out visitor -------------------------------------------------------------------------
SELECT pg_temp.login_anon();
SELECT pg_temp.check('anon: cannot read agent_accounts',
  pg_temp.try('SELECT * FROM agent_accounts') = -1);
SELECT pg_temp.check('anon: cannot execute any agent function',
  pg_temp.try($$SELECT public.request_agent_access('x', null)$$) = -1
  AND pg_temp.try('SELECT public.my_agent_limits()') = -1
  AND pg_temp.try('SELECT * FROM public.agent_trip_board()') = -1
  AND pg_temp.try('SELECT * FROM public.admin_list_agents()') = -1
  AND pg_temp.try(format('SELECT public.admin_decide_agent(%L, true)', pg_temp.id('stranger'))) = -1
  AND pg_temp.try(format('SELECT public.agent_limits(%L)', pg_temp.id('agent_a'))) = -1
  AND pg_temp.try(format('SELECT public.trip_passport_count(%L)', pg_temp.id('agent_a_trip'))) = -1);
SELECT pg_temp.check('anon: cannot read trip_clients',
  pg_temp.try('SELECT * FROM trip_clients') = -1);
RESET ROLE;

-- Demo visitor --------------------------------------------------------------------------------
SELECT pg_temp.login(pg_temp.id('demo'), true);
SELECT pg_temp.check('demo: cannot request agent access',
  pg_temp.try($$SELECT public.request_agent_access('Demo agency', null)$$) = -1);
RESET ROLE;
SELECT pg_temp.check('demo: no agent account was created',
  NOT EXISTS (SELECT 1 FROM agent_accounts WHERE user_id = pg_temp.id('demo')));

-- The public brochure never shows the agent's client --------------------------------------
SELECT set_config('request.jwt.claims', '', true);  -- RESET ROLE keeps the demo claims; guards read them
INSERT INTO public.trip_clients (trip_id, client_name, client_phone) VALUES (pg_temp.id('trip'), 'SECRET-CLIENT', 'SECRET-CLIENT-PHONE');
SELECT pg_temp.login_anon();
SELECT pg_temp.check('anon: get_shared_trip does not expose client_name / client_phone',
  position('SECRET-CLIENT' in public.get_shared_trip('test-slug-0123456789')::text) = 0
  AND public.get_shared_trip('test-slug-0123456789') IS NOT NULL);
RESET ROLE;

-- ==== Proposed additions (security review of 022) ====================================
SELECT set_config('request.jwt.claims', '', true);


SELECT pg_temp.login(pg_temp.id('agent_a'));
-- An active agent is not an admin
SELECT pg_temp.check('agent: cannot list agents (emails) or decide on / re-limit another agent',
  pg_temp.try('SELECT * FROM public.admin_list_agents()') = -1
  AND pg_temp.try(format('SELECT public.admin_decide_agent(%L, false)', pg_temp.id('agent_b'))) = -1
  AND pg_temp.try(format('SELECT public.admin_set_agent_limits(%L, 0, 0, 0, 0)', pg_temp.id('agent_b'))) = -1);
RESET ROLE;

-- Demo visitor gets no agent limits and no board
SELECT pg_temp.login(pg_temp.id('demo'), true);
SELECT pg_temp.check('demo: no agent limits and an empty board',
  public.my_agent_limits() IS NULL AND (SELECT count(*) FROM public.agent_trip_board()) = 0);
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- Admin rejects a pending request
SELECT pg_temp.login(pg_temp.id('participant'));
SELECT public.request_agent_access('Reject me', null);
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('admin'));
SELECT pg_temp.check('admin: rejecting a pending request returns suspended',
  public.admin_decide_agent(pg_temp.id('participant'), false) = 'suspended');
DO $$ BEGIN
  PERFORM public.admin_set_agent_limits(pg_temp.id('agent_a'), NULL, 15, 20, 30);
  RAISE EXCEPTION 'FAIL: admin: NULL limits are rejected';
EXCEPTION WHEN not_null_violation THEN
  RAISE NOTICE 'ok   admin: NULL limits are rejected (no "unlimited")';
END $$;
RESET ROLE;
SELECT pg_temp.check('rejected: no agent role',
  NOT public.has_role(pg_temp.id('participant'), 'agent'));

-- Role and account must both be in place
INSERT INTO public.user_roles (user_id, role) VALUES (pg_temp.id('owner'), 'agent');
SELECT pg_temp.login(pg_temp.id('owner'));
SELECT pg_temp.check('agent role without an active account: no limits',
  public.my_agent_limits() IS NULL);
RESET ROLE;
DELETE FROM public.user_roles WHERE user_id = pg_temp.id('agent_b') AND role = 'agent';
SELECT pg_temp.login(pg_temp.id('agent_b'));
SELECT pg_temp.check('active account without the agent role: no limits, empty board',
  public.my_agent_limits() IS NULL AND (SELECT count(*) FROM public.agent_trip_board()) = 0);
RESET ROLE;

-- Trip limit cannot be bypassed with an UPDATE (FAILS before the fix)
INSERT INTO public.trips (id, user_id, title, destination, end_date) VALUES
  ('30000000-0000-0000-0000-0000000000a2', pg_temp.id('agent_a'), 'old', 'x', current_date - 1);
INSERT INTO public.trips (id, user_id, title, destination, is_template) VALUES
  ('30000000-0000-0000-0000-0000000000a1', pg_temp.id('agent_a'), 'tpl', 'x', true);
SELECT pg_temp.login(pg_temp.id('admin'));
SELECT public.admin_set_agent_limits(pg_temp.id('agent_a'), 3, 15, 20, 1);  -- A already has 1 active trip
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('agent_a'));
SELECT pg_temp.check('agent at the trip limit: cannot reopen an ended trip by moving end_date',
  pg_temp.try($$UPDATE trips SET end_date = current_date + 30 WHERE id = '30000000-0000-0000-0000-0000000000a2'$$) = -1);
SELECT pg_temp.check('agent at the trip limit: cannot turn a template into an active trip',
  pg_temp.try($$UPDATE trips SET is_template = false WHERE id = '30000000-0000-0000-0000-0000000000a1'$$) = -1);
SELECT pg_temp.check('agent at the trip limit: editing an active trip still works',
  pg_temp.try(format('UPDATE trips SET title = %L WHERE id = %L', 'renamed', pg_temp.id('agent_a_trip'))) = 1);
RESET ROLE;

-- Client contact is the owning agent's only (FAILS today: viewer reads it, editor rewrites it)
INSERT INTO public.trip_members (trip_id, user_id, role, status) VALUES
  (pg_temp.id('agent_a_trip'), pg_temp.id('editor'), 'editor', 'active');
SELECT pg_temp.login(pg_temp.id('viewer'));
SELECT pg_temp.check('viewer of an agent trip: sees the trip but not the client contact',
  (SELECT count(*) FROM trips WHERE id = pg_temp.id('agent_a_trip')) = 1
  AND (SELECT count(*) FROM trip_clients WHERE trip_id = pg_temp.id('agent_a_trip')) = 0);
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('editor'));
SELECT pg_temp.check('editor of an agent trip: cannot read or change the client contact',
  (SELECT count(*) FROM trip_clients WHERE trip_id = pg_temp.id('agent_a_trip')) = 0
  AND pg_temp.try(format('UPDATE trip_clients SET client_phone = %L WHERE trip_id = %L', 'x', pg_temp.id('agent_a_trip'))) = 0
  AND pg_temp.try(format('DELETE FROM trip_clients WHERE trip_id = %L', pg_temp.id('agent_a_trip'))) = 0
  AND pg_temp.try(format('INSERT INTO trip_clients (trip_id, client_name) VALUES (%L, %L)', pg_temp.id('agent_a_trip'), 'x')) = -1);
RESET ROLE;
