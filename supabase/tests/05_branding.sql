-- Agency branding (migration 023): the agency-logos bucket and the agency block
-- of get_shared_trip, which only an ACTIVE agent owner's brochure carries.

-- Fixture: an active agent with a logo, a suspended agent, each with a shared trip --
INSERT INTO auth.users (id, email, aud, role, is_anonymous) VALUES
  ('00000000-0000-0000-0000-0000000000c5', 'brand-agent@test.local', 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-0000000000c6', 'brand-other@test.local', 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-0000000000c7', 'brand-susp@test.local',  'authenticated', 'authenticated', false);
INSERT INTO ids VALUES
  ('brand_agent', '00000000-0000-0000-0000-0000000000c5'),
  ('brand_other', '00000000-0000-0000-0000-0000000000c6'),
  ('brand_susp',  '00000000-0000-0000-0000-0000000000c7');
INSERT INTO public.user_roles (user_id, role) VALUES
  (pg_temp.id('brand_agent'), 'agent'), (pg_temp.id('brand_other'), 'agent');
INSERT INTO public.agent_accounts (user_id, status, agency_name) VALUES
  (pg_temp.id('brand_agent'), 'active',    'Brand Travel'),
  (pg_temp.id('brand_other'), 'active',    'Other Travel'),
  (pg_temp.id('brand_susp'),  'suspended', 'Suspended Travel');

CREATE TEMP TABLE logo (url TEXT) ON COMMIT DROP;
INSERT INTO logo VALUES ('https://proj.supabase.co/storage/v1/object/public/agency-logos/'
  || '00000000-0000-0000-0000-0000000000c5/logo-1.png');
GRANT SELECT ON logo TO authenticated, anon;
INSERT INTO storage.objects (bucket_id, name, owner) VALUES
  ('agency-logos', '00000000-0000-0000-0000-0000000000c5/logo-1.png', '00000000-0000-0000-0000-0000000000c5'),
  ('agency-logos', '00000000-0000-0000-0000-0000000000c6/logo-2.png', '00000000-0000-0000-0000-0000000000c6');

INSERT INTO public.profiles (id, agency_name, agency_color, agency_logo_url) VALUES
  (pg_temp.id('brand_agent'), 'Brand Travel', '#1a2B3c', (SELECT url FROM logo)),
  (pg_temp.id('brand_susp'),  'Suspended Travel', '#112233', (SELECT url FROM logo)),
  (pg_temp.id('owner'),       'Not An Agency', '#112233', NULL)
ON CONFLICT (id) DO UPDATE SET agency_name = excluded.agency_name, agency_color = excluded.agency_color,
  agency_logo_url = excluded.agency_logo_url;

INSERT INTO public.trips (user_id, title, destination, is_shared, share_slug) VALUES
  (pg_temp.id('brand_agent'), 'Brand trip', 'Rome',  true, 'brand-slug-0123456789'),
  (pg_temp.id('brand_susp'),  'Susp trip',  'Paris', true, 'susp-slug-0123456789');

-- get_shared_trip ------------------------------------------------------------------
SELECT pg_temp.login_anon();
SELECT pg_temp.check('anon: an active agent''s brochure carries name, colour and logo',
  public.get_shared_trip('brand-slug-0123456789') -> 'agency'
  = jsonb_build_object('name', 'Brand Travel', 'color', '#1a2B3c', 'logo_url', (SELECT url FROM logo)));
SELECT pg_temp.check('anon: a non-agent owner''s brochure has no agency (profile fields ignored)',
  jsonb_typeof(public.get_shared_trip('test-slug-0123456789') -> 'agency') = 'null');
SELECT pg_temp.check('anon: a suspended agent''s brochure has no agency',
  jsonb_typeof(public.get_shared_trip('susp-slug-0123456789') -> 'agency') = 'null');
RESET ROLE;

-- The role alone is not enough: an agent row that is no longer active hides the brand.
UPDATE public.agent_accounts SET status = 'suspended' WHERE user_id = pg_temp.id('brand_agent');
SELECT pg_temp.login_anon();
SELECT pg_temp.check('anon: agent role but a suspended account → no agency',
  jsonb_typeof(public.get_shared_trip('brand-slug-0123456789') -> 'agency') = 'null');
RESET ROLE;
UPDATE public.agent_accounts SET status = 'active' WHERE user_id = pg_temp.id('brand_agent');

-- Free-text colour and a logo outside the owner's own folder are dropped.
UPDATE public.profiles SET agency_color = 'red;background:url(https://evil.example/p.gif)',
  agency_logo_url = 'https://proj.supabase.co/storage/v1/object/public/agency-logos/00000000-0000-0000-0000-0000000000c6/logo-2.png'
WHERE id = pg_temp.id('brand_agent');
SELECT pg_temp.login_anon();
SELECT pg_temp.check('anon: a non-#rrggbb colour and another agent''s logo come back null',
  public.get_shared_trip('brand-slug-0123456789') -> 'agency'
  = jsonb_build_object('name', 'Brand Travel', 'color', null, 'logo_url', null));
RESET ROLE;
UPDATE public.profiles SET agency_logo_url = 'https://evil.example/pixel.gif?/agency-logos/00000000-0000-0000-0000-0000000000c5/logo-1.png'
WHERE id = pg_temp.id('brand_agent');
SELECT pg_temp.login_anon();
SELECT pg_temp.check('anon: an arbitrary logo URL comes back null',
  public.get_shared_trip('brand-slug-0123456789') #> '{agency,logo_url}' = 'null'::jsonb);
RESET ROLE;
UPDATE public.profiles SET agency_logo_url = 'https://proj.supabase.co/storage/v1/object/public/agency-logos/00000000-0000-0000-0000-0000000000c5/gone.png'
WHERE id = pg_temp.id('brand_agent');
SELECT pg_temp.login_anon();
SELECT pg_temp.check('anon: a logo URL whose object does not exist comes back null',
  public.get_shared_trip('brand-slug-0123456789') #> '{agency,logo_url}' = 'null'::jsonb);
SELECT pg_temp.check('anon: cannot call agency_branding directly',
  pg_temp.try(format('SELECT public.agency_branding(%L)', pg_temp.id('brand_agent'))) = -1);
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('stranger'));
SELECT pg_temp.check('user: cannot call agency_branding directly',
  pg_temp.try(format('SELECT public.agency_branding(%L)', pg_temp.id('brand_agent'))) = -1);
RESET ROLE;

-- Storage: agency-logos ------------------------------------------------------------
SELECT pg_temp.login(pg_temp.id('brand_agent'));
SELECT pg_temp.check('agent: can upload a logo under their own folder',
  pg_temp.try(format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L)',
    'agency-logos', pg_temp.id('brand_agent')::text || '/logo-9.png', pg_temp.id('brand_agent'))) = 1);
SELECT pg_temp.check('agent: cannot upload under another user''s folder',
  pg_temp.try(format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L)',
    'agency-logos', pg_temp.id('brand_other')::text || '/logo-9.png', pg_temp.id('brand_agent'))) = -1);
SELECT pg_temp.check('agent: cannot upload at the bucket root',
  pg_temp.try(format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L)',
    'agency-logos', 'logo-9.png', pg_temp.id('brand_agent'))) = -1);
SELECT pg_temp.check('agent: cannot move their logo into another user''s folder',
  pg_temp.try(format('UPDATE storage.objects SET name = %L WHERE bucket_id = %L AND name = %L',
    pg_temp.id('brand_other')::text || '/x.png', 'agency-logos', pg_temp.id('brand_agent')::text || '/logo-1.png')) = -1);
SELECT pg_temp.check('agent: cannot rewrite another agent''s logo',
  pg_temp.try(format('UPDATE storage.objects SET name = name WHERE bucket_id = %L AND name = %L',
    'agency-logos', pg_temp.id('brand_other')::text || '/logo-2.png')) = 0);
SELECT pg_temp.check('agent: sees only their own folder',
  (SELECT array_agg(DISTINCT (storage.foldername(name))[1]) FROM storage.objects WHERE bucket_id = 'agency-logos')
  = ARRAY[pg_temp.id('brand_agent')::text]);
RESET ROLE;

SELECT pg_temp.login(pg_temp.id('stranger'));
SELECT pg_temp.check('non-agent: cannot upload a logo, even under their own folder',
  pg_temp.try(format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L)',
    'agency-logos', pg_temp.id('stranger')::text || '/logo-1.png', pg_temp.id('stranger'))) = -1);
SELECT pg_temp.check('non-agent: cannot list anyone''s logos',
  (SELECT count(*) FROM storage.objects WHERE bucket_id = 'agency-logos') = 0);
RESET ROLE;

SELECT pg_temp.login(pg_temp.id('brand_susp'));
SELECT pg_temp.check('suspended agent (no role): cannot upload a logo',
  pg_temp.try(format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L)',
    'agency-logos', pg_temp.id('brand_susp')::text || '/logo-1.png', pg_temp.id('brand_susp'))) = -1);
RESET ROLE;

-- A demo (anonymous-auth) session with the agent role still can't upload.
INSERT INTO public.user_roles (user_id, role) VALUES (pg_temp.id('demo'), 'agent');
SELECT pg_temp.login(pg_temp.id('demo'), true);
SELECT pg_temp.check('demo session: cannot upload a logo',
  pg_temp.try(format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L)',
    'agency-logos', pg_temp.id('demo')::text || '/logo-1.png', pg_temp.id('demo'))) = -1);
RESET ROLE;

SELECT pg_temp.login_anon();
SELECT pg_temp.check('anon: cannot upload a logo',
  pg_temp.try(format('INSERT INTO storage.objects (bucket_id, name) VALUES (%L, %L)',
    'agency-logos', pg_temp.id('brand_agent')::text || '/anon.png')) = -1);
SELECT pg_temp.check('anon: cannot list the bucket',
  pg_temp.try($$SELECT * FROM storage.objects WHERE bucket_id = 'agency-logos'$$) <= 0);
RESET ROLE;

SELECT pg_temp.check('the agency-logos bucket is public, 1 MB, PNG/JPEG/WebP only (no SVG)',
  EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'agency-logos' AND public AND file_size_limit = 1048576
          AND allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']));
