-- Editing a suggestion's title / description / kind / tags (SuggestionsTab "עריכה").
-- No migration: migration 015's "participants update" policy lets anyone who can
-- participate update the row, and its guard_suggestion_update trigger limits a
-- participant to `liked`. So owners and editors may edit; participants, viewers
-- and outsiders may not. Same on an ordinary user's trip, an agency trip and a
-- demo clone.

-- One full edit, as the app sends it.
CREATE FUNCTION pg_temp.edit_sql(trip UUID) RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT format(
    'UPDATE suggestions SET title = %L, description = %L, kind = %L, tags = %L::text[], image_url = NULL, google_place_id = NULL
      WHERE trip_id = %L',
    'Colosseo', 'Edited description', 'restaurant', '{family,free}', trip)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.edit_sql(UUID) TO authenticated, anon;

-- Fixtures: a suggestion on the demo clone, and an agency trip with one ----------
INSERT INTO auth.users (id, email, aud, role, is_anonymous) VALUES
  ('00000000-0000-0000-0000-0000000000a6', 'agent-edit@test.local', 'authenticated', 'authenticated', false);
INSERT INTO ids VALUES
  ('agent',      '00000000-0000-0000-0000-0000000000a6'),
  ('agent_trip', '10000000-0000-0000-0000-0000000000a6');
INSERT INTO public.user_roles (user_id, role) VALUES (pg_temp.id('agent'), 'agent');
INSERT INTO public.agent_accounts (user_id, status, agency_name, phone) VALUES
  (pg_temp.id('agent'), 'active', 'Edit Agency', '050-3333333');
INSERT INTO public.trips (id, user_id, title, destination) VALUES
  (pg_temp.id('agent_trip'), pg_temp.id('agent'), 'Agency family', 'Hanoi');
INSERT INTO public.trip_members (trip_id, user_id, role, status) VALUES
  (pg_temp.id('agent_trip'), pg_temp.id('editor'), 'editor', 'active');
INSERT INTO public.suggestions (trip_id, title) VALUES
  (pg_temp.id('demo_trip'),  'Eiffel Tower'),
  (pg_temp.id('agent_trip'), 'Old Quarter');

-- Ordinary user's trip (the shared fixture trip has no agent behind it) ------------
SELECT pg_temp.login(pg_temp.id('owner'));
SELECT pg_temp.check('owner: can edit a suggestion''s title, description, kind and tags',
  pg_temp.try(pg_temp.edit_sql(pg_temp.id('trip'))) = 1);
RESET ROLE;

SELECT pg_temp.login(pg_temp.id('editor'));
SELECT pg_temp.check('editor: can edit a suggestion''s title, description, kind and tags',
  pg_temp.try(pg_temp.edit_sql(pg_temp.id('trip'))) = 1);
RESET ROLE;

SELECT pg_temp.login(pg_temp.id('participant'));
SELECT pg_temp.check('participant: cannot edit a suggestion (guard trigger)',
  pg_temp.try(pg_temp.edit_sql(pg_temp.id('trip'))) = -1);
SELECT pg_temp.check('participant: cannot change only the tags either',
  pg_temp.try(format('UPDATE suggestions SET tags = %L::text[] WHERE trip_id = %L', '{x}', pg_temp.id('trip'))) = -1);
RESET ROLE;

SELECT pg_temp.login(pg_temp.id('viewer'));
SELECT pg_temp.check('viewer: cannot edit a suggestion (0 rows)',
  pg_temp.try(pg_temp.edit_sql(pg_temp.id('trip'))) = 0);
RESET ROLE;

SELECT pg_temp.login(pg_temp.id('pending'));
SELECT pg_temp.check('pending editor: cannot edit a suggestion yet',
  pg_temp.try(pg_temp.edit_sql(pg_temp.id('trip'))) = 0);
RESET ROLE;

SELECT pg_temp.login(pg_temp.id('removed'));
SELECT pg_temp.check('removed editor: cannot edit a suggestion',
  pg_temp.try(pg_temp.edit_sql(pg_temp.id('trip'))) = 0);
RESET ROLE;

SELECT pg_temp.login(pg_temp.id('stranger'));
SELECT pg_temp.check('stranger: cannot edit another trip''s suggestion',
  pg_temp.try(pg_temp.edit_sql(pg_temp.id('trip'))) = 0);
RESET ROLE;

-- An agency trip behaves the same --------------------------------------------------
SELECT pg_temp.login(pg_temp.id('agent'));
SELECT pg_temp.check('agent: can edit a suggestion on their own trip',
  pg_temp.try(pg_temp.edit_sql(pg_temp.id('agent_trip'))) = 1);
SELECT pg_temp.check('agent: cannot edit a suggestion on an ordinary user''s trip',
  pg_temp.try(pg_temp.edit_sql(pg_temp.id('trip'))) = 0);
RESET ROLE;

SELECT pg_temp.login(pg_temp.id('editor'));
SELECT pg_temp.check('editor of an agency trip: can edit its suggestion',
  pg_temp.try(pg_temp.edit_sql(pg_temp.id('agent_trip'))) = 1);
RESET ROLE;

SELECT pg_temp.login(pg_temp.id('owner'));
SELECT pg_temp.check('owner of another trip: cannot edit the agency trip''s suggestion',
  pg_temp.try(pg_temp.edit_sql(pg_temp.id('agent_trip'))) = 0);
RESET ROLE;

-- Demo (anonymous) user: edits their own clone like any other edit there ---------
SELECT pg_temp.login(pg_temp.id('demo'), true);
SELECT pg_temp.check('demo user: can edit a suggestion on their own cloned trip',
  pg_temp.try(pg_temp.edit_sql(pg_temp.id('demo_trip'))) = 1);
SELECT pg_temp.check('demo user: other edits on the clone work the same way (itinerary)',
  pg_temp.try(format('INSERT INTO itinerary_items (trip_id, day_date, title) VALUES (%L, %L, %L)',
    pg_temp.id('demo_trip'), '2026-11-01', 'x')) = 1);
SELECT pg_temp.check('demo user: cannot edit a real trip''s suggestion',
  pg_temp.try(pg_temp.edit_sql(pg_temp.id('trip'))) = 0);
RESET ROLE;

SELECT pg_temp.login(pg_temp.id('editor'));
SELECT pg_temp.check('editor: cannot edit a demo user''s suggestion',
  pg_temp.try(pg_temp.edit_sql(pg_temp.id('demo_trip'))) = 0);
RESET ROLE;

-- An edit shows on the public brochure ---------------------------------------------
SELECT pg_temp.login(pg_temp.id('editor'));
UPDATE suggestions SET title = 'Colosseo', description = 'Edited description', kind = 'restaurant'
 WHERE trip_id = pg_temp.id('trip');
RESET ROLE;
SELECT pg_temp.login_anon();
SELECT pg_temp.check('anon: the share page shows the edited title, description and kind',
  public.get_shared_trip('test-slug-0123456789') -> 'suggestions' -> 0
    @> '{"title": "Colosseo", "description": "Edited description", "kind": "restaurant"}'::jsonb);
RESET ROLE;
