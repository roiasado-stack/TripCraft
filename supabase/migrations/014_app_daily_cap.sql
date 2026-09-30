-- ============================================================================
-- 014 — App-wide daily AI spend
--
-- The $2/day cap in the ask/generate Edge Functions is per user, and signup is
-- open — fifty curious sign-ups from a LinkedIn post could still spend $100 in
-- a day. The functions now also stop once the whole app has spent
-- APP_DAILY_CAP_USD today. This returns only the total, never per-user rows,
-- so it is safe to expose to any signed-in caller.
--
-- Idempotent. Paste into the SQL Editor after 013.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.app_agent_daily_cost_usd()
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(GREATEST(cost_usd, 0)), 0) FROM public.agent_runs
  WHERE created_at >= date_trunc('day', now())
$$;
REVOKE EXECUTE ON FUNCTION public.app_agent_daily_cost_usd() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_agent_daily_cost_usd() TO authenticated;

-- Check: should return one row with today's total so far (a number, maybe 0).
SELECT public.app_agent_daily_cost_usd() AS app_spend_today_usd;
