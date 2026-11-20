-- ============================================================================
-- 029 — A private account owns one trip (Roi, 2026-11-20)
--
-- "Private" = a signed-up user who is not an active agent and not an admin.
-- Such a user may OWN one trip at a time (deleting it frees the slot). Trips
-- they only joined (trip_members) never count.
--
-- Not counted:
--   * the sample trip ("צור טיול לדוגמה"), marked is_sample — at most one per user;
--   * a "try it yourself" copy (demo_source_id) of a showcase published by an active
--     agent or an admin — clone_showcase_trip makes at most one per showcase per user.
--     Any owner can switch "try it yourself" on, so a copy of a PRIVATE user's showcase
--     is an ordinary, counted trip (the marker is dropped); otherwise share → try it →
--     share the copy → try it … would mint trips without end (security review, 20.11).
-- Templates DO count for a private user: nothing in the app makes one for them,
-- and an uncounted template is still a full trip by URL.
--
-- Untouched: active agents (their own limit, 022), admins, anonymous demo users
-- (016's 3-trip rule), and statements with no signed-in caller (SQL Editor,
-- service_role scripts).
--
-- user_trip_limits: a per-user override Roi sets by hand in the SQL Editor, e.g.
--   INSERT INTO public.user_trip_limits (user_id, max_trips, note)
--   VALUES ('<uuid>', 3, 'pilot traveller') ON CONFLICT (user_id) DO UPDATE SET max_trips = 3;
--
-- Idempotent. Paste into the SQL Editor after 028.
-- ============================================================================

-- Columns / table ----------------------------------------------------------------------
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS is_sample BOOLEAN NOT NULL DEFAULT false;

-- Sample trips made before this column existed (src/lib/demo-trip.ts: this exact title
-- and notes; edited notes = the user made it their own). One per user, the oldest.
-- Safe to re-run — e.g. right after the site deploy, for samples an old browser tab
-- created in between.
UPDATE public.trips t SET is_sample = true
FROM (
  SELECT DISTINCT ON (user_id) id FROM public.trips
  WHERE title = 'חופשה משפחתית ברודוס (דוגמה)' AND notes = 'טיול לדוגמה — אפשר לערוך או למחוק הכל.'
    AND NOT EXISTS (SELECT 1 FROM public.trips o WHERE o.user_id = trips.user_id AND o.is_sample)
  ORDER BY user_id, created_at
) s
WHERE t.id = s.id;

CREATE TABLE IF NOT EXISTS public.user_trip_limits (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  max_trips INT NOT NULL CHECK (max_trips BETWEEN 0 AND 100),
  note TEXT CHECK (note IS NULL OR length(note) <= 200),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.user_trip_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_trip_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.user_trip_limits TO service_role;
-- No policy on purpose: only postgres / service_role (which bypass RLS) touch it.

-- The limit ------------------------------------------------------------------------------
-- How many counted trips this user may own, or NULL when the rule doesn't apply
-- (active agent, admin, anonymous demo user, unknown user).
CREATE OR REPLACE FUNCTION public.private_trip_limit(_user_id UUID)
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _user_id IS NULL THEN NULL
    WHEN NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = _user_id AND NOT coalesce(u.is_anonymous, false)) THEN NULL
    WHEN public.has_role(_user_id, 'admin') THEN NULL
    WHEN public.agent_limits(_user_id) IS NOT NULL THEN NULL
    ELSE coalesce((SELECT l.max_trips FROM public.user_trip_limits l WHERE l.user_id = _user_id), 1)
  END
$$;

-- Owned trips that count: not the sample, not a showcase copy.
CREATE OR REPLACE FUNCTION public.private_trip_count(_user_id UUID)
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM public.trips t
  WHERE t.user_id = _user_id AND NOT t.is_sample AND t.demo_source_id IS NULL
$$;

-- For the screens (say it before the wizard, not after a scan). The trigger
-- below is the real gate. limit = null → no private limit applies.
CREATE OR REPLACE FUNCTION public.my_trip_quota()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'limit', public.private_trip_limit(auth.uid()),
    'used', public.private_trip_count(auth.uid()),
    'has_sample', EXISTS (SELECT 1 FROM public.trips t WHERE t.user_id = auth.uid() AND t.is_sample)
  )
  WHERE auth.uid() IS NOT NULL
$$;

-- Trigger ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_private_trip_limit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE lim INT; used INT; src_owner UUID;
BEGIN
  -- SQL Editor / service_role scripts: no signed-in caller, no app limit.
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  -- NULL for agents, admins and demo users: they skip the count below, but not the
  -- is_sample / demo_source_id rules — an account can later become private (a demo
  -- account upgraded, an agent suspended) and must not bring uncounted trips along.
  lim := public.private_trip_limit(NEW.user_id);

  IF TG_OP = 'UPDATE' THEN
    -- Nothing in the app changes these after insert; changing them is the only way
    -- to turn a counted trip into an uncounted one.
    IF NEW.demo_source_id IS DISTINCT FROM OLD.demo_source_id THEN
      RAISE EXCEPTION 'demo_source_locked' USING ERRCODE = '42501';
    END IF;
    IF NEW.is_sample AND NOT OLD.is_sample THEN
      RAISE EXCEPTION 'sample_flag_locked' USING ERRCODE = '42501';
    END IF;
    IF NEW.is_sample = OLD.is_sample THEN RETURN NEW; END IF;
    -- A sample turning into a real trip: counted from now on, checked below. Only the
    -- owner may spend their own slot that way, not an editor of their trip.
    IF OLD.user_id <> auth.uid() THEN
      RAISE EXCEPTION 'sample_flag_locked' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Serialise one user's concurrent inserts (same key as 022's agent trigger).
  PERFORM pg_advisory_xact_lock(hashtext(NEW.user_id::text));

  IF NEW.demo_source_id IS NOT NULL THEN
    -- Only a real showcase copy, and only one per showcase (what clone_showcase_trip makes).
    SELECT s.user_id INTO src_owner FROM public.trips s
     WHERE s.id = NEW.demo_source_id AND s.is_showcase AND s.is_shared;
    IF NEW.is_sample OR src_owner IS NULL
       OR EXISTS (SELECT 1 FROM public.trips t
                  WHERE t.user_id = NEW.user_id AND t.demo_source_id = NEW.demo_source_id AND t.id <> NEW.id) THEN
      RAISE EXCEPTION 'invalid_demo_copy' USING ERRCODE = '42501';
    END IF;
    -- Free only when an agency or an admin published the showcase. A copy of a private
    -- user's showcase is an ordinary trip: drop the marker so it counts now and on every
    -- later check (clone_showcase_trip then can't find it again, so a second click makes
    -- a second copy — which the count below stops at the limit).
    IF lim IS NULL OR public.private_trip_limit(src_owner) IS NULL THEN RETURN NEW; END IF;
    NEW.demo_source_id := NULL;
  END IF;

  IF NEW.is_sample THEN
    IF EXISTS (SELECT 1 FROM public.trips t WHERE t.user_id = NEW.user_id AND t.is_sample AND t.id <> NEW.id) THEN
      RAISE EXCEPTION 'sample_trip_limit_reached' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF lim IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO used FROM public.trips t
  WHERE t.user_id = NEW.user_id AND t.id <> NEW.id AND NOT t.is_sample AND t.demo_source_id IS NULL;
  IF used >= lim THEN
    RAISE EXCEPTION 'private_trip_limit_reached' USING ERRCODE = '23514',
      DETAIL = format('max_trips = %s', lim);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trips_private_limit ON public.trips;
CREATE TRIGGER trips_private_limit BEFORE INSERT OR UPDATE OF is_sample, demo_source_id ON public.trips
FOR EACH ROW EXECUTE FUNCTION public.enforce_private_trip_limit();

-- Function grants ------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.private_trip_limit(uuid), public.private_trip_count(uuid),
  public.enforce_private_trip_limit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.private_trip_limit(uuid), public.private_trip_count(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.my_trip_quota() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_trip_quota() TO authenticated;

-- Check: must return zero rows -----------------------------------------------------------
SELECT 'policy' AS kind, tablename AS name, policyname AS detail
FROM pg_policies WHERE schemaname = 'public' AND 'anon' = ANY (roles)
UNION ALL
SELECT 'grant', table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'anon' AND table_schema = 'public'
UNION ALL
SELECT 'user_trip_limits readable or writable by', grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'user_trip_limits' AND grantee IN ('authenticated', 'PUBLIC')
UNION ALL
SELECT 'user_trip_limits', 'RLS off', ''
WHERE NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_trip_limits'::regclass)
UNION ALL
SELECT 'can execute', p.proname, r.rolname
FROM pg_proc p CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname)
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('private_trip_limit', 'private_trip_count', 'enforce_private_trip_limit')
  AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')
UNION ALL
SELECT 'anon can execute', 'my_trip_quota', ''
WHERE has_function_privilege('anon', 'public.my_trip_quota()'::regprocedure, 'EXECUTE')
UNION ALL
SELECT 'trigger missing', 'trips_private_limit', ''
WHERE NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.trips'::regclass AND tgname = 'trips_private_limit')
UNION ALL
SELECT 'get_shared_trip exposes', 'is_sample', ''
WHERE pg_get_functiondef('public.get_shared_trip(text)'::regprocedure) LIKE '%is_sample%';
