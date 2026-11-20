-- The private AI pool (migration 030): today's spend of everyone who isn't an
-- active agent. Agents' spend must not be in it, so a busy private day can't
-- stop AI for the agencies — and nothing older than today counts.

INSERT INTO auth.users (id, email, aud, role, is_anonymous) VALUES
  ('00000000-0000-0000-0000-0000000000e1', 'pool-agent@test.local',     'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-0000000000e2', 'pool-suspended@test.local', 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-0000000000e3', 'pool-pending@test.local',   'authenticated', 'authenticated', false);
INSERT INTO ids VALUES
  ('pool_agent',     '00000000-0000-0000-0000-0000000000e1'),
  ('pool_suspended', '00000000-0000-0000-0000-0000000000e2'),
  ('pool_pending',   '00000000-0000-0000-0000-0000000000e3');
INSERT INTO public.user_roles (user_id, role) VALUES (pg_temp.id('pool_agent'), 'agent');
INSERT INTO public.agent_accounts (user_id, status, agency_name) VALUES
  (pg_temp.id('pool_agent'), 'active', 'Pool Agency'),
  (pg_temp.id('pool_suspended'), 'suspended', 'Gone Agency'),
  (pg_temp.id('pool_pending'), 'pending', 'Waiting Agency');

-- Clean slate for today, then known amounts.
DELETE FROM public.agent_runs;
INSERT INTO public.agent_runs (user_id, kind, cost_usd, created_at) VALUES
  (pg_temp.id('owner'),          'ask',                1.50, now()),
  (pg_temp.id('demo'),           'ask',                0.50, now()),
  (pg_temp.id('pool_suspended'), 'ask',                0.25, now()),
  (pg_temp.id('pool_pending'),   'generate_itinerary', 0.20, now()),
  (pg_temp.id('pool_agent'),     'generate_itinerary', 3.00, now()),
  (pg_temp.id('owner'),          'ask',                9.00, date_trunc('day', now()) - interval '1 minute'),
  (pg_temp.id('owner'),          'google_place_photo', 0,    now());

SELECT pg_temp.login(pg_temp.id('owner'));
SELECT pg_temp.check('pool: private + demo + suspended + pending agents today, no active agent, no yesterday',
  public.private_daily_cost_usd() = 2.45);
SELECT pg_temp.check('pool: the app-wide total still includes the agent',
  public.app_agent_daily_cost_usd() = 5.45);
RESET ROLE;

SELECT pg_temp.login(pg_temp.id('pool_agent'));
SELECT pg_temp.check('pool: an agent may read it too (one number, nobody''s rows)',
  public.private_daily_cost_usd() = 2.45);
RESET ROLE;

SELECT pg_temp.login(pg_temp.id('demo'), true);
SELECT pg_temp.check('pool: a demo visitor (authenticated, anonymous) can read it — the functions call it with their JWT',
  public.private_daily_cost_usd() = 2.45);
RESET ROLE;

-- An agent losing the role (but keeping an "active" row) counts as private.
DELETE FROM public.user_roles WHERE user_id = pg_temp.id('pool_agent') AND role = 'agent';
SELECT pg_temp.login(pg_temp.id('owner'));
SELECT pg_temp.check('pool: role and account must both be in place to stay out of it',
  public.private_daily_cost_usd() = 5.45);
RESET ROLE;

SELECT pg_temp.login_anon();
SELECT pg_temp.check('anon: cannot call private_daily_cost_usd',
  pg_temp.try('SELECT public.private_daily_cost_usd()') = -1);
RESET ROLE;
