-- ============================================================================
-- 027 — Install / push metrics for the app-store decision
--
-- How many signed-in users open the app installed (home screen / standalone)
-- versus in a browser tab, and how many have push on, by platform. Admin only.
--
-- 1. app_opens              one row per user per day per mode (installed or not),
--                           with the device type. Nothing else: no pages, no
--                           times, no user agent. Rows older than 180 days are
--                           deleted nightly by pg_cron.
--                           RLS on, no grants and no policies for any client role:
--                           the only way in is record_app_open, the only way out
--                           admin_install_metrics.
-- 2. record_app_open        the client calls it once a day per mode after sign-in.
--                           Writes the caller's own row only; a demo (anonymous)
--                           user is refused. A repeat on the same day is a no-op.
-- 3. admin_install_metrics  per platform over the last p_days (1..180): users who
--                           opened, users who opened installed, users with at
--                           least one push device on that platform. Admin only.
--                           A push device's platform comes from its user agent
--                           when there is one, else from the endpoint host
--                           (Apple → ios, Google FCM → android, others → desktop).
--
-- Not counted: visitors who only open a public share link without signing in —
-- counting them would need an anon write, which this schema never grants.
--
-- Idempotent. Paste into the SQL Editor after 026.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.app_opens (
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  day DATE NOT NULL DEFAULT current_date,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'desktop', 'other')),
  standalone BOOLEAN NOT NULL,
  PRIMARY KEY (user_id, day, standalone)
);
CREATE INDEX IF NOT EXISTS app_opens_day_idx ON public.app_opens (day);

ALTER TABLE public.app_opens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_opens FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.app_opens TO service_role;

-- Record that the caller opened the app today, installed or not. -------------------
CREATE OR REPLACE FUNCTION public.record_app_open(p_platform TEXT, p_standalone BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE uid UUID := auth.uid();
BEGIN
  IF uid IS NULL OR public.is_anon_user() THEN
    RAISE EXCEPTION 'anonymous_not_allowed' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.app_opens (user_id, day, platform, standalone)
  VALUES (uid, current_date,
          CASE WHEN p_platform IN ('ios', 'android', 'desktop') THEN p_platform ELSE 'other' END,
          coalesce(p_standalone, false))
  ON CONFLICT (user_id, day, standalone) DO NOTHING;
END;
$$;

-- Platform of a push device: user agent first, endpoint host as a fallback. --------
CREATE OR REPLACE FUNCTION public.push_device_platform(p_endpoint TEXT, p_user_agent TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p_user_agent ~ '(iPhone|iPad|iPod)' THEN 'ios'
    WHEN p_user_agent ~ 'Android' THEN 'android'
    WHEN nullif(p_user_agent, '') IS NOT NULL THEN 'desktop'
    WHEN p_endpoint ~ '^https://[a-z0-9.-]+\.push\.apple\.com/' THEN 'ios'
    WHEN p_endpoint ~ '^https://fcm\.googleapis\.com/' THEN 'android'
    WHEN p_endpoint IS NOT NULL THEN 'desktop'
    ELSE 'other'
  END
$$;

-- Admin: per platform over the last p_days. --------------------------------------
CREATE OR REPLACE FUNCTION public.admin_install_metrics(p_days INT DEFAULT 30)
RETURNS TABLE (platform TEXT, users_opened INT, users_installed INT, pct_installed NUMERIC,
               users_with_push INT, pct_push NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE since DATE := current_date - (greatest(1, least(coalesce(p_days, 30), 180)) - 1);
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH opened AS (
    SELECT o.platform AS p, o.user_id, bool_or(o.standalone) AS installed
    FROM public.app_opens o
    WHERE o.day >= since
    GROUP BY o.platform, o.user_id
  ), pushed AS (
    SELECT DISTINCT public.push_device_platform(s.endpoint, s.user_agent) AS p, s.user_id
    FROM public.push_subscriptions s
  ), per AS (
    SELECT op.p,
           count(*)::int AS n_opened,
           count(*) FILTER (WHERE op.installed)::int AS n_installed,
           count(pu.user_id)::int AS n_push
    FROM opened op
    LEFT JOIN pushed pu ON pu.p = op.p AND pu.user_id = op.user_id
    GROUP BY op.p
  )
  SELECT pl.name,
         coalesce(per.n_opened, 0),
         coalesce(per.n_installed, 0),
         CASE WHEN coalesce(per.n_opened, 0) > 0 THEN round(100.0 * per.n_installed / per.n_opened, 1) END,
         coalesce(per.n_push, 0),
         CASE WHEN coalesce(per.n_opened, 0) > 0 THEN round(100.0 * per.n_push / per.n_opened, 1) END
  FROM (VALUES (1, 'ios'), (2, 'android'), (3, 'desktop'), (4, 'other')) AS pl(ord, name)
  LEFT JOIN per ON per.p = pl.name
  ORDER BY pl.ord;
END;
$$;

REVOKE ALL ON FUNCTION public.record_app_open(text, boolean), public.admin_install_metrics(int),
  public.push_device_platform(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_app_open(text, boolean), public.admin_install_metrics(int)
  TO authenticated;

-- Keep 180 days, no more.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('cleanup-app-opens', '29 3 * * *',
  $$DELETE FROM public.app_opens WHERE day < current_date - 180$$);

-- Check: must return zero rows -----------------------------------------------------
SELECT 'app_opens: RLS is off' AS problem, '' AS detail
FROM pg_class WHERE oid = 'public.app_opens'::regclass AND NOT relrowsecurity
UNION ALL
SELECT 'app_opens: client grant', r || ' has ' || p
FROM unnest(ARRAY['anon', 'authenticated']) AS r,
     unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p
WHERE has_table_privilege(r, 'public.app_opens', p)
UNION ALL
SELECT 'app_opens: unexpected policy', policyname
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'app_opens'
UNION ALL
SELECT 'callable by anon', p.oid::regprocedure::text
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('record_app_open', 'admin_install_metrics', 'push_device_platform')
  AND has_function_privilege('anon', p.oid, 'EXECUTE')
UNION ALL
SELECT 'admin_install_metrics without the admin check', ''
WHERE pg_get_functiondef('public.admin_install_metrics(int)'::regprocedure) NOT LIKE '%has_role(auth.uid(), ''admin'')%'
UNION ALL
SELECT 'record_app_open lets a demo user in', ''
WHERE pg_get_functiondef('public.record_app_open(text, boolean)'::regprocedure) NOT LIKE '%is_anon_user()%'
UNION ALL
SELECT 'SECURITY DEFINER without search_path', p.oid::regprocedure::text
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
  AND p.proname IN ('record_app_open', 'admin_install_metrics')
  AND NOT coalesce(p.proconfig, '{}') @> ARRAY['search_path=public, pg_temp'];
