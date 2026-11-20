-- ============================================================================
-- 030 — A daily AI pool for everyone who isn't an active travel agent (Roi, 2026-11-20)
--
-- The Edge Functions stop AI for the whole app at $15/day (014). Private
-- accounts and demo visitors now share at most $5 of it
-- (PRIVATE_APP_DAILY_CAP_USD in supabase/functions/_shared/ai-caps.ts), so a
-- busy day of them can't switch AI off for the agencies, who keep at least $10.
--
-- Returns one number (like app_agent_daily_cost_usd), never a row.
-- ORDER IN PRODUCTION: paste this BEFORE deploying the new ask / generate —
-- they call it, and a missing function counts as "pool full" for every
-- private and demo user.
--
-- Idempotent. Paste into the SQL Editor after 029.
-- ============================================================================

-- Today's (UTC day) AI spend of every user who is not an active agent: private
-- accounts, demo visitors, and suspended or pending agents.
CREATE OR REPLACE FUNCTION public.private_daily_cost_usd()
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(GREATEST(r.cost_usd, 0)), 0)
  FROM public.agent_runs r
  WHERE r.created_at >= date_trunc('day', now())
    AND NOT EXISTS (
      SELECT 1 FROM public.agent_accounts a
      WHERE a.user_id = r.user_id AND a.status = 'active' AND public.has_role(r.user_id, 'agent')
    )
$$;
REVOKE EXECUTE ON FUNCTION public.private_daily_cost_usd() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.private_daily_cost_usd() TO authenticated;

-- Check: must return zero rows -----------------------------------------------------
SELECT 'function missing' AS problem, 'private_daily_cost_usd' AS name
WHERE to_regprocedure('public.private_daily_cost_usd()') IS NULL
UNION ALL
SELECT 'anon can execute', 'private_daily_cost_usd'
WHERE has_function_privilege('anon', 'public.private_daily_cost_usd()'::regprocedure, 'EXECUTE')
UNION ALL
SELECT 'authenticated cannot execute', 'private_daily_cost_usd'
WHERE NOT has_function_privilege('authenticated', 'public.private_daily_cost_usd()'::regprocedure, 'EXECUTE')
UNION ALL
SELECT 'grant', table_name || ' ' || privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'anon' AND table_schema = 'public';
