-- The lead client (migration 024), edge cases from the final review: lead
-- powers exist only on agent trips, a lead turned viewer loses the mark,
-- grants, and what a removed or rejoining lead gets back.

CREATE FUNCTION pg_temp.err(stmt TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN EXECUTE stmt; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.err(TEXT) TO authenticated, anon;

-- Fixture ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, aud, role, is_anonymous, email_confirmed_at) VALUES
  ('00000000-0000-0000-0000-0000000002e1', 'lead2@test.local',   'authenticated', 'authenticated', false, now()),
  ('00000000-0000-0000-0000-0000000002e2', 'next@test.local',    'authenticated', 'authenticated', false, now()),
  ('00000000-0000-0000-0000-0000000002e3', 'waiting@test.local', 'authenticated', 'authenticated', false, now()),
  ('00000000-0000-0000-0000-0000000002e4', 'kid@test.local',     'authenticated', 'authenticated', false, now());
INSERT INTO ids VALUES
  ('lead2',   '00000000-0000-0000-0000-0000000002e1'),
  ('next',    '00000000-0000-0000-0000-0000000002e2'),
  ('waiting', '00000000-0000-0000-0000-0000000002e3'),
  ('kid',     '00000000-0000-0000-0000-0000000002e4'),
  ('family_trip', '10000000-0000-0000-0000-000000000007');
-- 'trip' belongs to an agent; 'family_trip' to an ordinary user (stranger).
INSERT INTO public.user_roles (user_id, role) VALUES (pg_temp.id('owner'), 'agent');
INSERT INTO public.trips (id, user_id, title, destination) VALUES
  (pg_temp.id('family_trip'), pg_temp.id('stranger'), 'Family trip', 'Crete');
INSERT INTO public.trip_members (trip_id, user_id, role, status) VALUES
  (pg_temp.id('trip'), pg_temp.id('waiting'), 'viewer', 'pending'),
  (pg_temp.id('family_trip'), pg_temp.id('kid'), 'participant', 'active');
INSERT INTO public.trip_invites (trip_id, role, token, requires_approval, created_by) VALUES
  (pg_temp.id('trip'), 'participant', 'owner-approval-link', true, pg_temp.id('owner'));
INSERT INTO public.trip_invites (trip_id, role, token, requires_approval, created_by, grants_lead, lead_email) VALUES
  (pg_temp.id('trip'), 'participant', 'lead2-token', false, pg_temp.id('owner'), true, 'lead2@test.local'),
  (pg_temp.id('family_trip'), 'participant', 'family-lead', false, pg_temp.id('stranger'), true, 'next@test.local');

-- Agent trips only ---------------------------------------------------------------------
SELECT pg_temp.login(pg_temp.id('stranger'));
SELECT pg_temp.check('family trip: the owner cannot mark a lead',
  pg_temp.err(format('SELECT public.set_trip_lead(%L)',
    (SELECT id FROM trip_members WHERE trip_id = pg_temp.id('family_trip') AND user_id = pg_temp.id('kid'))))
  = 'not_agent_trip');
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('next'));
SELECT pg_temp.check('family trip: a personal link is not valid',
  pg_temp.err($$SELECT public.accept_trip_invite('family-lead')$$) = 'invalid_invite'
  AND NOT EXISTS (SELECT 1 FROM trip_members WHERE user_id = pg_temp.id('next') AND trip_id = pg_temp.id('family_trip')));
RESET ROLE;
-- Even a lead mark set behind the app's back gives no powers on a family trip.
UPDATE public.trip_members SET is_lead = true
 WHERE trip_id = pg_temp.id('family_trip') AND user_id = pg_temp.id('kid');
SELECT pg_temp.login(pg_temp.id('kid'));
SELECT pg_temp.check('family trip: a lead mark gives no lead tools',
  NOT public.is_trip_lead(pg_temp.id('family_trip'))
  AND pg_temp.try(format('SELECT public.lead_group_link(%L)', pg_temp.id('family_trip'))) = -1
  AND pg_temp.try(format('SELECT public.lead_rotate_group_link(%L)', pg_temp.id('family_trip'))) = -1);
RESET ROLE;
SELECT pg_temp.check('is_agent_trip is not callable by clients',
  NOT has_function_privilege('anon', 'public.is_agent_trip(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.is_agent_trip(uuid)', 'EXECUTE'));

-- Grants --------------------------------------------------------------------------------
SELECT pg_temp.check('grants: anon may preview but not accept, and has no lead helpers',
  has_function_privilege('anon', 'public.invite_preview(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.accept_trip_invite(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.mask_email(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.is_trip_lead(uuid)', 'EXECUTE'));
SELECT pg_temp.check('every 024 SECURITY DEFINER function pins search_path',
  NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosecdef
    AND proname IN ('is_agent_trip','is_trip_lead','invite_preview','accept_trip_invite','lead_group_link',
                    'lead_rotate_group_link','lead_set_member_status','set_trip_lead')
    AND NOT coalesce(proconfig, '{}') @> ARRAY['search_path=public']));
SELECT pg_temp.check('a personal link email with spaces is refused',
  pg_temp.err(format($q$INSERT INTO trip_invites (trip_id, role, created_by, grants_lead, requires_approval, lead_email)
                        VALUES (%L, 'participant', %L, true, false, ' a@b.co')$q$, pg_temp.id('demo_trip'), pg_temp.id('demo')))
  LIKE '%trip_invites_lead_check%');
SELECT pg_temp.login(pg_temp.id('lead2'), true);
SELECT pg_temp.check('anonymous session cannot use an email-locked link',
  pg_temp.err($$SELECT public.accept_trip_invite('lead2-token')$$) = 'anonymous_not_allowed');
RESET ROLE;

-- What the lead can't reach ---------------------------------------------------------------
-- The lead can't see removed rows, so take the id here (as the test superuser).
INSERT INTO ids SELECT 'removed_row', id FROM public.trip_members
 WHERE trip_id = pg_temp.id('trip') AND user_id = pg_temp.id('removed');
SELECT pg_temp.login(pg_temp.id('lead2'));
SELECT public.accept_trip_invite('lead2-token');
SELECT pg_temp.check('lead: cannot create, change or revoke invites through the table',
  pg_temp.try(format($q$INSERT INTO trip_invites (trip_id, role, requires_approval, created_by)
                        VALUES (%L, 'editor', false, auth.uid())$q$, pg_temp.id('trip'))) = -1
  AND pg_temp.try($$UPDATE trip_invites SET revoked_at = now() WHERE token = 'owner-approval-link'$$) = 0);
SELECT pg_temp.check('lead: cannot edit the trip, promote themselves or read client details',
  pg_temp.try(format($q$UPDATE trips SET title = 'x' WHERE id = %L$q$, pg_temp.id('trip'))) = 0
  AND pg_temp.try(format($q$UPDATE trip_members SET role = 'editor' WHERE trip_id = %L AND user_id = auth.uid()$q$, pg_temp.id('trip'))) = 0
  AND (SELECT count(*) FROM trip_clients) = 0);
SELECT pg_temp.check('lead: approves a waiting viewer',
  pg_temp.err(format('SELECT public.lead_set_member_status(%L, %L)',
    (SELECT id FROM trip_members WHERE trip_id = pg_temp.id('trip') AND user_id = pg_temp.id('waiting')), 'active')) = 'ok');
SELECT pg_temp.check('lead: cannot reinstate a removed member',
  pg_temp.err(format('SELECT public.lead_set_member_status(%L, %L)', pg_temp.id('removed_row'), 'active')) = 'not_allowed');
SELECT pg_temp.check('lead: a status other than active or removed is refused',
  pg_temp.err(format('SELECT public.lead_set_member_status(%L, %L)',
    (SELECT id FROM trip_members WHERE trip_id = pg_temp.id('trip') AND user_id = pg_temp.id('viewer')), 'pending')) = 'bad_status');
-- Current design: the lead's new link never needs the agent, so rotating replaces
-- an approval-required owner link with an open one.
SELECT pg_temp.check('lead: rotating replaces an approval-required owner link with an open one',
  (public.lead_group_link(pg_temp.id('trip')) ->> 'requires_approval') = 'true'
  AND (public.lead_rotate_group_link(pg_temp.id('trip')) ->> 'requires_approval') = 'false');
RESET ROLE;
SELECT pg_temp.check('rotation revoked the approval-required owner link',
  (SELECT revoked_at FROM trip_invites WHERE token = 'owner-approval-link') IS NOT NULL);

-- Owner turns the lead into a viewer: the mark and the tools go -----------------------------
SELECT pg_temp.login(pg_temp.id('owner'));
UPDATE trip_members SET role = 'viewer' WHERE trip_id = pg_temp.id('trip') AND user_id = pg_temp.id('lead2');
SELECT pg_temp.check('owner: making the lead a viewer clears the lead mark',
  NOT (SELECT is_lead FROM trip_members WHERE trip_id = pg_temp.id('trip') AND user_id = pg_temp.id('lead2')));
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('lead2'));
SELECT pg_temp.check('lead turned viewer: no lead tools',
  NOT public.is_trip_lead(pg_temp.id('trip'))
  AND pg_temp.try(format('SELECT public.lead_group_link(%L)', pg_temp.id('trip'))) = -1);
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('owner'));
SELECT public.set_trip_lead((SELECT id FROM trip_members WHERE trip_id = pg_temp.id('trip') AND user_id = pg_temp.id('lead2')));
SELECT pg_temp.check('owner: marking them lead again makes them a participant lead',
  (SELECT role = 'participant' AND is_lead FROM trip_members
    WHERE trip_id = pg_temp.id('trip') AND user_id = pg_temp.id('lead2')));

-- Owner removes the lead: tools gone, place freed, removal sticks ---------------------------
UPDATE trip_members SET status = 'removed' WHERE trip_id = pg_temp.id('trip') AND user_id = pg_temp.id('lead2');
INSERT INTO trip_invites (trip_id, role, token, requires_approval, grants_lead, lead_email)
  VALUES (pg_temp.id('trip'), 'participant', 'lead2-again', false, true, 'lead2@test.local');
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('lead2'));
SELECT pg_temp.check('removed lead: no lead tools, no trip',
  NOT public.is_trip_lead(pg_temp.id('trip'))
  AND pg_temp.try(format('SELECT public.lead_group_link(%L)', pg_temp.id('trip'))) = -1
  AND (SELECT count(*) FROM trips WHERE id = pg_temp.id('trip')) = 0);
SELECT pg_temp.check('removed lead: a new personal link for the same email does not bring them back',
  (SELECT public.accept_trip_invite('lead2-again') ->> 'status') = 'removed');
RESET ROLE;
SELECT pg_temp.check('removed lead: the new personal link is not used up by them',
  (SELECT revoked_at FROM trip_invites WHERE token = 'lead2-again') IS NULL);
UPDATE trip_invites SET lead_email = 'next@test.local' WHERE token = 'lead2-again';
SELECT pg_temp.login(pg_temp.id('next'));
SELECT pg_temp.check('after the lead is removed, a new client can become the lead',
  (SELECT public.accept_trip_invite('lead2-again') ->> 'status') = 'active');
SELECT pg_temp.check('the new lead has the tools', public.is_trip_lead(pg_temp.id('trip')));
RESET ROLE;

-- A lead who leaves and rejoins through the group link is a plain participant ----------------
SELECT pg_temp.login(pg_temp.id('next'));
CREATE TEMP TABLE g (token TEXT) ON COMMIT DROP;
GRANT ALL ON g TO authenticated;
INSERT INTO g SELECT public.lead_group_link(pg_temp.id('trip')) ->> 'token';
SELECT pg_temp.check('an active lead can leave',
  pg_temp.try(format('DELETE FROM trip_members WHERE trip_id = %L AND user_id = auth.uid()', pg_temp.id('trip'))) = 1);
DELETE FROM trip_members WHERE trip_id = pg_temp.id('trip') AND user_id = auth.uid();
SELECT pg_temp.check('rejoining through the group link does not restore the lead mark',
  (SELECT public.accept_trip_invite((SELECT token FROM g)) ->> 'status') = 'active');
SELECT pg_temp.check('rejoined: no lead tools', NOT public.is_trip_lead(pg_temp.id('trip')));
RESET ROLE;
