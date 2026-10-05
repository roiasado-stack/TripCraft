-- Logged-out visitors (the /share/:slug brochure, /join/:token preview) and
-- anonymous demo users ("try it yourself").

-- Logged-out visitor -------------------------------------------------------------
SELECT pg_temp.login_anon();
SELECT pg_temp.check('anon: cannot read the trips table at all',
  pg_temp.try('SELECT * FROM trips') = -1);
SELECT pg_temp.check('anon: cannot read flights / participants / profiles',
  pg_temp.try('SELECT * FROM flights') = -1
  AND pg_temp.try('SELECT * FROM participants') = -1
  AND pg_temp.try('SELECT * FROM profiles') = -1);
SELECT pg_temp.check('anon: get_shared_trip returns the trip for the exact slug',
  public.get_shared_trip('test-slug-0123456789') -> 'trip' ->> 'title' = 'Test trip');
SELECT pg_temp.check('anon: get_shared_trip returns NULL for a wrong or partial slug',
  public.get_shared_trip('test-slug') IS NULL AND public.get_shared_trip('') IS NULL);
SELECT pg_temp.check('anon: the brochure includes flights, stays and itinerary (so the leak check below means something)',
  jsonb_array_length(public.get_shared_trip('test-slug-0123456789') -> 'flights') = 1
  AND jsonb_array_length(public.get_shared_trip('test-slug-0123456789') -> 'stays') = 1
  AND jsonb_array_length(public.get_shared_trip('test-slug-0123456789') -> 'itinerary') = 1);
SELECT pg_temp.check('anon: shared brochure leaks no ' || leak, position(leak in public.get_shared_trip('test-slug-0123456789')::text) = 0)
FROM unnest(ARRAY['SECRET-REF', 'SECRET-PHONE', 'SECRET-NOTE', 'SECRET-SEAT', 'OWNER NOTES', 'PARTICIPANT NAME',
                  'passport', 'voucher', 'shared item', 'test-invite-token', 'owner question', '@test.local']) AS leak;
SELECT pg_temp.check('anon: invite preview shows the trip for a valid token only',
  public.invite_preview('test-invite-token') ->> 'role' = 'editor'
  AND public.invite_preview('nope') IS NULL);
SELECT pg_temp.check('anon: invite preview does not expose the trip id or owner',
  NOT (public.invite_preview('test-invite-token') ?| ARRAY['id', 'trip_id', 'user_id', 'token']));
SELECT pg_temp.check('anon: cannot accept an invite or clone a showcase',
  pg_temp.try($$SELECT public.accept_trip_invite('test-invite-token')$$) = -1
  AND pg_temp.try($$SELECT public.clone_showcase_trip('test-slug-0123456789')$$) = -1);
SELECT pg_temp.check('anon: cannot read AI spend totals',
  pg_temp.try('SELECT public.app_agent_daily_cost_usd()') = -1);
RESET ROLE;

-- Unshared trip is invisible even with the old slug -----------------------------------
UPDATE public.trips SET is_shared = false WHERE id = pg_temp.id('trip');
SELECT pg_temp.login_anon();
SELECT pg_temp.check('anon: an unshared trip disappears from its old link',
  public.get_shared_trip('test-slug-0123456789') IS NULL);
RESET ROLE;
UPDATE public.trips SET is_shared = true WHERE id = pg_temp.id('trip');

-- Anonymous demo user --------------------------------------------------------------
SELECT pg_temp.login(pg_temp.id('demo'), true);
SELECT pg_temp.check('demo user: sees only their own cloned trip',
  (SELECT array_agg(id) FROM trips) = ARRAY[pg_temp.id('demo_trip')]);
SELECT pg_temp.check('demo user: cannot create invite links',
  pg_temp.try(format('INSERT INTO trip_invites (trip_id, role) VALUES (%L, %L)', pg_temp.id('demo_trip'), 'viewer')) = -1);
SELECT pg_temp.check('demo user: cannot join someone else''s trip',
  pg_temp.try($$SELECT public.accept_trip_invite('test-invite-token')$$) = -1);
RESET ROLE;
