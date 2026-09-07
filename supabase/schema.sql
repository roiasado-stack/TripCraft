-- ============================================================================
-- TripCraft — full database schema
-- Paste this whole file into the Supabase SQL Editor and run it once.
-- Safe to run on a fresh project. Creates tables, RLS, roles, storage, security.
-- ============================================================================

-- Roles ----------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin','agent','traveler');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Profiles -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY,
  full_name TEXT,
  agency_name TEXT,
  agency_logo_url TEXT,
  agency_color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT SELECT ON public.profiles TO anon; -- agency branding on shared pages
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own profile" ON public.profiles;
CREATE POLICY "own profile" ON public.profiles FOR ALL TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
DROP POLICY IF EXISTS "public agency read" ON public.profiles;
CREATE POLICY "public agency read" ON public.profiles FOR SELECT TO anon USING (true);

-- User roles (never stored on the profile) -----------------------------------
CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read own roles" ON public.user_roles;
CREATE POLICY "read own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- New-user trigger: create profile + default 'traveler' role -----------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'traveler')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- Trips ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  destination TEXT NOT NULL,
  start_date DATE,
  end_date DATE,
  trip_type TEXT NOT NULL DEFAULT 'family',
  budget_level TEXT,
  notes TEXT,
  cover_emoji TEXT DEFAULT '🌴',
  is_shared BOOLEAN NOT NULL DEFAULT false,
  share_slug TEXT UNIQUE DEFAULT encode(gen_random_bytes(9),'hex'),
  is_template BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trips TO authenticated;
GRANT SELECT ON public.trips TO anon;
GRANT ALL ON public.trips TO service_role;
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own trips" ON public.trips;
CREATE POLICY "own trips" ON public.trips FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "shared trips readable" ON public.trips;
CREATE POLICY "shared trips readable" ON public.trips FOR SELECT TO anon, authenticated USING (is_shared = true);
DROP TRIGGER IF EXISTS trips_updated ON public.trips;
CREATE TRIGGER trips_updated BEFORE UPDATE ON public.trips FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.owns_trip(_trip_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.trips t WHERE t.id = _trip_id AND t.user_id = auth.uid())
$$;
CREATE OR REPLACE FUNCTION public.trip_is_shared(_trip_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.trips t WHERE t.id = _trip_id AND t.is_shared = true)
$$;

-- Child tables ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  age INT,
  age_range TEXT,
  preferences TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.flights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  direction TEXT NOT NULL DEFAULT 'outbound',
  airline TEXT, flight_number TEXT, from_airport TEXT, to_airport TEXT,
  depart_at TIMESTAMPTZ, arrive_at TIMESTAMPTZ, booking_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.stays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  hotel_name TEXT NOT NULL, address TEXT, check_in DATE, check_out DATE,
  booking_ref TEXT, notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'transfer', provider TEXT,
  pickup_location TEXT, dropoff_location TEXT,
  pickup_at TIMESTAMPTZ, return_at TIMESTAMPTZ, booking_ref TEXT, notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.itinerary_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  day_date DATE NOT NULL, start_time TIME, title TEXT NOT NULL, description TEXT,
  category TEXT NOT NULL DEFAULT 'activity', location TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'attraction', title TEXT NOT NULL, description TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}', age_min INT, age_max INT, price_level TEXT,
  liked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  participant_id UUID REFERENCES public.participants(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'other', name TEXT NOT NULL,
  storage_path TEXT, external_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  participant_id UUID REFERENCES public.participants(id) ON DELETE SET NULL,
  title TEXT NOT NULL, is_done BOOLEAN NOT NULL DEFAULT false,
  is_shared BOOLEAN NOT NULL DEFAULT true, sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS + grants for all child tables ------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['participants','flights','stays','transfers','itinerary_items','suggestions','documents','checklist_items']
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "owner all" ON public.%I', t);
    EXECUTE format('CREATE POLICY "owner all" ON public.%I FOR ALL TO authenticated USING (public.owns_trip(trip_id)) WITH CHECK (public.owns_trip(trip_id))', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (trip_id)', t || '_trip_idx', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['participants','flights','stays','transfers','itinerary_items','suggestions','checklist_items']
  LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO anon', t);
    EXECUTE format('DROP POLICY IF EXISTS "shared read" ON public.%I', t);
    EXECUTE format('CREATE POLICY "shared read" ON public.%I FOR SELECT TO anon, authenticated USING (public.trip_is_shared(trip_id))', t);
  END LOOP;
END $$;

-- Agent conversation (owner-only) ---------------------------------------------
-- Sits OUTSIDE the loop above on purpose: the agent is owner-only, so this table
-- gets no anon grant and no "shared read" policy. A trip owner's conversation
-- must never surface on /share/:slug.
CREATE TABLE IF NOT EXISTS public.trip_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  role TEXT NOT NULL,                                -- user | assistant
  content TEXT NOT NULL,
  cards JSONB NOT NULL DEFAULT '[]'::jsonb,          -- AgentCard[] the client can add (legacy, pre-tool-use messages)
  pending_actions JSONB NOT NULL DEFAULT '[]'::jsonb, -- PendingAction[] — proposed add_to_itinerary/add_suggestion tool calls, approved client-side
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.trip_chat_messages TO authenticated;
GRANT ALL ON public.trip_chat_messages TO service_role;
-- Supabase's default privileges on schema public grant new tables to anon, so
-- the absence of a GRANT here is not enough — revoke explicitly. RLS already
-- denies anon every row (no anon policy exists); this makes the grant match the
-- intent instead of leaving RLS as the only thing holding the door.
REVOKE ALL ON public.trip_chat_messages FROM anon;
ALTER TABLE public.trip_chat_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owner all" ON public.trip_chat_messages;
CREATE POLICY "owner all" ON public.trip_chat_messages FOR ALL TO authenticated
USING (public.owns_trip(trip_id)) WITH CHECK (public.owns_trip(trip_id));
CREATE INDEX IF NOT EXISTS trip_chat_messages_trip_idx
  ON public.trip_chat_messages (trip_id, created_at);

-- Agent usage/cost logging (admin-read-only) ----------------------------------
-- Sits OUTSIDE the loop above on purpose, same reason as trip_chat_messages:
-- this is internal spend data, and it gets no anon grant and no "shared read"
-- policy. Reads are further restricted to admins — a regular traveler has no
-- reason to see spend across the whole app.
CREATE TABLE IF NOT EXISTS public.agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable: passport-scan calls (generate kind="passports") happen during
  -- participant import and aren't tied to a trip — everything else always has one.
  trip_id UUID REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  kind TEXT NOT NULL,                                -- ask | generate_suggestions | generate_itinerary | generate_checklist | generate_passports
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  latency_ms INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok',                 -- ok | error
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.agent_runs TO authenticated;
GRANT ALL ON public.agent_runs TO service_role;
REVOKE ALL ON public.agent_runs FROM anon;
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own insert" ON public.agent_runs;
CREATE POLICY "own insert" ON public.agent_runs FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "admin read" ON public.agent_runs;
CREATE POLICY "admin read" ON public.agent_runs FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS agent_runs_created_idx ON public.agent_runs (created_at);
CREATE INDEX IF NOT EXISTS agent_runs_user_created_idx ON public.agent_runs (user_id, created_at);

-- Self-scoped (auth.uid() only, no argument to pass someone else's id into)
-- so an Edge Function running with the caller's own JWT can check the
-- caller's own spend today before calling the LLM, even though "admin read"
-- above blocks that SELECT directly.
CREATE OR REPLACE FUNCTION public.my_agent_daily_cost_usd()
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(cost_usd), 0) FROM public.agent_runs
  WHERE user_id = auth.uid() AND created_at >= date_trunc('day', now())
$$;

-- pgvector knowledge source for find_kosher (3 destinations only, each fact
-- sourced and dated — see migration 006 for the full rationale) -------------
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  destination TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_verified_on DATE NOT NULL,
  embedding VECTOR(1024) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.knowledge_chunks TO service_role;
REVOKE ALL ON public.knowledge_chunks FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS knowledge_chunks_destination_idx ON public.knowledge_chunks (destination);
CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  query_embedding VECTOR(1024),
  filter_destination TEXT,
  match_count INT DEFAULT 5,
  min_similarity FLOAT DEFAULT 0.3
)
RETURNS TABLE (
  title TEXT, content TEXT, category TEXT, source_url TEXT, source_verified_on DATE, similarity FLOAT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT title, content, category, source_url, source_verified_on,
         1 - (embedding <=> query_embedding) AS similarity
  FROM public.knowledge_chunks
  WHERE destination = filter_destination
    AND 1 - (embedding <=> query_embedding) >= min_similarity
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
REVOKE EXECUTE ON FUNCTION public.match_knowledge_chunks(vector, text, int, float) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(vector, text, int, float) TO authenticated;

-- Freshness signal for the curated knowledge base: source_verified_on already
-- records when a human last checked each fact. This surfaces chunks overdue
-- for re-verification (admin-only) without ever auto-trusting unverified
-- content — see migration 008.
CREATE OR REPLACE FUNCTION public.stale_knowledge_chunks(threshold_months INT DEFAULT 6)
RETURNS TABLE (
  id UUID,
  destination TEXT,
  category TEXT,
  title TEXT,
  source_url TEXT,
  source_verified_on DATE,
  days_stale INT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT k.id, k.destination, k.category, k.title, k.source_url, k.source_verified_on,
         (CURRENT_DATE - k.source_verified_on)::INT AS days_stale
  FROM public.knowledge_chunks k
  WHERE k.source_verified_on < (CURRENT_DATE - (threshold_months || ' months')::INTERVAL)
  ORDER BY k.source_verified_on ASC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.stale_knowledge_chunks(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stale_knowledge_chunks(int) TO authenticated;

-- Log table for the n8n pre-departure-reminder automation (Day 12). Written
-- by n8n with the service_role key — a trusted backend actor, not a user —
-- so like agent_runs/knowledge_chunks it has zero anon/authenticated grants.
CREATE TABLE IF NOT EXISTS public.automation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID REFERENCES public.trips(id) ON DELETE CASCADE,
  scenario TEXT NOT NULL DEFAULT 'pre_departure_reminder',
  status TEXT NOT NULL,
  detail TEXT,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.automation_logs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.automation_logs TO service_role;
REVOKE ALL ON public.automation_logs FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS automation_logs_trip_idx ON public.automation_logs (trip_id);
CREATE INDEX IF NOT EXISTS automation_logs_run_at_idx ON public.automation_logs (run_at);

-- Storage: private bucket for trip documents ---------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('trip-docs', 'trip-docs', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "own docs read" ON storage.objects;
CREATE POLICY "own docs read" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'trip-docs' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "own docs insert" ON storage.objects;
CREATE POLICY "own docs insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'trip-docs' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "own docs update" ON storage.objects;
CREATE POLICY "own docs update" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'trip-docs' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "own docs delete" ON storage.objects;
CREATE POLICY "own docs delete" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'trip-docs' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Lock down security-definer functions ---------------------------------------
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.owns_trip(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trip_is_shared(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.my_agent_daily_cost_usd() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owns_trip(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.trip_is_shared(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_agent_daily_cost_usd() TO authenticated;
