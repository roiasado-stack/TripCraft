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
INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES
  ('agency-logos', '00000000-0000-0000-0000-0000000000c5/logo-1.png', '00000000-0000-0000-0000-0000000000c5', '{"mimetype":"image/png","size":1000}'),
  ('agency-logos', '00000000-0000-0000-0000-0000000000c6/logo-2.png', '00000000-0000-0000-0000-0000000000c6', '{"mimetype":"image/png","size":1000}');

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
  = jsonb_build_object('name', 'Brand Travel', 'color', '#1a2B3c', 'logo_path', '00000000-0000-0000-0000-0000000000c5/logo-1.png'));
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
  = jsonb_build_object('name', 'Brand Travel', 'color', null, 'logo_path', null));
RESET ROLE;
UPDATE public.profiles SET agency_logo_url = 'https://evil.example/pixel.gif?/agency-logos/00000000-0000-0000-0000-0000000000c5/logo-1.png'
WHERE id = pg_temp.id('brand_agent');
SELECT pg_temp.login_anon();
SELECT pg_temp.check('anon: an arbitrary logo URL yields no logo path',
  public.get_shared_trip('brand-slug-0123456789') #> '{agency,logo_path}' = 'null'::jsonb);
RESET ROLE;
UPDATE public.profiles SET agency_logo_url = 'https://proj.supabase.co/storage/v1/object/public/agency-logos/00000000-0000-0000-0000-0000000000c5/gone.png'
WHERE id = pg_temp.id('brand_agent');
SELECT pg_temp.login_anon();
SELECT pg_temp.check('anon: a logo URL whose object does not exist yields no logo path',
  public.get_shared_trip('brand-slug-0123456789') #> '{agency,logo_path}' = 'null'::jsonb);
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

-- Security review (023): logo_path pinning, stored object type/size, roles ------------

-- A. Host pinning: the brochure gets a path, never the stored URL or its host.
RESET ROLE;
UPDATE public.profiles SET agency_color = '#1a2B3c',
  agency_logo_url = 'https://evil.example/storage/v1/object/public/agency-logos/00000000-0000-0000-0000-0000000000c5/logo-1.png'
WHERE id = pg_temp.id('brand_agent');
SELECT pg_temp.login_anon();
SELECT pg_temp.check('anon: a logo URL on a foreign host never reaches the brochure (own path is not enough)',
  public.get_shared_trip('brand-slug-0123456789')::text NOT LIKE '%evil.example%');
SELECT pg_temp.check('anon: the brochure carries only the object path, never a logo URL',
  public.get_shared_trip('brand-slug-0123456789') -> 'agency' ? 'logo_path'
  AND NOT (public.get_shared_trip('brand-slug-0123456789') -> 'agency' ? 'logo_url')
  AND public.get_shared_trip('brand-slug-0123456789') #>> '{agency,logo_path}'
      = '00000000-0000-0000-0000-0000000000c5/logo-1.png');
RESET ROLE;
-- The server ignores scheme and host: a local-stack URL for a valid object works.
UPDATE public.profiles SET
  agency_logo_url = 'http://127.0.0.1:54321/storage/v1/object/public/agency-logos/00000000-0000-0000-0000-0000000000c5/logo-1.png'
WHERE id = pg_temp.id('brand_agent');
SELECT pg_temp.login_anon();
SELECT pg_temp.check('anon: an http://127.0.0.1:54321 stored URL for a valid object yields its logo_path',
  public.get_shared_trip('brand-slug-0123456789') #>> '{agency,logo_path}'
    = '00000000-0000-0000-0000-0000000000c5/logo-1.png'
  AND public.get_shared_trip('brand-slug-0123456789')::text NOT LIKE '%127.0.0.1%');
RESET ROLE;

-- B. Non-image / oversized objects in the owner's own folder.
INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES
  ('agency-logos', '00000000-0000-0000-0000-0000000000c5/copied.html', '00000000-0000-0000-0000-0000000000c5', '{"mimetype":"text/html","size":65}'),
  ('agency-logos', '00000000-0000-0000-0000-0000000000c5/huge.png', '00000000-0000-0000-0000-0000000000c5', '{"mimetype":"image/png","size":52428800}'),
  ('agency-logos', '00000000-0000-0000-0000-0000000000c5/fake.png', '00000000-0000-0000-0000-0000000000c5', '{"mimetype":"text/html","size":65}');
UPDATE public.profiles SET agency_logo_url = 'https://proj.supabase.co/storage/v1/object/public/agency-logos/00000000-0000-0000-0000-0000000000c5/copied.html' WHERE id = pg_temp.id('brand_agent');
SELECT pg_temp.login_anon();
SELECT pg_temp.check('anon: a text/html object in the owner''s folder is not returned as the logo',
  public.get_shared_trip('brand-slug-0123456789') #> '{agency,logo_path}' = 'null'::jsonb);
RESET ROLE;
UPDATE public.profiles SET agency_logo_url = 'https://proj.supabase.co/storage/v1/object/public/agency-logos/00000000-0000-0000-0000-0000000000c5/fake.png' WHERE id = pg_temp.id('brand_agent');
SELECT pg_temp.login_anon();
SELECT pg_temp.check('anon: an image-named object stored as text/html is not returned as the logo',
  public.get_shared_trip('brand-slug-0123456789') #> '{agency,logo_path}' = 'null'::jsonb);
RESET ROLE;
UPDATE public.profiles SET agency_logo_url = 'https://proj.supabase.co/storage/v1/object/public/agency-logos/00000000-0000-0000-0000-0000000000c5/huge.png' WHERE id = pg_temp.id('brand_agent');
SELECT pg_temp.login_anon();
SELECT pg_temp.check('anon: an object over 1 MB is not returned as the logo',
  public.get_shared_trip('brand-slug-0123456789') #> '{agency,logo_path}' = 'null'::jsonb);
RESET ROLE;

-- C. Suspended agent: can delete a leftover logo, cannot rename it.
INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('agency-logos', '00000000-0000-0000-0000-0000000000c7/old.png', '00000000-0000-0000-0000-0000000000c7');
SELECT pg_temp.login(pg_temp.id('brand_susp'));
SELECT pg_temp.check('suspended agent: cannot rename their leftover logo',
  pg_temp.try(format('UPDATE storage.objects SET name = %L WHERE bucket_id = %L AND name = %L', pg_temp.id('brand_susp')::text || '/new.png', 'agency-logos', pg_temp.id('brand_susp')::text || '/old.png')) = -1);
-- The Storage API sets storage.allow_delete_query before its DELETE (storage's
-- protect_delete trigger refuses direct deletes otherwise); do the same so this
-- exercises the RLS policy.
SELECT set_config('storage.allow_delete_query', 'true', true);
SELECT pg_temp.check('suspended agent: can still delete their leftover logo',
  pg_temp.try(format('DELETE FROM storage.objects WHERE bucket_id = %L AND name = %L', 'agency-logos', pg_temp.id('brand_susp')::text || '/old.png')) = 1);
SELECT set_config('storage.allow_delete_query', 'false', true);
RESET ROLE;

-- D. A pending agent request cannot upload.
INSERT INTO auth.users (id, email, aud, role, is_anonymous) VALUES
  ('00000000-0000-0000-0000-0000000000c8', 'brand-pending@test.local', 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-0000000000c9', 'brand-admin@test.local',   'authenticated', 'authenticated', false);
INSERT INTO ids VALUES ('brand_pending', '00000000-0000-0000-0000-0000000000c8'), ('brand_admin', '00000000-0000-0000-0000-0000000000c9');
INSERT INTO public.agent_accounts (user_id, status, agency_name) VALUES (pg_temp.id('brand_pending'), 'pending', 'Pending Travel');
SELECT pg_temp.login(pg_temp.id('brand_pending'));
SELECT pg_temp.check('pending agent: cannot upload a logo',
  pg_temp.try(format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L)', 'agency-logos', pg_temp.id('brand_pending')::text || '/logo-1.png', pg_temp.id('brand_pending'))) = -1);
RESET ROLE;

-- E. An admin may upload; an admin (non-agent) owner's brochure has no agency.
INSERT INTO public.user_roles (user_id, role) VALUES (pg_temp.id('brand_admin'), 'admin');
INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES ('agency-logos', '00000000-0000-0000-0000-0000000000c9/logo-1.png', '00000000-0000-0000-0000-0000000000c9', '{"mimetype":"image/png","size":1000}');
INSERT INTO public.profiles (id, agency_name, agency_color, agency_logo_url) VALUES
  (pg_temp.id('brand_admin'), 'Admin Brand', '#123456', 'https://proj.supabase.co/storage/v1/object/public/agency-logos/00000000-0000-0000-0000-0000000000c9/logo-1.png')
ON CONFLICT (id) DO UPDATE SET agency_name = excluded.agency_name, agency_color = excluded.agency_color, agency_logo_url = excluded.agency_logo_url;
INSERT INTO public.trips (user_id, title, destination, is_shared, share_slug) VALUES (pg_temp.id('brand_admin'), 'Admin trip', 'Oslo', true, 'admin-slug-0123456789');
SELECT pg_temp.login(pg_temp.id('brand_admin'));
SELECT pg_temp.check('admin: can upload a logo under their own folder',
  pg_temp.try(format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L)', 'agency-logos', pg_temp.id('brand_admin')::text || '/logo-2.png', pg_temp.id('brand_admin'))) = 1);
RESET ROLE;
SELECT pg_temp.login_anon();
SELECT pg_temp.check('anon: an admin (not agent) owner''s brochure has no agency',
  jsonb_typeof(public.get_shared_trip('admin-slug-0123456789') -> 'agency') = 'null');
RESET ROLE;

-- F. A demo session (agent role granted above) cannot rename within the bucket.
INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('agency-logos', '00000000-0000-0000-0000-0000000000d1/seed.png', '00000000-0000-0000-0000-0000000000d1');
SELECT pg_temp.login(pg_temp.id('demo'), true);
SELECT pg_temp.check('demo session: cannot update an agency-logos object',
  pg_temp.try(format('UPDATE storage.objects SET name = %L WHERE bucket_id = %L AND name = %L', pg_temp.id('demo')::text || '/moved.png', 'agency-logos', pg_temp.id('demo')::text || '/seed.png')) = -1);
RESET ROLE;

-- G. Odd metadata, traversal, other bucket, smuggled marker: no logo path.
RESET ROLE;
INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES
  ('agency-logos', '00000000-0000-0000-0000-0000000000c5/abc.png',  '00000000-0000-0000-0000-0000000000c5', '{"mimetype":"image/png","size":"abc"}'),
  ('agency-logos', '00000000-0000-0000-0000-0000000000c5/neg.png',  '00000000-0000-0000-0000-0000000000c5', '{"mimetype":"image/png","size":-1}'),
  ('agency-logos', '00000000-0000-0000-0000-0000000000c5/nosz.png', '00000000-0000-0000-0000-0000000000c5', '{"mimetype":"image/png"}'),
  ('agency-logos', '00000000-0000-0000-0000-0000000000c5/edge.png', '00000000-0000-0000-0000-0000000000c5', '{"mimetype":"image/png","size":1048576}'),
  ('agency-logos', '00000000-0000-0000-0000-0000000000c5/parm.png', '00000000-0000-0000-0000-0000000000c5', '{"mimetype":"image/png; x=text/html","size":10}'),
  ('trip-docs',    '00000000-0000-0000-0000-0000000000c5/doc.png',  '00000000-0000-0000-0000-0000000000c5', '{"mimetype":"image/png","size":10}');
CREATE TEMP TABLE bad_logo (label TEXT, url TEXT) ON COMMIT DROP;
INSERT INTO bad_logo VALUES
  ('size "abc"',        'https://proj.supabase.co/storage/v1/object/public/agency-logos/00000000-0000-0000-0000-0000000000c5/abc.png'),
  ('negative size',     'https://proj.supabase.co/storage/v1/object/public/agency-logos/00000000-0000-0000-0000-0000000000c5/neg.png'),
  ('missing size',      'https://proj.supabase.co/storage/v1/object/public/agency-logos/00000000-0000-0000-0000-0000000000c5/nosz.png'),
  ('mimetype with a parameter', 'https://proj.supabase.co/storage/v1/object/public/agency-logos/00000000-0000-0000-0000-0000000000c5/parm.png'),
  ('../ into another agent''s folder', 'https://proj.supabase.co/storage/v1/object/public/agency-logos/00000000-0000-0000-0000-0000000000c5/../00000000-0000-0000-0000-0000000000c6/logo-2.png'),
  ('same name in another bucket', 'https://proj.supabase.co/storage/v1/object/public/trip-docs/00000000-0000-0000-0000-0000000000c5/doc.png'),
  ('query string',      'https://proj.supabase.co/storage/v1/object/public/agency-logos/00000000-0000-0000-0000-0000000000c5/logo-1.png?x=1'),
  ('marker smuggled after a foreign path', 'https://evil.example/storage/v1/object/public/agency-logos/x?/storage/v1/object/public/agency-logos/00000000-0000-0000-0000-0000000000c5/logo-1.png');
DO $$ DECLARE b RECORD; BEGIN
  FOR b IN SELECT * FROM bad_logo LOOP
    UPDATE public.profiles SET agency_logo_url = b.url WHERE id = '00000000-0000-0000-0000-0000000000c5';
    IF public.agency_branding('00000000-0000-0000-0000-0000000000c5') -> 'logo_path' <> 'null'::jsonb THEN
      RAISE EXCEPTION 'FAIL: logo_path returned for %', b.label;
    END IF;
  END LOOP;
END $$;
SELECT pg_temp.check('odd metadata, traversal, other bucket, query and smuggled marker yield no logo path', true);
UPDATE public.profiles SET agency_logo_url = 'https://proj.supabase.co/storage/v1/object/public/agency-logos/00000000-0000-0000-0000-0000000000c5/edge.png'
WHERE id = pg_temp.id('brand_agent');
SELECT pg_temp.login_anon();
SELECT pg_temp.check('anon: a logo of exactly 1 MB is still shown',
  public.get_shared_trip('brand-slug-0123456789') #>> '{agency,logo_path}' = '00000000-0000-0000-0000-0000000000c5/edge.png');
RESET ROLE;
