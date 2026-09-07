-- ============================================================================
-- TripCraft — migration 007
-- Log table for the Day-12 n8n automation (pre-departure reminder scenario).
-- n8n writes here using the service_role key — it's a trusted backend actor,
-- not a user, so like agent_runs/knowledge_chunks this table has zero anon/
-- authenticated grants. Safe to run more than once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.automation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID REFERENCES public.trips(id) ON DELETE CASCADE,
  scenario TEXT NOT NULL DEFAULT 'pre_departure_reminder',
  status TEXT NOT NULL,          -- ok | error
  detail TEXT,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.automation_logs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.automation_logs TO service_role;
REVOKE ALL ON public.automation_logs FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS automation_logs_trip_idx ON public.automation_logs (trip_id);
CREATE INDEX IF NOT EXISTS automation_logs_run_at_idx ON public.automation_logs (run_at);
