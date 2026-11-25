-- Agent demo requests (migration 031): lead details (name, phone, email) must be
-- unreachable for logged-out visitors, signed-in users and demo visitors alike.
-- Only the service role (the demo-request function) reads or writes them.

INSERT INTO public.demo_requests (full_name, agency_name, phone, email, trips_per_month)
VALUES ('Lead Name', 'Lead Agency', '0501234567', 'lead@example.com', '10_30');

SELECT pg_temp.check('demo requests: a table check rejects a bad trips range',
  pg_temp.try($$INSERT INTO public.demo_requests (full_name, agency_name, phone, email, trips_per_month)
                VALUES ('A B', 'Agency', '0501234567', 'a@b.co', 'many')$$) = -1);
SELECT pg_temp.check('demo requests: a table check rejects a bad email',
  pg_temp.try($$INSERT INTO public.demo_requests (full_name, agency_name, phone, email, trips_per_month)
                VALUES ('A B', 'Agency', '0501234567', 'not-an-email', 'up_to_10')$$) = -1);

SELECT pg_temp.login_anon();
SELECT pg_temp.check('demo requests: a logged-out visitor cannot read leads',
  pg_temp.try('SELECT * FROM public.demo_requests') = -1);
SELECT pg_temp.check('demo requests: a logged-out visitor cannot write leads directly',
  pg_temp.try($$INSERT INTO public.demo_requests (full_name, agency_name, phone, email, trips_per_month)
                VALUES ('A B', 'Agency', '0501234567', 'a@b.co', 'up_to_10')$$) = -1);
RESET ROLE;

SELECT pg_temp.login(pg_temp.id('owner'));
SELECT pg_temp.check('demo requests: a signed-in user cannot read leads',
  pg_temp.try('SELECT * FROM public.demo_requests') = -1);
SELECT pg_temp.check('demo requests: a signed-in user cannot delete leads',
  pg_temp.try('DELETE FROM public.demo_requests') = -1);
RESET ROLE;

SELECT pg_temp.login(pg_temp.id('demo'), true);
SELECT pg_temp.check('demo requests: a demo visitor cannot read leads',
  pg_temp.try('SELECT * FROM public.demo_requests') = -1);
RESET ROLE;
