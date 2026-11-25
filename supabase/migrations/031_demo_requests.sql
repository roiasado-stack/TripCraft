-- ============================================================================
-- 031 — Agent demo requests from the /agents page (Roi, 2026-11-25)
--
-- A travel agent fills in the form on /agents#demo. The Edge Function
-- `demo-request` (service role) stores the row here, emails the agent a link to
-- the demo, and notifies the business inbox. Nobody else touches this table:
-- RLS is on and there are NO policies and NO grants for anon / authenticated,
-- so the rows (names, phones, emails of leads) are readable only from the
-- dashboard / service role.
--
-- ORDER IN PRODUCTION: paste this BEFORE deploying the demo-request function.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.demo_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  full_name     TEXT NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 100),
  agency_name   TEXT NOT NULL CHECK (char_length(btrim(agency_name)) BETWEEN 2 AND 120),
  phone         TEXT NOT NULL CHECK (char_length(btrim(phone)) BETWEEN 7 AND 30),
  email         TEXT NOT NULL CHECK (char_length(email) BETWEEN 5 AND 254 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- "How many trips a month?": up to 10 / 10-30 / 30+
  trips_per_month TEXT NOT NULL CHECK (trips_per_month IN ('up_to_10', '10_30', '30_plus')),
  -- Set by the function once each email went out (null = not sent / failed).
  agent_emailed_at TIMESTAMPTZ,
  team_notified_at TIMESTAMPTZ
);

ALTER TABLE public.demo_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.demo_requests FROM PUBLIC, anon, authenticated;

-- The function throttles per address; this makes that lookup cheap.
CREATE INDEX IF NOT EXISTS demo_requests_email_created_idx
  ON public.demo_requests (lower(email), created_at DESC);
CREATE INDEX IF NOT EXISTS demo_requests_created_idx
  ON public.demo_requests (created_at DESC);

-- Check: must return zero rows -----------------------------------------------------
SELECT 'rls off' AS problem, 'demo_requests' AS name
FROM pg_class WHERE oid = 'public.demo_requests'::regclass AND NOT relrowsecurity
UNION ALL
SELECT 'policy exists', policyname::text FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'demo_requests'
UNION ALL
SELECT 'client grant', grantee || ' ' || privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'demo_requests' AND grantee IN ('anon', 'authenticated', 'PUBLIC');
