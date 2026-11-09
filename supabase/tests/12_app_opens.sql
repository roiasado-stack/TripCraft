-- Install / push metrics (migration 027): a signed-in user records only their own
-- open, once a day per mode; a demo user and a logged-out visitor record nothing;
-- only an admin reads the counts, and no one reads the rows directly.

-- Fixture: an admin ------------------------------------------------------------------
INSERT INTO auth.users (id, email, aud, role, is_anonymous) VALUES
  ('00000000-0000-0000-0000-0000000000ad', 'admin@test.local', 'authenticated', 'authenticated', false);
INSERT INTO ids VALUES ('admin', '00000000-0000-0000-0000-0000000000ad');
INSERT INTO public.user_roles (user_id, role) VALUES (pg_temp.id('admin'), 'admin');

CREATE FUNCTION pg_temp.opens(p_user UUID) RETURNS INT LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.app_opens WHERE user_id = p_user
$$;

-- 1. Recording -----------------------------------------------------------------------
SELECT pg_temp.login(pg_temp.id('owner'));
SELECT public.record_app_open('ios', true);
SELECT public.record_app_open('ios', true);
SELECT public.record_app_open('ios', false);
RESET ROLE;
SELECT pg_temp.check('record: one row per mode, a repeat the same day adds nothing',
  pg_temp.opens(pg_temp.id('owner')) = 2);
SELECT pg_temp.check('record: the row is the caller''s, with today''s date',
  (SELECT bool_and(day = current_date AND platform = 'ios') FROM public.app_opens WHERE user_id = pg_temp.id('owner')));

SELECT pg_temp.login(pg_temp.id('editor'));
SELECT public.record_app_open('windows-phone', NULL);
RESET ROLE;
SELECT pg_temp.check('record: an unknown platform is stored as other, a missing mode as not installed',
  (SELECT platform = 'other' AND NOT standalone FROM public.app_opens WHERE user_id = pg_temp.id('editor')));

-- 2. A user can only create their own row ---------------------------------------------
SELECT pg_temp.login(pg_temp.id('participant'));
SELECT pg_temp.check('table: can''t insert a row directly, not even their own',
  pg_temp.try($$INSERT INTO public.app_opens (platform, standalone) VALUES ('ios', true)$$) = -1);
SELECT pg_temp.check('table: can''t insert a row for another user',
  pg_temp.try($$INSERT INTO public.app_opens (user_id, platform, standalone)
               VALUES ('00000000-0000-0000-0000-00000000000a', 'android', false)$$) = -1);
SELECT pg_temp.check('table: can''t read rows directly',
  pg_temp.try($$SELECT * FROM public.app_opens$$) = -1);
SELECT pg_temp.check('table: can''t delete rows',
  pg_temp.try($$DELETE FROM public.app_opens$$) = -1);
SELECT public.record_app_open('android', false);
RESET ROLE;
SELECT pg_temp.check('record: the RPC writes the caller''s row only',
  pg_temp.opens(pg_temp.id('participant')) = 1 AND pg_temp.opens(pg_temp.id('owner')) = 2);

-- 3. Demo users and logged-out visitors record nothing ----------------------------------
SELECT pg_temp.login(pg_temp.id('demo'), true);
SELECT pg_temp.check('record: a demo user is refused',
  pg_temp.try($$SELECT public.record_app_open('ios', true)$$) = -1);
RESET ROLE;
SELECT pg_temp.check('record: nothing stored for the demo user', pg_temp.opens(pg_temp.id('demo')) = 0);

SELECT pg_temp.login_anon();
SELECT pg_temp.check('record: a logged-out visitor can''t call it',
  pg_temp.try($$SELECT public.record_app_open('ios', true)$$) = -1);
SELECT pg_temp.check('metrics: a logged-out visitor can''t call it',
  pg_temp.try($$SELECT * FROM public.admin_install_metrics()$$) = -1);
SELECT pg_temp.check('table: a logged-out visitor can''t read it',
  pg_temp.try($$SELECT * FROM public.app_opens$$) = -1);
RESET ROLE;

-- 4. Only an admin reads the counts ---------------------------------------------------
SELECT pg_temp.login(pg_temp.id('stranger'));
SELECT pg_temp.check('metrics: a non-admin is refused',
  pg_temp.try($$SELECT * FROM public.admin_install_metrics()$$) = -1);
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('demo'), true);
SELECT pg_temp.check('metrics: a demo user is refused',
  pg_temp.try($$SELECT * FROM public.admin_install_metrics(7)$$) = -1);
RESET ROLE;

-- Push devices: owner's iPhone (by user agent, on an FCM-looking endpoint to prove UA wins),
-- participant's Android by endpoint only, viewer's Mac (viewer never opened the app).
INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES
  (pg_temp.id('owner'), 'https://fcm.googleapis.com/fcm/send/owner-ios', 'k', 'a',
   'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15'),
  (pg_temp.id('participant'), 'https://fcm.googleapis.com/fcm/send/participant', 'k', 'a', NULL),
  (pg_temp.id('viewer'), 'https://web.push.apple.com/viewer-mac', 'k', 'a',
   'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 Safari/605.1.15');
-- An old open, outside a 30-day window.
INSERT INTO public.app_opens (user_id, day, platform, standalone) VALUES
  (pg_temp.id('stranger'), current_date - 60, 'ios', true);

SELECT pg_temp.login(pg_temp.id('admin'));
RESET ROLE; -- the admin's claims stay; the temp table needs postgres
CREATE TEMP TABLE m ON COMMIT DROP AS SELECT * FROM public.admin_install_metrics(30);
SELECT pg_temp.login_anon();
SELECT pg_temp.check('metrics: the same call as a logged-out visitor is refused',
  pg_temp.try($$SELECT * FROM public.admin_install_metrics(30)$$) = -1);
RESET ROLE;
SELECT pg_temp.check('metrics: one row per platform',
  (SELECT string_agg(platform, ',') FROM m) = 'ios,android,desktop,other');
SELECT pg_temp.check('metrics: ios — one user, installed, with push',
  (SELECT users_opened = 1 AND users_installed = 1 AND pct_installed = 100 AND users_with_push = 1 AND pct_push = 100
   FROM m WHERE platform = 'ios'));
SELECT pg_temp.check('metrics: android — one user in a browser, push by endpoint',
  (SELECT users_opened = 1 AND users_installed = 0 AND pct_installed = 0 AND users_with_push = 1
   FROM m WHERE platform = 'android'));
SELECT pg_temp.check('metrics: desktop — nobody opened, so no percentages',
  (SELECT users_opened = 0 AND users_with_push = 0 AND pct_installed IS NULL AND pct_push IS NULL
   FROM m WHERE platform = 'desktop'));
SELECT pg_temp.check('metrics: other — the editor, not installed, no push',
  (SELECT users_opened = 1 AND users_installed = 0 AND users_with_push = 0 FROM m WHERE platform = 'other'));

SELECT pg_temp.login(pg_temp.id('admin'));
SELECT pg_temp.check('metrics: a wider window counts the older open',
  (SELECT users_opened = 2 AND users_installed = 2 FROM public.admin_install_metrics(90) WHERE platform = 'ios'));
RESET ROLE;
-- Retention (the nightly cron delete) isn't testable here: test:db stubs pg_cron.
