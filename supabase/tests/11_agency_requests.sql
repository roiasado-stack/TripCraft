-- The agent's join-requests screen (AgencyRequestsPage). The screen's query is below as
-- pg_temp.requests(); "owner manages" (015) is the authority on the writes. Nothing here may reach
-- an ordinary user's trip, or another agent's.

INSERT INTO auth.users (id, email, aud, role, is_anonymous) VALUES
  ('00000000-0000-0000-0000-0000000000a5', 'agent-a@test.local',  'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-0000000000b5', 'agent-b@test.local',  'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-0000000000c5', 'agent-c@test.local',  'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-0000000000e1', 'joiner-a@test.local', 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-0000000000e2', 'joiner-b@test.local', 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-0000000000e3', 'joiner-c@test.local', 'authenticated', 'authenticated', false);
INSERT INTO ids VALUES
  ('agent_a',  '00000000-0000-0000-0000-0000000000a5'),
  ('agent_b',  '00000000-0000-0000-0000-0000000000b5'),
  ('agent_c',  '00000000-0000-0000-0000-0000000000c5'),
  ('joiner_a', '00000000-0000-0000-0000-0000000000e1'),
  ('joiner_b', '00000000-0000-0000-0000-0000000000e2'),
  ('joiner_c', '00000000-0000-0000-0000-0000000000e3'),
  ('a_trip',   '10000000-0000-0000-0000-0000000000a5'),
  ('b_trip',   '10000000-0000-0000-0000-0000000000b5'),
  ('c_trip',   '10000000-0000-0000-0000-0000000000c5');
INSERT INTO public.user_roles (user_id, role) VALUES
  (pg_temp.id('agent_a'), 'agent'), (pg_temp.id('agent_b'), 'agent'), (pg_temp.id('agent_c'), 'agent');
INSERT INTO public.trips (id, user_id, title, destination) VALUES
  (pg_temp.id('a_trip'), pg_temp.id('agent_a'), 'A family', 'Rome'),
  (pg_temp.id('b_trip'), pg_temp.id('agent_b'), 'B family', 'Prague'),
  (pg_temp.id('c_trip'), pg_temp.id('agent_c'), 'C family', 'Oslo');
-- Agent A: one request on their own trip; their OWN pending row on B's trip; active lead on C's trip,
-- where RLS shows them C's pending rows (024); active editor on the ordinary fixture trip.
INSERT INTO public.trip_members (trip_id, user_id, role, status, display_name, is_lead) VALUES
  (pg_temp.id('a_trip'), pg_temp.id('joiner_a'), 'participant', 'pending', 'Joiner A', false),
  (pg_temp.id('b_trip'), pg_temp.id('joiner_b'), 'participant', 'pending', 'Joiner B', false),
  (pg_temp.id('b_trip'), pg_temp.id('agent_a'),  'editor',      'pending', 'Agent A',  false),
  (pg_temp.id('c_trip'), pg_temp.id('joiner_c'), 'participant', 'pending', 'Joiner C', false),
  (pg_temp.id('c_trip'), pg_temp.id('agent_a'),  'participant', 'active',  'Agent A',  true),
  (pg_temp.id('trip'),   pg_temp.id('agent_a'),  'editor',      'active',  'Agent A',  false);

-- trip_members, trips!inner, status = pending, trips.user_id = me
CREATE FUNCTION pg_temp.requests() RETURNS SETOF public.trip_members LANGUAGE sql AS $$
  SELECT m.* FROM public.trip_members m
  JOIN public.trips t ON t.id = m.trip_id AND t.user_id = auth.uid()
  WHERE m.status = 'pending'
$$;

-- What the screen lists -----------------------------------------------------------------------
SELECT pg_temp.login(pg_temp.id('agent_a'));
SELECT pg_temp.check('agent: the screen lists only requests on trips they own',
  (SELECT array_agg(display_name) FROM pg_temp.requests()) = ARRAY['Joiner A']);
SELECT pg_temp.check('agent: their own pending row on someone else''s trip is not a request to approve',
  NOT EXISTS (SELECT 1 FROM pg_temp.requests() WHERE user_id = pg_temp.id('agent_a')));
-- RLS alone returns this row, so the trips.user_id filter is what keeps it off the screen.
SELECT pg_temp.check('agent who is the lead on another agent''s trip: RLS shows its pending row, the screen does not',
  (SELECT count(*) FROM trip_members WHERE trip_id = pg_temp.id('c_trip') AND status = 'pending') = 1
  AND NOT EXISTS (SELECT 1 FROM pg_temp.requests() WHERE trip_id = pg_temp.id('c_trip')));
SELECT pg_temp.check('agent who edits an ordinary user''s trip: its pending requests stay hidden',
  (SELECT count(*) FROM trip_members WHERE trip_id = pg_temp.id('trip') AND status = 'pending') = 0
  AND NOT EXISTS (SELECT 1 FROM pg_temp.requests() WHERE trip_id = pg_temp.id('trip')));

-- What the screen writes ----------------------------------------------------------------------
SELECT pg_temp.check('agent: can approve a request on their own trip',
  pg_temp.try(format($q$UPDATE trip_members SET status = 'active' WHERE trip_id = %L AND status = 'pending'$q$, pg_temp.id('a_trip'))) = 1);
SELECT pg_temp.check('agent: can reject a request on their own trip',
  pg_temp.try(format($q$UPDATE trip_members SET status = 'removed' WHERE trip_id = %L AND status = 'pending'$q$, pg_temp.id('a_trip'))) = 1);
SELECT pg_temp.check('agent: cannot approve a request on another agent''s trip',
  pg_temp.try(format($q$UPDATE trip_members SET status = 'active' WHERE trip_id = %L AND user_id = %L$q$, pg_temp.id('b_trip'), pg_temp.id('joiner_b'))) = 0);
SELECT pg_temp.check('agent: cannot approve themselves on another agent''s trip',
  pg_temp.try(format($q$UPDATE trip_members SET status = 'active' WHERE trip_id = %L AND user_id = %L$q$, pg_temp.id('b_trip'), pg_temp.id('agent_a'))) = 0);
SELECT pg_temp.check('agent who is the lead: cannot write the member row directly on another agent''s trip',
  pg_temp.try(format($q$UPDATE trip_members SET status = 'active' WHERE trip_id = %L AND user_id = %L$q$, pg_temp.id('c_trip'), pg_temp.id('joiner_c'))) = 0);
SELECT pg_temp.check('agent who edits an ordinary user''s trip: cannot approve or reject its requests',
  pg_temp.try(format($q$UPDATE trip_members SET status = 'active' WHERE trip_id = %L AND user_id = %L$q$, pg_temp.id('trip'), pg_temp.id('pending'))) = 0
  AND pg_temp.try(format($q$UPDATE trip_members SET status = 'removed' WHERE trip_id = %L AND user_id = %L$q$, pg_temp.id('trip'), pg_temp.id('pending'))) = 0);

-- "Approve and add to travellers": participants has no author column; trip_id and name are all it needs
SELECT pg_temp.check('agent: can add a traveller to their own trip',
  pg_temp.try(format($q$INSERT INTO participants (trip_id, name) VALUES (%L, 'Joiner A')$q$, pg_temp.id('a_trip'))) = 1);
SELECT pg_temp.check('agent: cannot add a traveller to another agent''s trip',
  pg_temp.try(format($q$INSERT INTO participants (trip_id, name) VALUES (%L, 'x')$q$, pg_temp.id('b_trip'))) = -1);
SELECT pg_temp.check('agent who is the lead: a lead cannot add travellers',
  pg_temp.try(format($q$INSERT INTO participants (trip_id, name) VALUES (%L, 'x')$q$, pg_temp.id('c_trip'))) = -1);
RESET ROLE;

-- An ordinary owner: same query, own trip only, nothing changes --------------------------------
SELECT pg_temp.login(pg_temp.id('owner'));
SELECT pg_temp.check('ordinary owner: sees only their own trip''s request, none of the agents''',
  (SELECT array_agg(user_id) FROM pg_temp.requests()) = ARRAY[pg_temp.id('pending')]);
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('joiner_b'));
SELECT pg_temp.check('a joiner: nothing on the screen, and cannot approve themselves',
  NOT EXISTS (SELECT 1 FROM pg_temp.requests())
  AND pg_temp.try(format($q$UPDATE trip_members SET status = 'active' WHERE trip_id = %L$q$, pg_temp.id('b_trip'))) = 0);
RESET ROLE;

-- The join page's waiting check: own row only, and no trip until approved ----------------------
SELECT pg_temp.login(pg_temp.id('pending'));
SELECT pg_temp.check('waiting: reads only their own row, and not the trip',
  (SELECT array_agg(status) FROM trip_members WHERE trip_id = pg_temp.id('trip')) = ARRAY['pending']
  AND (SELECT count(*) FROM trips WHERE id = pg_temp.id('trip')) = 0);
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('removed'));
SELECT pg_temp.check('removed: reads only their own row, not the trip, and the link does not bring them back',
  (SELECT array_agg(status) FROM trip_members WHERE trip_id = pg_temp.id('trip')) = ARRAY['removed']
  AND (SELECT count(*) FROM trips WHERE id = pg_temp.id('trip')) = 0
  AND (public.accept_trip_invite('test-invite-token') ->> 'status') = 'removed');
RESET ROLE;
