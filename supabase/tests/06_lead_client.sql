-- The lead client (migration 024): a personal, single-use link locked to the
-- client's email (or approved once by the owner), and what the lead can and
-- can't do with the group's access.

-- The error text a statement raises, or 'ok'. Unlike try(), it keeps the effect.
CREATE FUNCTION pg_temp.err(stmt TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.err(TEXT) TO authenticated, anon;

-- Fixture ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, aud, role, is_anonymous, email_confirmed_at) VALUES
  ('00000000-0000-0000-0000-0000000001e1', 'lead@test.local',     'authenticated', 'authenticated', false, now()),
  ('00000000-0000-0000-0000-0000000001e2', 'imposter@test.local', 'authenticated', 'authenticated', false, now()),
  ('00000000-0000-0000-0000-0000000001e3', 'friend@test.local',   'authenticated', 'authenticated', false, now()),
  ('00000000-0000-0000-0000-0000000001e4', 'client3@test.local',  'authenticated', 'authenticated', false, now()),
  ('00000000-0000-0000-0000-0000000001e5', 'cousin@test.local',   'authenticated', 'authenticated', false, now());
INSERT INTO ids VALUES
  ('lead',     '00000000-0000-0000-0000-0000000001e1'),
  ('imposter', '00000000-0000-0000-0000-0000000001e2'),
  ('friend',   '00000000-0000-0000-0000-0000000001e3'),
  ('client3',  '00000000-0000-0000-0000-0000000001e4'),
  ('cousin',   '00000000-0000-0000-0000-0000000001e5'),
  ('trip3',    '10000000-0000-0000-0000-000000000003'),
  ('other_trip', '10000000-0000-0000-0000-000000000004');
INSERT INTO public.trips (id, user_id, title, destination) VALUES
  (pg_temp.id('trip3'), pg_temp.id('owner'), 'No-email trip', 'Prague'),
  (pg_temp.id('other_trip'), pg_temp.id('stranger'), 'Someone else', 'Paris');
-- The lead exists only on agent trips (is_agent_trip); the fixture owner is an agent here.
INSERT INTO public.user_roles (user_id, role) VALUES (pg_temp.id('owner'), 'agent');
INSERT INTO public.trip_members (trip_id, user_id, role, status) VALUES
  (pg_temp.id('other_trip'), pg_temp.id('cousin'), 'participant', 'active'),
  (pg_temp.id('trip3'), pg_temp.id('cousin'), 'participant', 'active');
INSERT INTO public.trip_invites (trip_id, role, token, requires_approval, created_by, grants_lead, lead_email) VALUES
  (pg_temp.id('trip'),  'participant', 'lead-token',    false, pg_temp.id('owner'), true, 'Lead@Test.local'),
  (pg_temp.id('trip3'), 'participant', 'lead-no-email', false, pg_temp.id('owner'), true, NULL);

-- The link and its preview -------------------------------------------------------------
SELECT pg_temp.login_anon();
SELECT pg_temp.check('preview: says it is a personal link, email masked',
  (SELECT public.invite_preview('lead-token') ->> 'grants_lead') = 'true'
  AND (SELECT public.invite_preview('lead-token') ->> 'lead_email_hint') = 'Le***@Test.local');
RESET ROLE;
-- other_trip has no live personal link, so only the CHECK can reject these.
SELECT pg_temp.check('a personal link must be a participant link',
  pg_temp.err(format($q$INSERT INTO trip_invites (trip_id, role, created_by, grants_lead, requires_approval)
                        VALUES (%L, 'editor', %L, true, false)$q$, pg_temp.id('other_trip'), pg_temp.id('stranger')))
  LIKE '%trip_invites_lead_check%');
SELECT pg_temp.check('a personal link cannot require approval',
  pg_temp.err(format($q$INSERT INTO trip_invites (trip_id, role, created_by, grants_lead, requires_approval)
                        VALUES (%L, 'participant', %L, true, true)$q$, pg_temp.id('other_trip'), pg_temp.id('stranger')))
  LIKE '%trip_invites_lead_check%');
SELECT pg_temp.check('only a personal link carries an email',
  pg_temp.err(format($q$INSERT INTO trip_invites (trip_id, role, created_by, lead_email)
                        VALUES (%L, 'viewer', %L, 'x@y.z')$q$, pg_temp.id('other_trip'), pg_temp.id('stranger')))
  LIKE '%trip_invites_lead_check%');
SELECT pg_temp.check('short addresses are masked to one letter',
  public.mask_email('ab@x.com') = 'a***@x.com' AND public.mask_email('dana@x.com') = 'da***@x.com');

-- Email lock ---------------------------------------------------------------------------
SELECT pg_temp.login(pg_temp.id('imposter'));
SELECT pg_temp.check('another account cannot use the personal link',
  pg_temp.err($$SELECT public.accept_trip_invite('lead-token')$$) = 'wrong_account');
RESET ROLE;
SELECT pg_temp.check('a wrong account does not use the link up',
  (SELECT revoked_at FROM trip_invites WHERE token = 'lead-token') IS NULL
  AND NOT EXISTS (SELECT 1 FROM trip_members WHERE user_id = pg_temp.id('imposter')));

UPDATE auth.users SET email_confirmed_at = NULL WHERE id = pg_temp.id('lead');
SELECT pg_temp.login(pg_temp.id('lead'));
SELECT pg_temp.check('the right address, not yet confirmed, is refused',
  pg_temp.err($$SELECT public.accept_trip_invite('lead-token')$$) = 'wrong_account');
RESET ROLE;
UPDATE auth.users SET email_confirmed_at = now() WHERE id = pg_temp.id('lead');

SELECT pg_temp.login(pg_temp.id('lead'));
SELECT pg_temp.check('the client (any letter case) joins at once as the lead',
  (SELECT public.accept_trip_invite('lead-token') ->> 'status') = 'active');
SELECT pg_temp.check('lead: sees the trip, is a participant, cannot edit',
  (SELECT count(*) FROM trips WHERE id = pg_temp.id('trip')) = 1
  AND public.trip_role(pg_temp.id('trip')) = 'participant'
  AND NOT public.can_edit_trip(pg_temp.id('trip'))
  AND public.is_trip_lead(pg_temp.id('trip')));
SELECT pg_temp.check('lead: cannot change members directly (table RLS unchanged)',
  pg_temp.try(format($q$UPDATE trip_members SET status = 'removed' WHERE trip_id = %L AND user_id = %L$q$,
                     pg_temp.id('trip'), pg_temp.id('participant'))) = 0);
SELECT pg_temp.check('lead: sees pending joiners',
  (SELECT count(*) FROM trip_members WHERE trip_id = pg_temp.id('trip') AND status = 'pending') = 1);
SELECT pg_temp.check('lead: does not see members the owner removed',
  (SELECT count(*) FROM trip_members WHERE trip_id = pg_temp.id('trip') AND status = 'removed') = 0);
SELECT pg_temp.check('lead: cannot read the invites table',
  (SELECT count(*) FROM trip_invites) = 0);
RESET ROLE;

SELECT pg_temp.check('the personal link is used up',
  (SELECT revoked_at FROM trip_invites WHERE token = 'lead-token') IS NOT NULL);
SELECT pg_temp.login_anon();
SELECT pg_temp.check('a used personal link has no preview (and no email hint) any more',
  public.invite_preview('lead-token') IS NULL);
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('imposter'));
SELECT pg_temp.check('a used personal link no longer works for anyone',
  pg_temp.err($$SELECT public.accept_trip_invite('lead-token')$$) = 'invalid_invite');
RESET ROLE;

-- The group link ---------------------------------------------------------------------------
SELECT pg_temp.login(pg_temp.id('lead'));
CREATE TEMP TABLE links (k TEXT PRIMARY KEY, token TEXT) ON COMMIT DROP;
GRANT ALL ON links TO authenticated;
INSERT INTO links SELECT 'g1', public.lead_group_link(pg_temp.id('trip')) ->> 'token';
SELECT pg_temp.check('lead: gets a group link that needs no approval',
  (SELECT token FROM links WHERE k = 'g1') IS NOT NULL
  AND (public.lead_group_link(pg_temp.id('trip')) ->> 'requires_approval') = 'false');
SELECT pg_temp.check('lead: the same link comes back each time',
  (public.lead_group_link(pg_temp.id('trip')) ->> 'token') = (SELECT token FROM links WHERE k = 'g1'));
RESET ROLE;

SELECT pg_temp.login(pg_temp.id('friend'));
SELECT pg_temp.check('a family member joins through the group link at once',
  (SELECT public.accept_trip_invite((SELECT token FROM links WHERE k = 'g1')) ->> 'status') = 'active');
-- A separate statement: the join is not visible inside the statement that made it.
SELECT pg_temp.check('the family member sees the trip',
  (SELECT count(*) FROM trips WHERE id = pg_temp.id('trip')) = 1);
RESET ROLE;

-- Removing people -----------------------------------------------------------------------------
SELECT pg_temp.login(pg_temp.id('lead'));
SELECT pg_temp.check('lead: removes a family member',
  pg_temp.err(format('SELECT public.lead_set_member_status(%L, %L)',
    (SELECT id FROM trip_members WHERE trip_id = pg_temp.id('trip') AND user_id = pg_temp.id('friend')), 'removed')) = 'ok');
SELECT pg_temp.check('lead: cannot approve a pending editor',
  pg_temp.try(format('SELECT public.lead_set_member_status(%L, %L)',
    (SELECT id FROM trip_members WHERE trip_id = pg_temp.id('trip') AND user_id = pg_temp.id('pending')), 'active')) = -1);
RESET ROLE;
INSERT INTO trip_members (trip_id, user_id, role, status) VALUES (pg_temp.id('trip'), pg_temp.id('client3'), 'participant', 'pending');
SELECT pg_temp.login(pg_temp.id('lead'));
SELECT pg_temp.check('lead: approves a waiting participant',
  pg_temp.err(format('SELECT public.lead_set_member_status(%L, %L)',
    (SELECT id FROM trip_members WHERE trip_id = pg_temp.id('trip') AND user_id = pg_temp.id('client3')), 'active')) = 'ok');
SELECT pg_temp.check('lead: cannot remove an editor or themselves',
  pg_temp.try(format('SELECT public.lead_set_member_status(%L, %L)',
    (SELECT id FROM trip_members WHERE trip_id = pg_temp.id('trip') AND user_id = pg_temp.id('editor')), 'removed')) = -1
  AND pg_temp.try(format('SELECT public.lead_set_member_status(%L, %L)',
    (SELECT id FROM trip_members WHERE trip_id = pg_temp.id('trip') AND user_id = pg_temp.id('lead')), 'removed')) = -1);
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('lead'));
SELECT pg_temp.check('lead: cannot act on another trip''s members',
  pg_temp.try(format('SELECT public.lead_set_member_status(%L, %L)',
    (SELECT id FROM public.trip_members WHERE trip_id = pg_temp.id('other_trip') AND user_id = pg_temp.id('cousin')),
    'removed')) = -1);
SELECT pg_temp.check('lead: cannot move the lead mark (owner only)',
  pg_temp.try(format('SELECT public.set_trip_lead(%L)',
    (SELECT id FROM trip_members WHERE trip_id = pg_temp.id('trip') AND user_id = pg_temp.id('participant')))) = -1);
RESET ROLE;
SELECT pg_temp.check('another trip''s member was not touched',
  (SELECT status FROM trip_members WHERE trip_id = pg_temp.id('other_trip') AND user_id = pg_temp.id('cousin')) = 'active');

SELECT pg_temp.login(pg_temp.id('friend'));
SELECT pg_temp.check('removed family member: loses the trip and cannot rejoin with the same link',
  (SELECT count(*) FROM trips WHERE id = pg_temp.id('trip')) = 0
  AND (SELECT public.accept_trip_invite((SELECT token FROM links WHERE k = 'g1')) ->> 'status') = 'removed');
RESET ROLE;

-- Replacing a leaked link ----------------------------------------------------------------------
SELECT pg_temp.login(pg_temp.id('lead'));
INSERT INTO links SELECT 'g2', public.lead_rotate_group_link(pg_temp.id('trip')) ->> 'token';
SELECT pg_temp.check('lead: a replaced link is new',
  (SELECT token FROM links WHERE k = 'g2') <> (SELECT token FROM links WHERE k = 'g1'));
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('imposter'));
SELECT pg_temp.check('the old group link stops working',
  pg_temp.err(format('SELECT public.accept_trip_invite(%L)', (SELECT token FROM links WHERE k = 'g1'))) = 'invalid_invite');
SELECT pg_temp.check('the new group link works',
  (SELECT public.accept_trip_invite((SELECT token FROM links WHERE k = 'g2')) ->> 'status') = 'active');
RESET ROLE;
SELECT pg_temp.check('people already in stay after the link is replaced',
  (SELECT status FROM trip_members WHERE trip_id = pg_temp.id('trip') AND user_id = pg_temp.id('participant')) = 'active');

-- A removal sticks: deleting your own 'removed' row ("leave") doesn't reopen the door.
SELECT pg_temp.login(pg_temp.id('friend'));
SELECT pg_temp.check('removed member: cannot delete their own removed row',
  pg_temp.try(format('DELETE FROM trip_members WHERE trip_id = %L AND user_id = auth.uid()', pg_temp.id('trip'))) = 0);
SELECT pg_temp.check('removed by the lead: the new group link does not bring them back',
  (SELECT public.accept_trip_invite((SELECT token FROM links WHERE k = 'g2')) ->> 'status') = 'removed');
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('removed'));
SELECT pg_temp.check('removed by the owner: cannot delete the row and rejoin',
  pg_temp.try(format('DELETE FROM trip_members WHERE trip_id = %L AND user_id = auth.uid()', pg_temp.id('trip'))) = 0
  AND (SELECT public.accept_trip_invite('test-invite-token') ->> 'status') = 'removed');
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('viewer'));
SELECT pg_temp.check('an active member can still leave',
  pg_temp.try(format('DELETE FROM trip_members WHERE trip_id = %L AND user_id = auth.uid()', pg_temp.id('trip'))) = 1);
RESET ROLE;

-- Nobody else gets the lead tools -----------------------------------------------------------------
SELECT pg_temp.login(pg_temp.id('participant'));
SELECT pg_temp.check('regular participant: no lead tools',
  pg_temp.try(format('SELECT public.lead_group_link(%L)', pg_temp.id('trip'))) = -1
  AND pg_temp.try(format('SELECT public.lead_rotate_group_link(%L)', pg_temp.id('trip'))) = -1
  AND pg_temp.try(format('SELECT public.lead_set_member_status(%L, %L)',
    (SELECT id FROM trip_members WHERE trip_id = pg_temp.id('trip') AND user_id = pg_temp.id('viewer')), 'removed')) = -1);
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('stranger'));
SELECT pg_temp.check('stranger: no lead tools',
  pg_temp.try(format('SELECT public.lead_group_link(%L)', pg_temp.id('trip'))) = -1);
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('demo'), true);
SELECT pg_temp.check('demo visitor: no lead tools',
  pg_temp.try(format('SELECT public.lead_group_link(%L)', pg_temp.id('trip'))) = -1
  AND pg_temp.try(format('SELECT public.lead_rotate_group_link(%L)', pg_temp.id('trip'))) = -1
  AND pg_temp.try(format('SELECT public.set_trip_lead(%L)',
    (SELECT id FROM public.trip_members WHERE user_id = pg_temp.id('participant') AND trip_id = pg_temp.id('trip')))) = -1);
RESET ROLE;
SELECT pg_temp.login_anon();
SELECT pg_temp.check('logged out: cannot call the lead tools',
  pg_temp.try(format('SELECT public.lead_group_link(%L)', pg_temp.id('trip'))) = -1
  AND pg_temp.try(format('SELECT public.lead_rotate_group_link(%L)', pg_temp.id('trip'))) = -1
  AND pg_temp.try(format('SELECT public.lead_set_member_status(%L, %L)', gen_random_uuid(), 'removed')) = -1
  AND pg_temp.try(format('SELECT public.set_trip_lead(%L)', gen_random_uuid())) = -1);
RESET ROLE;

-- Edge cases of the personal link ------------------------------------------------------------------
INSERT INTO ids VALUES ('trip5', '10000000-0000-0000-0000-000000000005'),
                       ('trip6', '10000000-0000-0000-0000-000000000006'),
                       ('phoneonly', '00000000-0000-0000-0000-0000000001e6');
INSERT INTO public.trips (id, user_id, title, destination) VALUES
  (pg_temp.id('trip5'), pg_temp.id('owner'), 'Pending editor trip', 'Vienna'),
  (pg_temp.id('trip6'), pg_temp.id('owner'), 'Viewer trip', 'Lisbon');
INSERT INTO public.trip_members (trip_id, user_id, role, status) VALUES
  (pg_temp.id('trip5'), pg_temp.id('lead'),   'editor', 'pending'),
  (pg_temp.id('trip6'), pg_temp.id('cousin'), 'viewer', 'active');
INSERT INTO public.trip_invites (trip_id, role, token, requires_approval, created_by, grants_lead, lead_email) VALUES
  (pg_temp.id('trip5'), 'participant', 'lead-pending-editor', false, pg_temp.id('owner'), true, 'lead@test.local'),
  (pg_temp.id('trip6'), 'participant', 'lead-viewer',         false, pg_temp.id('owner'), true, 'cousin@test.local');
INSERT INTO auth.users (id, phone, aud, role, is_anonymous, phone_confirmed_at)
  VALUES (pg_temp.id('phoneonly'), '972500000001', 'authenticated', 'authenticated', false, now());

SELECT pg_temp.login(pg_temp.id('lead'));
SELECT public.accept_trip_invite('lead-pending-editor');
SELECT pg_temp.check('pending editor + personal link: a participant lead, no edit rights',
  public.trip_role(pg_temp.id('trip5')) = 'participant' AND NOT public.can_edit_trip(pg_temp.id('trip5'))
  AND public.is_trip_lead(pg_temp.id('trip5')));
RESET ROLE;

SELECT pg_temp.login(pg_temp.id('phoneonly'));
SELECT pg_temp.check('an account without an email cannot use an email-locked link',
  pg_temp.err($$SELECT public.accept_trip_invite('lead-viewer')$$) = 'wrong_account');
RESET ROLE;
SELECT pg_temp.check('the email-locked link is still live after that',
  (SELECT revoked_at FROM trip_invites WHERE token = 'lead-viewer') IS NULL);

SELECT pg_temp.login(pg_temp.id('cousin'));
SELECT public.accept_trip_invite('lead-viewer');
SELECT pg_temp.check('active viewer with the matching email: becomes a participant lead, still no edit',
  public.trip_role(pg_temp.id('trip6')) = 'participant' AND public.is_trip_lead(pg_temp.id('trip6'))
  AND NOT public.can_edit_trip(pg_temp.id('trip6')));
RESET ROLE;

SELECT pg_temp.login(pg_temp.id('owner'));
SELECT pg_temp.check('owner: a personal link cannot be switched to require approval',
  pg_temp.try($$UPDATE trip_invites SET requires_approval = true WHERE token = 'lead-pending-editor'$$) <= 0);
RESET ROLE;

-- Owner moves the lead mark -----------------------------------------------------------------------
SELECT pg_temp.login(pg_temp.id('owner'));
SELECT pg_temp.check('owner: moves the lead to another member, never two leads',
  pg_temp.err(format('SELECT public.set_trip_lead(%L)',
    (SELECT id FROM trip_members WHERE trip_id = pg_temp.id('trip') AND user_id = pg_temp.id('participant')))) = 'ok');
SELECT pg_temp.check('owner: the old lead mark is cleared',
  (SELECT array_agg(user_id) FROM trip_members WHERE trip_id = pg_temp.id('trip') AND is_lead) = ARRAY[pg_temp.id('participant')]);
RESET ROLE;
SELECT pg_temp.check('a second lead row is impossible',
  pg_temp.err(format('UPDATE trip_members SET is_lead = true WHERE trip_id = %L AND user_id = %L',
    pg_temp.id('trip'), pg_temp.id('editor'))) LIKE '%trip_members_one_lead_idx%');

-- No email: the owner approves the lead once -----------------------------------------------------------
SELECT pg_temp.login(pg_temp.id('cousin'));
SELECT pg_temp.check('no email: someone already on the trip is not made lead, link not used up',
  (SELECT public.accept_trip_invite('lead-no-email') ->> 'status') = 'active'
  AND NOT public.is_trip_lead(pg_temp.id('trip3')));
SELECT pg_temp.check('no email: someone already on the trip is told they were not made lead',
  (SELECT public.accept_trip_invite('lead-no-email') ->> 'not_lead') = 'true');
RESET ROLE;
SELECT pg_temp.check('no email: the link is still live after that',
  (SELECT revoked_at FROM trip_invites WHERE token = 'lead-no-email') IS NULL);

SELECT pg_temp.login(pg_temp.id('client3'));
SELECT pg_temp.check('no email: the client waits for the owner',
  (SELECT public.accept_trip_invite('lead-no-email') ->> 'status') = 'pending');
SELECT pg_temp.check('no email: a waiting lead does not see the trip yet',
  (SELECT count(*) FROM trips WHERE id = pg_temp.id('trip3')) = 0);
SELECT pg_temp.check('no email: a waiting lead has no lead tools',
  pg_temp.try(format('SELECT public.lead_group_link(%L)', pg_temp.id('trip3'))) = -1);
RESET ROLE;
SELECT pg_temp.check('no email: the link is used up',
  (SELECT revoked_at FROM trip_invites WHERE token = 'lead-no-email') IS NOT NULL);
INSERT INTO trip_invites (trip_id, role, token, requires_approval, created_by, grants_lead)
  VALUES (pg_temp.id('trip3'), 'participant', 'lead-while-pending', false, pg_temp.id('owner'), true);
SELECT pg_temp.login(pg_temp.id('imposter'));
SELECT pg_temp.check('a waiting lead already holds the place: no second lead',
  pg_temp.err($$SELECT public.accept_trip_invite('lead-while-pending')$$) = 'lead_taken');
RESET ROLE;
UPDATE trip_invites SET revoked_at = now() WHERE token = 'lead-while-pending';

SELECT pg_temp.login(pg_temp.id('owner'));
SELECT pg_temp.check('owner: approves the waiting lead',
  pg_temp.try(format($q$UPDATE trip_members SET status = 'active' WHERE trip_id = %L AND user_id = %L$q$,
    pg_temp.id('trip3'), pg_temp.id('client3'))) = 1);
UPDATE trip_members SET status = 'active' WHERE trip_id = pg_temp.id('trip3') AND user_id = pg_temp.id('client3');
INSERT INTO trip_invites (trip_id, role, token, requires_approval, grants_lead)
  VALUES (pg_temp.id('trip3'), 'participant', 'lead-second', false, true);
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('client3'));
SELECT pg_temp.check('approved lead: gets the lead tools', public.is_trip_lead(pg_temp.id('trip3')));
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('imposter'));
SELECT pg_temp.check('a second personal link cannot make a second lead',
  pg_temp.err($$SELECT public.accept_trip_invite('lead-second')$$) = 'lead_taken'
  AND NOT EXISTS (SELECT 1 FROM trip_members WHERE user_id = pg_temp.id('imposter') AND trip_id = pg_temp.id('trip3')));
RESET ROLE;

-- Regular trips are unchanged --------------------------------------------------------------------------
SELECT pg_temp.login(pg_temp.id('owner'));
INSERT INTO trip_invites (trip_id, role, token) VALUES (pg_temp.id('trip3'), 'viewer', 'plain-viewer');
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('stranger'));
SELECT pg_temp.check('a regular new link still waits for the owner',
  (SELECT public.accept_trip_invite('plain-viewer') ->> 'status') = 'pending');
RESET ROLE;
