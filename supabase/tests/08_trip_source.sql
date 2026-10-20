-- Where an agent's trip came from (migration 025): trip_clients.source and
-- external_ref are the owner's alone, never on the brochure, and the board
-- returns them only to the agent who owns the trip.

-- Fixture: two approved agents; agent A's trip has a lead client --------------------
INSERT INTO auth.users (id, email, aud, role, is_anonymous) VALUES
  ('00000000-0000-0000-0000-0000000000e5', 'src-agent-a@test.local', 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-0000000000e6', 'src-agent-b@test.local', 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-0000000000e7', 'src-lead@test.local',    'authenticated', 'authenticated', false);
INSERT INTO ids VALUES
  ('src_agent_a', '00000000-0000-0000-0000-0000000000e5'),
  ('src_agent_b', '00000000-0000-0000-0000-0000000000e6'),
  ('src_lead',    '00000000-0000-0000-0000-0000000000e7'),
  ('src_trip',    '10000000-0000-0000-0000-0000000000e5');
INSERT INTO public.user_roles (user_id, role) VALUES
  (pg_temp.id('src_agent_a'), 'agent'), (pg_temp.id('src_agent_b'), 'agent');
INSERT INTO public.agent_accounts (user_id, status, agency_name) VALUES
  (pg_temp.id('src_agent_a'), 'active', 'Source A'),
  (pg_temp.id('src_agent_b'), 'active', 'Source B');
INSERT INTO public.trips (id, user_id, title, destination, is_shared, share_slug, start_date, end_date) VALUES
  (pg_temp.id('src_trip'), pg_temp.id('src_agent_a'), 'Src trip', 'Lisbon', true, 'src-slug-0123456789',
   current_date + 20, current_date + 27);
INSERT INTO public.trip_clients (trip_id, client_name, source, external_ref) VALUES
  (pg_temp.id('src_trip'), 'SRC-CLIENT', 'documents', 'SECRET-EXT-A');
INSERT INTO public.trip_members (trip_id, user_id, role, status, is_lead) VALUES
  (pg_temp.id('src_trip'), pg_temp.id('src_lead'), 'participant', 'active', true);
-- The ordinary fixture trip (its owner is not an agent) gets a client row too.
INSERT INTO public.trip_clients (trip_id, client_name, external_ref) VALUES
  (pg_temp.id('trip'), 'ORDINARY-CLIENT', 'SECRET-EXT-ORD');

-- Defaults and constraints -------------------------------------------------------------
SELECT pg_temp.check('a client row without a source reads as manual',
  (SELECT source FROM public.trip_clients WHERE trip_id = pg_temp.id('trip')) = 'manual');

SELECT pg_temp.login(pg_temp.id('src_agent_a'));
SELECT pg_temp.check('owner: reads source and external_ref',
  (SELECT source || '/' || external_ref FROM public.trip_clients WHERE trip_id = pg_temp.id('src_trip'))
  = 'documents/SECRET-EXT-A');
SELECT pg_temp.check('owner: updates external_ref',
  pg_temp.try($$UPDATE public.trip_clients SET external_ref = 'NEW-REF'
               WHERE trip_id = '10000000-0000-0000-0000-0000000000e5'$$) = 1);
SELECT pg_temp.check('owner: an unknown source is refused',
  pg_temp.try($$UPDATE public.trip_clients SET source = 'crm'
               WHERE trip_id = '10000000-0000-0000-0000-0000000000e5'$$) = -1);
SELECT pg_temp.check('owner: an empty external_ref is refused (NULL instead)',
  pg_temp.try($$UPDATE public.trip_clients SET external_ref = ''
               WHERE trip_id = '10000000-0000-0000-0000-0000000000e5'$$) = -1);
SELECT pg_temp.check('owner: an 81-character external_ref is refused',
  pg_temp.try($$UPDATE public.trip_clients SET external_ref = repeat('x', 81)
               WHERE trip_id = '10000000-0000-0000-0000-0000000000e5'$$) = -1);
SELECT pg_temp.check('agent board: returns source and external_ref for the own trip',
  (SELECT source || '/' || external_ref FROM public.agent_trip_board() WHERE id = pg_temp.id('src_trip'))
  = 'documents/SECRET-EXT-A');
RESET ROLE;

-- Nobody but the owner -------------------------------------------------------------------
SELECT pg_temp.login(pg_temp.id('src_agent_b'));
SELECT pg_temp.check('another agent: no client row',
  NOT EXISTS (SELECT 1 FROM public.trip_clients WHERE trip_id = pg_temp.id('src_trip')));
SELECT pg_temp.check('another agent: the board does not list the trip',
  NOT EXISTS (SELECT 1 FROM public.agent_trip_board() WHERE id = pg_temp.id('src_trip')));
SELECT pg_temp.check('another agent: cannot set external_ref',
  pg_temp.try($$UPDATE public.trip_clients SET external_ref = 'HIJACK'
               WHERE trip_id = '10000000-0000-0000-0000-0000000000e5'$$) = 0);
RESET ROLE;

SELECT pg_temp.login(pg_temp.id('src_lead'));
SELECT pg_temp.check('lead client: no client row (source and ref stay the agent''s)',
  NOT EXISTS (SELECT 1 FROM public.trip_clients WHERE trip_id = pg_temp.id('src_trip')));
SELECT pg_temp.check('lead client: cannot set external_ref',
  pg_temp.try($$UPDATE public.trip_clients SET external_ref = 'LEAD'
               WHERE trip_id = '10000000-0000-0000-0000-0000000000e5'$$) = 0);
RESET ROLE;

-- The ordinary trip: members see nothing new, its non-agent owner gets no board rows.
SELECT pg_temp.login(pg_temp.id('editor'));
SELECT pg_temp.check('editor of an ordinary trip: no client row',
  NOT EXISTS (SELECT 1 FROM public.trip_clients WHERE trip_id = pg_temp.id('trip')));
SELECT pg_temp.check('editor of an ordinary trip: cannot write source',
  pg_temp.try($$UPDATE public.trip_clients SET source = 'documents'
               WHERE trip_id = '10000000-0000-0000-0000-000000000001'$$) = 0);
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('owner'));
SELECT pg_temp.check('non-agent owner: the board is empty (agent-only)',
  NOT EXISTS (SELECT 1 FROM public.agent_trip_board()));
RESET ROLE;

-- The brochure ---------------------------------------------------------------------------
SELECT pg_temp.login_anon();
SELECT pg_temp.check('anon: the agent trip''s brochure has no external_ref or source',
  public.get_shared_trip('src-slug-0123456789')::text NOT LIKE '%SECRET-EXT%'
  AND public.get_shared_trip('src-slug-0123456789')::text NOT LIKE '%NEW-REF%'
  AND NOT (public.get_shared_trip('src-slug-0123456789') ? 'source'));
SELECT pg_temp.check('anon: the ordinary trip''s brochure has no external_ref',
  public.get_shared_trip('test-slug-0123456789')::text NOT LIKE '%SECRET-EXT%');
SELECT pg_temp.check('anon: cannot call the agent board',
  pg_temp.try($$SELECT * FROM public.agent_trip_board()$$) = -1);
SELECT pg_temp.check('anon: cannot read trip_clients',
  pg_temp.try($$SELECT * FROM public.trip_clients$$) = -1);
RESET ROLE;
