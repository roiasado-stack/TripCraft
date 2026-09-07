-- ============================================================================
-- TripCraft — migration 004
-- Usage/cost logging for the AI Edge Functions (ask + generate), plus the
-- self-scoped helper the functions use to enforce a per-user daily spend cap
-- before calling the LLM. Safe to run more than once.
-- ============================================================================

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

-- NOTE: deliberately NOT part of the child-table loop in schema.sql, same
-- reason as trip_chat_messages — this is internal usage/cost data, never
-- something a shared-trip visitor on /share/:slug should see.
GRANT SELECT, INSERT ON public.agent_runs TO authenticated;
GRANT ALL ON public.agent_runs TO service_role;
REVOKE ALL ON public.agent_runs FROM anon;

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

-- Each Edge Function call inserts its own row using the caller's JWT, so the
-- insert just needs to match the caller — not the admin-only read below.
DROP POLICY IF EXISTS "own insert" ON public.agent_runs;
CREATE POLICY "own insert" ON public.agent_runs FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

-- The internal monitoring screen is admin-only: a regular traveler has no
-- reason to see spend across the whole app.
DROP POLICY IF EXISTS "admin read" ON public.agent_runs;
CREATE POLICY "admin read" ON public.agent_runs FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS agent_runs_created_idx ON public.agent_runs (created_at);
CREATE INDEX IF NOT EXISTS agent_runs_user_created_idx ON public.agent_runs (user_id, created_at);

-- SECURITY DEFINER, self-scoped to auth.uid() (no user_id argument, so there
-- is nothing to pass someone else's id into) — lets an Edge Function running
-- with the caller's own JWT check the caller's own spend today, even though
-- the "admin read" policy above would otherwise block that SELECT.
CREATE OR REPLACE FUNCTION public.my_agent_daily_cost_usd()
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(cost_usd), 0) FROM public.agent_runs
  WHERE user_id = auth.uid() AND created_at >= date_trunc('day', now())
$$;
REVOKE EXECUTE ON FUNCTION public.my_agent_daily_cost_usd() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_agent_daily_cost_usd() TO authenticated;
