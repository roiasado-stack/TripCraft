-- ============================================================================
-- 023 — Agency branding on the public trip page (agency beta, phase 3)
--
-- 1. A PUBLIC storage bucket `agency-logos`. Public because the anonymous
--    brochure (/share/:slug) shows the logo; files are fetched by their public
--    URL only. There is NO SELECT policy for anon, so the bucket can't be
--    listed. Objects are keyed `<auth.uid()>/logo-<ts>.<ext>`; only an agent
--    (or admin) writes, only under their own folder, and only PNG/JPEG/WebP up
--    to 1 MB (no SVG: it can carry script).
--
-- 2. get_shared_trip (last defined in 021) returns the owner's agency name,
--    colour and logo only when the owner is an ACTIVE agent (agent role +
--    agent_accounts.status = 'active'). Anyone else's brochure gets
--    agency = null — before this, any user's profiles.agency_name/colour
--    showed up. The colour must be a #rrggbb value and the logo must be an
--    object in the owner's own agency-logos folder: both are user-writable
--    text, and a free-form value could load a tracking pixel for every
--    visitor (same reason 021 filters image_url).
--
-- Idempotent. Paste into the SQL Editor after 022.
-- ============================================================================

-- Bucket -------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('agency-logos', 'agency-logos', true, 1048576, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE
SET public = true, file_size_limit = 1048576, allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp'];

-- Policies (authenticated only) -----------------------------------------------------
-- Writes need the agent or admin role and the caller's own folder. Read and
-- delete of one's own folder need no role, so a suspended agent can still
-- remove their logo (and account deletion can clear it).
DROP POLICY IF EXISTS "agency logos read own" ON storage.objects;
CREATE POLICY "agency logos read own" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'agency-logos' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "agency logos insert" ON storage.objects;
CREATE POLICY "agency logos insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'agency-logos'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND NOT public.is_anon_user()
  AND (public.has_role(auth.uid(), 'agent') OR public.has_role(auth.uid(), 'admin'))
);

DROP POLICY IF EXISTS "agency logos update" ON storage.objects;
CREATE POLICY "agency logos update" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'agency-logos' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (
  bucket_id = 'agency-logos'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND NOT public.is_anon_user()
  AND (public.has_role(auth.uid(), 'agent') OR public.has_role(auth.uid(), 'admin'))
);

DROP POLICY IF EXISTS "agency logos delete" ON storage.objects;
CREATE POLICY "agency logos delete" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'agency-logos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Branding of a trip owner -------------------------------------------------------------
-- {name, color, logo_url} when the owner is an active agent, otherwise NULL.
-- Internal: called by get_shared_trip only.
CREATE OR REPLACE FUNCTION public.agency_branding(_owner UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'name', nullif(btrim(p.agency_name), ''),
    'color', CASE WHEN p.agency_color ~ '^#[0-9A-Fa-f]{6}$' THEN p.agency_color END,
    'logo_url', CASE WHEN EXISTS (
        SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'agency-logos'
          AND p.agency_logo_url ~ ('^https://[A-Za-z0-9.:-]+/storage/v1/object/public/agency-logos/'
                                   || _owner::text || '/[A-Za-z0-9._-]+$')
          AND o.name = substring(p.agency_logo_url FROM '/agency-logos/(.+)$')
      ) THEN p.agency_logo_url END
  )
  FROM public.profiles p
  WHERE p.id = _owner
    AND public.has_role(_owner, 'agent')
    AND EXISTS (SELECT 1 FROM public.agent_accounts a WHERE a.user_id = _owner AND a.status = 'active')
$$;
REVOKE EXECUTE ON FUNCTION public.agency_branding(uuid) FROM PUBLIC, anon, authenticated;

-- Share page payload (021) + agency only for an active agent owner ------------------------
CREATE OR REPLACE FUNCTION public.get_shared_trip(p_slug TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'trip', jsonb_build_object(
      'id', t.id,
      'title', t.title,
      'destination', t.destination,
      'start_date', t.start_date,
      'end_date', t.end_date,
      'cover_emoji', t.cover_emoji,
      'guide_name', t.guide_name,
      'guide_phone', t.guide_phone,
      'photos_album_url', t.photos_album_url,
      'is_showcase', t.is_showcase,
      -- The hero photo, only when it's a Wikimedia image: image_url can be written
      -- through the API, and an arbitrary URL here would let a page owner log
      -- every visitor's IP with a tracking pixel.
      'image_url', CASE WHEN t.image_url ~ '^https://(upload|thumb)\.wikimedia\.org/' THEN t.image_url END
    ),
    -- Name, #rrggbb colour and own-bucket logo of an active agent owner; NULL otherwise.
    'agency', public.agency_branding(t.user_id),
    'flights', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'from_airport', f.from_airport, 'to_airport', f.to_airport,
        'airline', f.airline, 'flight_number', f.flight_number, 'depart_at', f.depart_at
      ) ORDER BY f.depart_at)
      FROM public.flights f WHERE f.trip_id = t.id
    ), '[]'::jsonb),
    'stays', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'hotel_name', s.hotel_name, 'address', s.address,
        'check_in', s.check_in, 'check_out', s.check_out, 'map_url', s.map_url
      ) ORDER BY s.check_in)
      FROM public.stays s WHERE s.trip_id = t.id
    ), '[]'::jsonb),
    'itinerary', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'day_date', i.day_date, 'start_time', i.start_time, 'title', i.title,
        'description', i.description, 'category', i.category, 'location', i.location,
        'map_url', i.map_url
      ) ORDER BY i.day_date, i.sort_order)
      FROM public.itinerary_items i WHERE i.trip_id = t.id
    ), '[]'::jsonb),
    'suggestions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', g.id, 'kind', g.kind, 'title', g.title, 'description', g.description,
        'location', g.location, 'map_url', g.map_url
      ) ORDER BY g.created_at)
      FROM public.suggestions g WHERE g.trip_id = t.id
    ), '[]'::jsonb),
    'updates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'title', u.title, 'body', u.body, 'kind', u.kind,
        'is_pinned', u.is_pinned, 'created_at', u.created_at
      ) ORDER BY u.is_pinned DESC, u.created_at DESC)
      FROM public.trip_updates u WHERE u.trip_id = t.id
    ), '[]'::jsonb)
  )
  FROM public.trips t
  WHERE t.share_slug = p_slug AND t.is_shared = true AND length(p_slug) >= 12
$$;

REVOKE EXECUTE ON FUNCTION public.get_shared_trip(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_trip(text) TO anon, authenticated;

-- Check: must return zero rows -----------------------------------------------------
SELECT 'policy' AS kind, tablename AS name, policyname AS detail
FROM pg_policies WHERE schemaname IN ('public', 'storage') AND 'anon' = ANY (roles)
UNION ALL
SELECT 'grant', table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'anon' AND table_schema = 'public'
UNION ALL
SELECT 'get_shared_trip: anon cannot execute it', '', ''
WHERE NOT has_function_privilege('anon', 'public.get_shared_trip(text)', 'EXECUTE')
UNION ALL
SELECT 'get_shared_trip exposes', leak, ''
FROM unnest(ARRAY['client_', 'booking_ref', '''notes''', '''participants''', '''documents''']) AS leak
WHERE pg_get_functiondef('public.get_shared_trip(text)'::regprocedure) LIKE '%' || leak || '%'
UNION ALL
SELECT 'get_shared_trip: does not filter image_url to Wikimedia', '', ''
WHERE pg_get_functiondef('public.get_shared_trip(text)'::regprocedure) NOT LIKE '%wikimedia%'
UNION ALL
SELECT 'agency_branding: not gated on an active agent', '', ''
WHERE pg_get_functiondef('public.agency_branding(uuid)'::regprocedure) NOT LIKE '%status = ''active''%'
UNION ALL
SELECT 'agency_branding: callable by an API role', r, ''
FROM unnest(ARRAY['anon', 'authenticated']) AS r
WHERE has_function_privilege(r, 'public.agency_branding(uuid)', 'EXECUTE')
UNION ALL
SELECT 'agency-logos bucket', 'missing, not public, or limits wrong', ''
WHERE NOT EXISTS (
  SELECT 1 FROM storage.buckets b
  WHERE b.id = 'agency-logos' AND b.public AND b.file_size_limit <= 1048576
    AND b.allowed_mime_types <@ ARRAY['image/png', 'image/jpeg', 'image/webp']
    AND cardinality(b.allowed_mime_types) > 0
)
UNION ALL
SELECT 'agency-logos policy not own-folder', policyname, cmd
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%agency-logos%'
  AND (coalesce(qual, '') || coalesce(with_check, '')) NOT LIKE '%foldername%auth.uid()%'
UNION ALL
SELECT 'agency-logos write policy without the agent role', policyname, cmd
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND cmd IN ('INSERT', 'UPDATE')
  AND coalesce(with_check, '') LIKE '%agency-logos%'
  AND coalesce(with_check, '') NOT LIKE '%''agent''%';
