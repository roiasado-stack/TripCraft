-- ============================================================================
-- 022 — Travel-agent accounts (agency beta, phase 1)
--
-- A signed-up user asks for agent access (request_agent_access); the request
-- sits as 'pending' until an admin approves it (admin_decide_agent), which
-- also grants the 'agent' role in user_roles. Suspending removes the role.
-- Each agent carries their own limits: AI $/day and $/month, Google calls per
-- day and active trips. The ask/generate Edge Functions read them through
-- my_agent_limits() / agent_limits(uid); the trip limit is a trigger here.
--
-- Nobody writes agent_accounts directly: the table is SELECT-only for
-- authenticated (own row, or every row for an admin) and every change goes
-- through the SECURITY DEFINER functions below.
--
-- trip_clients: the agent's customer (name, phone) for a trip. A separate
-- owner-only table, not trips columns: every member of a trip can read the
-- trips row, and in a group trip the other travellers must not see the
-- client's phone. Never added to get_shared_trip.
--
-- Idempotent. Paste into the SQL Editor after 021.
-- ============================================================================

-- Table --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_accounts (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended')),
  agency_name TEXT NOT NULL CHECK (length(agency_name) BETWEEN 1 AND 120),
  phone TEXT CHECK (phone IS NULL OR length(phone) <= 40),
  ai_daily_usd NUMERIC(10,2) NOT NULL DEFAULT 3 CHECK (ai_daily_usd BETWEEN 0 AND 15),
  ai_monthly_usd NUMERIC(10,2) NOT NULL DEFAULT 15 CHECK (ai_monthly_usd BETWEEN 0 AND 500),
  google_daily INT NOT NULL DEFAULT 20 CHECK (google_daily BETWEEN 0 AND 100),
  max_active_trips INT NOT NULL DEFAULT 30 CHECK (max_active_trips BETWEEN 0 AND 500),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  decided_by UUID
);
CREATE INDEX IF NOT EXISTS agent_accounts_status_idx ON public.agent_accounts (status);

ALTER TABLE public.agent_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.agent_accounts TO authenticated;
GRANT ALL ON public.agent_accounts TO service_role;

DROP POLICY IF EXISTS "agent accounts select" ON public.agent_accounts;
CREATE POLICY "agent accounts select" ON public.agent_accounts FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- Client of an agent's trip (trip owner only) ----------------------------------------
CREATE TABLE IF NOT EXISTS public.trip_clients (
  trip_id UUID PRIMARY KEY REFERENCES public.trips(id) ON DELETE CASCADE,
  client_name TEXT CHECK (client_name IS NULL OR length(client_name) <= 120),
  client_phone TEXT CHECK (client_phone IS NULL OR length(client_phone) <= 40),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.trip_clients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trip_clients FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_clients TO authenticated;
GRANT ALL ON public.trip_clients TO service_role;
DROP POLICY IF EXISTS "trip clients owner" ON public.trip_clients;
CREATE POLICY "trip clients owner" ON public.trip_clients FOR ALL TO authenticated
  USING (public.owns_trip(trip_id)) WITH CHECK (public.owns_trip(trip_id));
DROP TRIGGER IF EXISTS trip_clients_updated ON public.trip_clients;
CREATE TRIGGER trip_clients_updated BEFORE UPDATE ON public.trip_clients
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Limits ---------------------------------------------------------------------------
-- The caller's limits and this month's AI spend, or NULL when they are not an
-- active agent (pending, suspended, no row, or the role was removed).
CREATE OR REPLACE FUNCTION public.agent_limits(_user_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'ai_daily_usd', a.ai_daily_usd,
    'ai_monthly_usd', a.ai_monthly_usd,
    'google_daily', a.google_daily,
    'max_active_trips', a.max_active_trips,
    'month_cost_usd', (SELECT COALESCE(SUM(GREATEST(r.cost_usd, 0)), 0) FROM public.agent_runs r
                       WHERE r.user_id = a.user_id AND r.created_at >= date_trunc('month', now()))
  )
  FROM public.agent_accounts a
  WHERE a.user_id = _user_id AND a.status = 'active' AND public.has_role(_user_id, 'agent')
$$;

-- Self-scoped wrapper for the Edge Functions running with the caller's JWT.
CREATE OR REPLACE FUNCTION public.my_agent_limits()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.agent_limits(auth.uid())
$$;

-- Trips that still count against max_active_trips: not templates, not over.
CREATE OR REPLACE FUNCTION public.agent_active_trip_count(_user_id UUID)
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM public.trips t
  WHERE t.user_id = _user_id AND NOT t.is_template AND (t.end_date IS NULL OR t.end_date >= current_date)
$$;

-- Requests -------------------------------------------------------------------------
-- A signed-up (not demo) user asks for agent access. Creates a 'pending' row with
-- the default limits, or edits the details of a still-pending request. Never
-- grants a role and never changes an active or suspended account.
CREATE OR REPLACE FUNCTION public.request_agent_access(p_agency_name TEXT, p_phone TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  v_name TEXT := btrim(coalesce(p_agency_name, ''));
  v_phone TEXT := nullif(btrim(coalesce(p_phone, '')), '');
  current_status TEXT;
BEGIN
  IF uid IS NULL OR public.is_anon_user() THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF length(v_name) = 0 OR length(v_name) > 120 OR length(coalesce(v_phone, '')) > 40 THEN
    RAISE EXCEPTION 'invalid_details' USING ERRCODE = '23514';
  END IF;

  SELECT a.status INTO current_status FROM public.agent_accounts a WHERE a.user_id = uid;
  IF current_status IS NULL THEN
    INSERT INTO public.agent_accounts (user_id, agency_name, phone) VALUES (uid, v_name, v_phone);
    RETURN 'pending';
  ELSIF current_status = 'pending' THEN
    UPDATE public.agent_accounts SET agency_name = v_name, phone = v_phone, requested_at = now() WHERE user_id = uid;
  END IF;
  RETURN current_status;
END;
$$;

-- Admin ------------------------------------------------------------------------------
-- Approve → active + 'agent' role. Reject / suspend → suspended, role removed.
CREATE OR REPLACE FUNCTION public.admin_decide_agent(p_user_id UUID, p_approve BOOLEAN)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_status TEXT := CASE WHEN p_approve THEN 'active' ELSE 'suspended' END;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.agent_accounts
  SET status = new_status, decided_at = now(), decided_by = auth.uid()
  WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent_request_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_approve THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (p_user_id, 'agent')
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles WHERE user_id = p_user_id AND role = 'agent';
  END IF;
  RETURN new_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_agent_limits(
  p_user_id UUID, p_ai_daily_usd NUMERIC, p_ai_monthly_usd NUMERIC, p_google_daily INT, p_max_active_trips INT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- NULLs would slip past the CHECKs as "no limit"; the column NOT NULLs reject them.
  UPDATE public.agent_accounts
  SET ai_daily_usd = p_ai_daily_usd, ai_monthly_usd = p_ai_monthly_usd,
      google_daily = p_google_daily, max_active_trips = p_max_active_trips
  WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent_request_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

-- Every account with its usage. Google calls are the cost-0 agent_runs rows the
-- Edge Functions write per Google request: 'google_kosher_search' (ask: kosher
-- text search and the geocoding fallback) and 'google_place_photo' (generate).
-- An agent's google_daily caps each of the two per UTC day.
CREATE OR REPLACE FUNCTION public.admin_list_agents()
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  status TEXT,
  agency_name TEXT,
  phone TEXT,
  ai_daily_usd NUMERIC,
  ai_monthly_usd NUMERIC,
  google_daily INT,
  max_active_trips INT,
  requested_at TIMESTAMPTZ,
  decided_at TIMESTAMPTZ,
  ai_today_usd NUMERIC,
  ai_month_usd NUMERIC,
  google_searches_today INT,
  google_photos_today INT,
  active_trips INT
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT a.user_id, u.email::text, a.status, a.agency_name, a.phone,
         a.ai_daily_usd, a.ai_monthly_usd, a.google_daily, a.max_active_trips,
         a.requested_at, a.decided_at,
         COALESCE(SUM(GREATEST(r.cost_usd, 0)) FILTER (WHERE r.created_at >= date_trunc('day', now())), 0),
         COALESCE(SUM(GREATEST(r.cost_usd, 0)), 0),
         (count(*) FILTER (WHERE r.kind = 'google_kosher_search' AND r.created_at >= date_trunc('day', now())))::int,
         (count(*) FILTER (WHERE r.kind = 'google_place_photo' AND r.created_at >= date_trunc('day', now())))::int,
         public.agent_active_trip_count(a.user_id)
  FROM public.agent_accounts a
  LEFT JOIN auth.users u ON u.id = a.user_id
  LEFT JOIN public.agent_runs r ON r.user_id = a.user_id AND r.created_at >= date_trunc('month', now())
  GROUP BY a.user_id, u.email
  ORDER BY (a.status = 'pending') DESC, a.requested_at DESC;
END;
$$;

-- Trip limit -------------------------------------------------------------------------
-- Checked whenever a row starts counting: a new active trip, or an UPDATE that
-- reopens an ended trip (end_date) or turns a template into a trip. A row that
-- won't count (template, already ended) is never blocked.
CREATE OR REPLACE FUNCTION public.enforce_agent_trip_limit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE lim INT; used INT;
BEGIN
  IF NEW.is_template OR NEW.end_date < current_date THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NOT OLD.is_template AND (OLD.end_date IS NULL OR OLD.end_date >= current_date) THEN
    RETURN NEW;  -- already counted
  END IF;
  SELECT (public.agent_limits(NEW.user_id) ->> 'max_active_trips')::int INTO lim;
  -- Serialise one agent's concurrent inserts, or N parallel requests would all see the same count.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.user_id::text));
  IF lim IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO used FROM public.trips t
  WHERE t.user_id = NEW.user_id AND t.id <> NEW.id
    AND NOT t.is_template AND (t.end_date IS NULL OR t.end_date >= current_date);
  IF used >= lim THEN
    RAISE EXCEPTION 'agent_trip_limit_reached' USING ERRCODE = '23514',
      DETAIL = format('max_active_trips = %s', lim);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trips_agent_limit ON public.trips;
CREATE TRIGGER trips_agent_limit BEFORE INSERT OR UPDATE OF is_template, end_date ON public.trips
FOR EACH ROW EXECUTE FUNCTION public.enforce_agent_trip_limit();

-- Passport count for a trip the caller owns, including members' private uploads
-- the owner can't read under RLS. Owner-only (NULL otherwise) and returns a
-- number, never a document.
CREATE OR REPLACE FUNCTION public.trip_passport_count(_trip_id UUID)
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN public.owns_trip(_trip_id) THEN (
    SELECT count(DISTINCT d.participant_id)::int
    FROM public.documents d JOIN public.participants p ON p.id = d.participant_id AND p.trip_id = _trip_id
    WHERE d.trip_id = _trip_id AND d.category = 'passport'
  ) END
$$;

-- Agent board ------------------------------------------------------------------------
-- One row per trip the caller owns, with the counts the /agent screen shows.
-- SECURITY INVOKER: every count goes through the caller's own RLS, except
-- passports (trip_passport_count, owner-only): participants with at least one
-- document in category 'passport', whoever uploaded it.
CREATE OR REPLACE FUNCTION public.agent_trip_board()
RETURNS TABLE (
  id UUID,
  title TEXT,
  destination TEXT,
  start_date DATE,
  end_date DATE,
  client_name TEXT,
  client_phone TEXT,
  is_shared BOOLEAN,
  share_slug TEXT,
  image_url TEXT,
  participants_count INT,
  members_joined INT,
  members_pending INT,
  passports_count INT,
  documents_count INT,
  bookings_count INT,
  needs_attention TEXT[]
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH b AS (
    SELECT t.id, t.title, t.destination, t.start_date, t.end_date, c.client_name, c.client_phone,
           t.is_shared, t.share_slug, t.image_url,
           (SELECT count(*) FROM participants p WHERE p.trip_id = t.id)::int AS participants_count,
           (SELECT count(*) FROM trip_members m WHERE m.trip_id = t.id AND m.status = 'active')::int AS members_joined,
           (SELECT count(*) FROM trip_members m WHERE m.trip_id = t.id AND m.status = 'pending')::int AS members_pending,
           COALESCE(public.trip_passport_count(t.id), 0) AS passports_count,
           (SELECT count(*) FROM documents d WHERE d.trip_id = t.id)::int AS documents_count,
           ((SELECT count(*) FROM flights f WHERE f.trip_id = t.id)
            + (SELECT count(*) FROM stays s WHERE s.trip_id = t.id)
            + (SELECT count(*) FROM transfers x WHERE x.trip_id = t.id))::int AS bookings_count,
           (t.end_date IS NULL OR t.end_date >= current_date) AS not_over
    FROM trips t
    LEFT JOIN trip_clients c ON c.trip_id = t.id
    WHERE t.user_id = auth.uid() AND NOT t.is_template
      AND (public.has_role(auth.uid(), 'agent') OR public.has_role(auth.uid(), 'admin'))
  )
  SELECT b.id, b.title, b.destination, b.start_date, b.end_date, b.client_name, b.client_phone,
         b.is_shared, b.share_slug, b.image_url,
         b.participants_count, b.members_joined, b.members_pending, b.passports_count,
         b.documents_count, b.bookings_count,
         CASE WHEN NOT b.not_over THEN ARRAY[]::text[] ELSE array_remove(ARRAY[
           CASE WHEN b.passports_count < b.participants_count THEN 'missing_passports' END,
           -- Nobody joined yet; families with kids never fully join, so not "fewer than travellers".
           CASE WHEN b.members_joined = 0 AND b.participants_count > 0 THEN 'not_joined' END,
           CASE WHEN b.members_pending > 0 THEN 'pending_members' END,
           CASE WHEN b.start_date IS NULL THEN 'no_dates' END,
           CASE WHEN b.start_date BETWEEN current_date AND current_date + 7 THEN 'departing_soon' END
         ], NULL) END
  FROM b
  ORDER BY b.start_date NULLS LAST, b.title
$$;

-- Function grants --------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.agent_limits(uuid), public.agent_active_trip_count(uuid),
  public.enforce_agent_trip_limit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_limits(uuid), public.agent_active_trip_count(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.my_agent_limits(), public.request_agent_access(text, text),
  public.admin_decide_agent(uuid, boolean), public.admin_set_agent_limits(uuid, numeric, numeric, int, int),
  public.admin_list_agents(), public.agent_trip_board(), public.trip_passport_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_agent_limits(), public.request_agent_access(text, text),
  public.admin_decide_agent(uuid, boolean), public.admin_set_agent_limits(uuid, numeric, numeric, int, int),
  public.admin_list_agents(), public.agent_trip_board(), public.trip_passport_count(uuid) TO authenticated;

-- Check: must return zero rows -----------------------------------------------------
SELECT 'policy' AS kind, tablename AS name, policyname AS detail
FROM pg_policies WHERE schemaname = 'public' AND 'anon' = ANY (roles)
UNION ALL
SELECT 'grant', table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'anon' AND table_schema = 'public'
UNION ALL
SELECT 'authenticated can write agent_accounts', table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'authenticated' AND table_schema = 'public' AND table_name = 'agent_accounts'
  AND privilege_type <> 'SELECT'
UNION ALL
SELECT 'anon can execute', p.proname, ''
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('agent_limits', 'my_agent_limits', 'agent_active_trip_count', 'request_agent_access',
                    'admin_decide_agent', 'admin_set_agent_limits', 'admin_list_agents', 'agent_trip_board',
                    'trip_passport_count')
  AND has_function_privilege('anon', p.oid, 'EXECUTE')
UNION ALL
SELECT 'get_shared_trip exposes', 'client', ''
WHERE pg_get_functiondef('public.get_shared_trip(text)'::regprocedure) LIKE '%client_%'
UNION ALL
SELECT 'trip_clients', 'RLS off', ''
WHERE NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.trip_clients'::regclass)
UNION ALL
SELECT 'trip_clients', 'policy not owner-only', policyname
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trip_clients'
  AND (qual NOT LIKE '%owns_trip%' OR with_check NOT LIKE '%owns_trip%')
UNION ALL
SELECT 'trips still has', column_name, ''
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'trips' AND column_name IN ('client_name', 'client_phone');
