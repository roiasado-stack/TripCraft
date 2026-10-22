-- Web push (migration 026): devices, settings and mutes are each user's own;
-- a trip update reaches the trip's other members, a join request reaches the
-- owner only, and nothing is queued for a trip nobody else is in.

-- Fixture: a device for every fixture user except the demo --------------------------
INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth)
SELECT pg_temp.id(k), 'https://fcm.googleapis.com/fcm/send/' || k, 'P256DH-' || k, 'AUTH-' || k
FROM unnest(ARRAY['owner', 'editor', 'participant', 'viewer', 'pending', 'removed', 'stranger']) AS k;

-- A trip with no members: the stranger's own.
INSERT INTO ids VALUES ('lone_trip', '10000000-0000-0000-0000-0000000000b9');
INSERT INTO public.trips (id, user_id, title, destination) VALUES
  (pg_temp.id('lone_trip'), pg_temp.id('stranger'), 'Lone trip', 'Oslo');

-- Wire the triggers to a fake notify URL (rolled back with the rest).
DELETE FROM vault.secrets WHERE name IN ('notify_url', 'notify_secret');
SELECT vault.create_secret('http://notify.test.invalid/functions/v1/notify', 'notify_url');
SELECT vault.create_secret('TEST-NOTIFY-SECRET', 'notify_secret');

-- Calls queued for one row id (pg_net's queue; nothing is sent from a rolled-back transaction).
CREATE FUNCTION pg_temp.queued(p_type TEXT, p_id UUID) RETURNS INT LANGUAGE sql AS $$
  SELECT count(*)::int FROM net.http_request_queue q
  WHERE convert_from(q.body, 'UTF8')::jsonb = jsonb_build_object('type', p_type, 'id', p_id)
$$;
CREATE FUNCTION pg_temp.update_recipients(p_id UUID) RETURNS TEXT LANGUAGE sql AS $$
  SELECT coalesce(string_agg(i.k, ',' ORDER BY i.k), '')
  FROM public.push_recipients_for_update(p_id) r(user_id) JOIN ids i ON i.id = r.user_id
$$;
CREATE FUNCTION pg_temp.join_recipients(p_id UUID) RETURNS TEXT LANGUAGE sql AS $$
  SELECT coalesce(string_agg(i.k, ',' ORDER BY i.k), '')
  FROM public.push_recipients_for_join(p_id) r(user_id) JOIN ids i ON i.id = r.user_id
$$;

-- 1. Devices are each user's own -----------------------------------------------------------
SELECT pg_temp.login(pg_temp.id('participant'));
SELECT pg_temp.check('subscriptions: a user sees only their own device',
  (SELECT count(*) FROM public.push_subscriptions) = 1
  AND (SELECT user_id FROM public.push_subscriptions) = pg_temp.id('participant'));
SELECT pg_temp.check('subscriptions: can''t delete another user''s device',
  pg_temp.try($$DELETE FROM public.push_subscriptions WHERE user_id = '00000000-0000-0000-0000-00000000000a'$$) = 0);
SELECT pg_temp.check('subscriptions: can''t update another user''s device',
  pg_temp.try($$UPDATE public.push_subscriptions SET last_ok_at = now() WHERE user_id = '00000000-0000-0000-0000-00000000000a'$$) = 0);
SELECT pg_temp.check('subscriptions: can''t move a device to another user',
  pg_temp.try($$UPDATE public.push_subscriptions SET user_id = '00000000-0000-0000-0000-00000000000a'$$) = -1);
SELECT pg_temp.check('subscriptions: can''t add a device in another user''s name',
  pg_temp.try($$INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth)
               VALUES ('00000000-0000-0000-0000-00000000000a', 'https://fcm.googleapis.com/fcm/send/x', 'k', 'a')$$) = -1);
SELECT pg_temp.check('subscriptions: adds a second device of their own',
  pg_temp.try($$INSERT INTO public.push_subscriptions (endpoint, p256dh, auth)
               VALUES ('https://web.push.apple.com/QGx-participant-2', 'k', 'a')$$) = 1);
SELECT pg_temp.check('subscriptions: an endpoint outside the push services is refused',
  pg_temp.try($$INSERT INTO public.push_subscriptions (endpoint, p256dh, auth)
               VALUES ('https://evil.example.com/fcm.googleapis.com/x', 'k', 'a')$$) = -1);
SELECT pg_temp.check('subscriptions: a plain-http endpoint is refused',
  pg_temp.try($$INSERT INTO public.push_subscriptions (endpoint, p256dh, auth)
               VALUES ('http://fcm.googleapis.com/fcm/send/x', 'k', 'a')$$) = -1);
SELECT pg_temp.check('subscriptions: deletes their own device',
  pg_temp.try($$DELETE FROM public.push_subscriptions$$) = 1);
RESET ROLE;

SELECT pg_temp.login(pg_temp.id('demo'), true);
SELECT pg_temp.check('subscriptions: a demo user can''t add a device',
  pg_temp.try($$INSERT INTO public.push_subscriptions (endpoint, p256dh, auth)
               VALUES ('https://fcm.googleapis.com/fcm/send/demo', 'k', 'a')$$) = -1);
RESET ROLE;

SELECT pg_temp.login_anon();
SELECT pg_temp.check('anon: can''t read devices',
  pg_temp.try($$SELECT * FROM public.push_subscriptions$$) = -1);
SELECT pg_temp.check('anon: can''t read settings',
  pg_temp.try($$SELECT * FROM public.notification_settings$$) = -1);
SELECT pg_temp.check('anon: can''t read mutes',
  pg_temp.try($$SELECT * FROM public.trip_notification_mutes$$) = -1);
RESET ROLE;
SELECT pg_temp.check('anon: no grant at all on the three tables',
  NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
              WHERE grantee IN ('anon', 'PUBLIC') AND table_schema = 'public'
                AND table_name IN ('push_subscriptions', 'notification_settings', 'trip_notification_mutes')));

-- Settings and mutes are each user's own ------------------------------------------------------
INSERT INTO public.notification_settings (user_id, trip_updates) VALUES (pg_temp.id('owner'), true);
SELECT pg_temp.login(pg_temp.id('participant'));
SELECT pg_temp.check('settings: can''t see another user''s row',
  NOT EXISTS (SELECT 1 FROM public.notification_settings));
SELECT pg_temp.check('settings: can''t change another user''s row',
  pg_temp.try($$UPDATE public.notification_settings SET trip_updates = false$$) = 0);
SELECT pg_temp.check('settings: can''t write a row in another user''s name',
  pg_temp.try($$INSERT INTO public.notification_settings (user_id) VALUES ('00000000-0000-0000-0000-0000000000f1')$$) = -1);
SELECT pg_temp.check('settings: writes their own row',
  pg_temp.try($$INSERT INTO public.notification_settings (join_requests) VALUES (false)$$) = 1);
SELECT pg_temp.check('mutes: mutes a trip they are in',
  pg_temp.try($$INSERT INTO public.trip_notification_mutes (trip_id) VALUES ('10000000-0000-0000-0000-000000000001')$$) = 1);
SELECT pg_temp.check('mutes: can''t mute in another user''s name',
  pg_temp.try($$INSERT INTO public.trip_notification_mutes (user_id, trip_id)
               VALUES ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001')$$) = -1);
SELECT pg_temp.check('mutes: can''t mute a trip they can''t see',
  pg_temp.try($$INSERT INTO public.trip_notification_mutes (trip_id) VALUES ('10000000-0000-0000-0000-0000000000b9')$$) = -1);
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('pending'));
SELECT pg_temp.check('mutes: a pending member can''t mute the trip',
  pg_temp.try($$INSERT INTO public.trip_notification_mutes (trip_id) VALUES ('10000000-0000-0000-0000-000000000001')$$) = -1);
RESET ROLE;
INSERT INTO public.trip_notification_mutes (user_id, trip_id) VALUES (pg_temp.id('stranger'), pg_temp.id('lone_trip'));
SELECT pg_temp.login(pg_temp.id('participant'));
SELECT pg_temp.check('mutes: can''t see another user''s mute',
  NOT EXISTS (SELECT 1 FROM public.trip_notification_mutes WHERE user_id <> pg_temp.id('participant')));
SELECT pg_temp.check('mutes: can''t remove another user''s mute',
  pg_temp.try($$DELETE FROM public.trip_notification_mutes WHERE user_id = '00000000-0000-0000-0000-0000000000f1'$$) = 0);
RESET ROLE;
DELETE FROM public.trip_notification_mutes;
DELETE FROM public.notification_settings;

-- No client can call the recipient functions --------------------------------------------------
SELECT pg_temp.check('recipient functions: not executable by authenticated or anon',
  NOT has_function_privilege('authenticated', 'public.push_recipients_for_update(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.push_recipients_for_join(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.push_recipients_for_update(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.push_recipients_for_join(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.queue_push(text, uuid)', 'EXECUTE'));
SELECT pg_temp.check('recipient functions: service_role can execute them',
  has_function_privilege('service_role', 'public.push_recipients_for_update(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.push_recipients_for_join(uuid)', 'EXECUTE'));
SELECT pg_temp.login(pg_temp.id('owner'));
SELECT pg_temp.check('recipient functions: the owner calling one is refused',
  pg_temp.try($$SELECT public.push_recipients_for_update(gen_random_uuid())$$) = -1);
SELECT pg_temp.check('queue_push: a client can''t queue a call',
  pg_temp.try($$SELECT public.queue_push('update', gen_random_uuid())$$) = -1);
RESET ROLE;

-- 2. A trip update: the other members only ------------------------------------------------------
INSERT INTO ids VALUES ('upd1', '20000000-0000-0000-0000-000000000001');
SELECT pg_temp.login(pg_temp.id('participant'));
INSERT INTO public.trip_updates (id, trip_id, title) VALUES (pg_temp.id('upd1'), pg_temp.id('trip'), 'Bus at 8');
RESET ROLE;
SELECT pg_temp.check('update: the owner and active members get it — not the author, pending, removed or a stranger',
  pg_temp.update_recipients(pg_temp.id('upd1')) = 'editor,owner,viewer');
SELECT pg_temp.check('update: the insert queued one call to notify, with the secret',
  pg_temp.queued('update', pg_temp.id('upd1')) = 1
  AND (SELECT headers ->> 'x-notify-secret' FROM net.http_request_queue q
       WHERE convert_from(q.body, 'UTF8')::jsonb ->> 'id' = pg_temp.id('upd1')::text) = 'TEST-NOTIFY-SECRET');

INSERT INTO public.trip_notification_mutes (user_id, trip_id) VALUES (pg_temp.id('viewer'), pg_temp.id('trip'));
SELECT pg_temp.check('update: a member who muted the trip is left out',
  pg_temp.update_recipients(pg_temp.id('upd1')) = 'editor,owner');
INSERT INTO public.notification_settings (user_id, trip_updates) VALUES (pg_temp.id('editor'), false);
SELECT pg_temp.check('update: a member with trip updates off is left out',
  pg_temp.update_recipients(pg_temp.id('upd1')) = 'owner');
INSERT INTO public.notification_settings (user_id, trip_updates, join_requests) VALUES (pg_temp.id('owner'), true, false);
SELECT pg_temp.check('update: turning join requests off doesn''t stop updates',
  pg_temp.update_recipients(pg_temp.id('upd1')) = 'owner');

-- Only devices of recipients count: everyone else muted → nothing queued.
INSERT INTO ids VALUES ('upd2', '20000000-0000-0000-0000-000000000002');
INSERT INTO public.trip_notification_mutes (user_id, trip_id) VALUES (pg_temp.id('owner'), pg_temp.id('trip'));
SELECT pg_temp.login(pg_temp.id('participant'));
INSERT INTO public.trip_updates (id, trip_id, title) VALUES (pg_temp.id('upd2'), pg_temp.id('trip'), 'Muted');
RESET ROLE;
SELECT pg_temp.check('update: nobody left to tell → no recipient, nothing queued',
  pg_temp.update_recipients(pg_temp.id('upd2')) = '' AND pg_temp.queued('update', pg_temp.id('upd2')) = 0);
DELETE FROM public.trip_notification_mutes;
DELETE FROM public.notification_settings;

-- The owner posts: the owner is the author and doesn't get it.
INSERT INTO ids VALUES ('upd3', '20000000-0000-0000-0000-000000000003');
SELECT pg_temp.login(pg_temp.id('owner'));
INSERT INTO public.trip_updates (id, trip_id, title) VALUES (pg_temp.id('upd3'), pg_temp.id('trip'), 'From owner');
RESET ROLE;
SELECT pg_temp.check('update by the owner: every active member, not the owner',
  pg_temp.update_recipients(pg_temp.id('upd3')) = 'editor,participant,viewer');

-- 3a. An ordinary trip with no members queues nothing ---------------------------------------------
INSERT INTO ids VALUES ('upd_lone', '20000000-0000-0000-0000-0000000000b9');
SELECT pg_temp.login(pg_temp.id('stranger'));
INSERT INTO public.trip_updates (id, trip_id, title) VALUES (pg_temp.id('upd_lone'), pg_temp.id('lone_trip'), 'Note to self');
RESET ROLE;
SELECT pg_temp.check('no members: an update by the owner has no recipient and queues nothing',
  pg_temp.update_recipients(pg_temp.id('upd_lone')) = ''
  AND pg_temp.queued('update', pg_temp.id('upd_lone')) = 0);

-- 3b. A join request: the owner only ---------------------------------------------------------------
INSERT INTO auth.users (id, email, aud, role, is_anonymous) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'joiner@test.local', 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-0000000000b2', 'joiner2@test.local', 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-0000000000b3', 'joiner3@test.local', 'authenticated', 'authenticated', false);
INSERT INTO ids VALUES
  ('joiner',  '00000000-0000-0000-0000-0000000000b1'),
  ('joiner2', '00000000-0000-0000-0000-0000000000b2'),
  ('joiner3', '00000000-0000-0000-0000-0000000000b3');
INSERT INTO public.trip_invites (trip_id, role, token, requires_approval, created_by) VALUES
  (pg_temp.id('trip'), 'participant', 'push-approval-token', true, pg_temp.id('owner'));

SELECT pg_temp.login(pg_temp.id('joiner'));
SELECT pg_temp.check('join: accept_trip_invite on an approval link leaves the joiner pending',
  public.accept_trip_invite('push-approval-token') ->> 'status' = 'pending');
RESET ROLE;
CREATE TEMP TABLE m_join ON COMMIT DROP AS
  SELECT id FROM public.trip_members WHERE user_id = pg_temp.id('joiner');
SELECT pg_temp.check('join: the owner is the only recipient',
  pg_temp.join_recipients((SELECT id FROM m_join)) = 'owner');
SELECT pg_temp.check('join: the request queued one call to notify',
  pg_temp.queued('join', (SELECT id FROM m_join)) = 1);

SELECT pg_temp.login(pg_temp.id('joiner2'));
SELECT pg_temp.check('join without approval: the joiner is active at once',
  public.accept_trip_invite('test-invite-token') ->> 'status' = 'active');
RESET ROLE;
SELECT pg_temp.check('join without approval: nothing queued',
  pg_temp.queued('join', (SELECT id FROM public.trip_members WHERE user_id = pg_temp.id('joiner2'))) = 0);

UPDATE public.trip_members SET status = 'active' WHERE id = (SELECT id FROM m_join);
SELECT pg_temp.check('join: once approved, nobody is a recipient any more',
  pg_temp.join_recipients((SELECT id FROM m_join)) = '');

-- A row moving back to pending (a lead link, 024) is a new request; staying pending is not.
UPDATE public.trip_members SET status = 'pending' WHERE user_id = pg_temp.id('viewer');
SELECT pg_temp.check('join: an active row moving to pending queues a call',
  pg_temp.queued('join', (SELECT id FROM public.trip_members WHERE user_id = pg_temp.id('viewer'))) = 1);
UPDATE public.trip_members SET role = 'participant', status = 'pending' WHERE user_id = pg_temp.id('pending');
SELECT pg_temp.check('join: a row that was already pending queues nothing',
  pg_temp.queued('join', (SELECT id FROM public.trip_members WHERE user_id = pg_temp.id('pending'))) = 0);

INSERT INTO public.notification_settings (user_id, join_requests) VALUES (pg_temp.id('owner'), false);
INSERT INTO public.trip_members (trip_id, user_id, role, status) VALUES
  (pg_temp.id('trip'), pg_temp.id('joiner3'), 'participant', 'pending');
SELECT pg_temp.check('join: an owner with join requests off gets nothing, and nothing is queued',
  pg_temp.join_recipients((SELECT id FROM public.trip_members WHERE user_id = pg_temp.id('joiner3'))) = ''
  AND pg_temp.queued('join', (SELECT id FROM public.trip_members WHERE user_id = pg_temp.id('joiner3'))) = 0);
UPDATE public.notification_settings SET join_requests = true WHERE user_id = pg_temp.id('owner');
INSERT INTO public.trip_notification_mutes (user_id, trip_id) VALUES (pg_temp.id('owner'), pg_temp.id('trip'));
SELECT pg_temp.check('join: an owner who muted the trip gets nothing',
  pg_temp.join_recipients((SELECT id FROM public.trip_members WHERE user_id = pg_temp.id('joiner3'))) = '');
DELETE FROM public.trip_notification_mutes;
DELETE FROM public.notification_settings;

SELECT pg_temp.check('no members: nothing at all was queued for the lone trip',
  NOT EXISTS (SELECT 1 FROM net.http_request_queue q
              WHERE convert_from(q.body, 'UTF8')::jsonb ->> 'id' IN (
                SELECT id::text FROM public.trip_updates WHERE trip_id = pg_temp.id('lone_trip')
                UNION ALL SELECT id::text FROM public.trip_members WHERE trip_id = pg_temp.id('lone_trip'))));

-- 4. Without the Vault secrets (a local DB) the triggers do nothing and never fail ---------------
DELETE FROM vault.secrets WHERE name IN ('notify_url', 'notify_secret');
INSERT INTO ids VALUES ('upd4', '20000000-0000-0000-0000-000000000004');
SELECT pg_temp.login(pg_temp.id('participant'));
SELECT pg_temp.check('no vault secrets: posting an update still works',
  pg_temp.try($$INSERT INTO public.trip_updates (id, trip_id, title)
               VALUES ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'x')$$) = 1);
RESET ROLE;
INSERT INTO public.trip_updates (id, trip_id, title, created_by)
  VALUES (pg_temp.id('upd4'), pg_temp.id('trip'), 'x', pg_temp.id('participant'));
SELECT pg_temp.check('no vault secrets: nothing queued',
  pg_temp.queued('update', pg_temp.id('upd4')) = 0);
