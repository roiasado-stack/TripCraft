-- Database-wide rules from CLAUDE.md: every table has RLS, nothing is open to
-- anon, and AI spend is only written server-side. A new table or migration
-- that breaks one of these fails here before it reaches production.

SELECT pg_temp.check('every public table has RLS enabled: ' || COALESCE(
  (SELECT string_agg(relname, ', ') FROM pg_class
    WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND NOT relrowsecurity), 'all'),
  NOT EXISTS (SELECT 1 FROM pg_class
    WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND NOT relrowsecurity));

-- A policy without TO applies to {public}, which includes anon.
SELECT pg_temp.check('no policy applies to anon or public: ' || COALESCE(
  (SELECT string_agg(tablename || '.' || policyname, ', ') FROM pg_policies
    WHERE schemaname = 'public' AND roles && ARRAY['anon', 'public']::name[]), 'none'),
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND roles && ARRAY['anon', 'public']::name[]));

SELECT pg_temp.check('no table grant to anon: ' || COALESCE(
  (SELECT string_agg(DISTINCT table_name, ', ') FROM information_schema.role_table_grants
    WHERE grantee = 'anon' AND table_schema = 'public'), 'none'),
  NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
    WHERE grantee = 'anon' AND table_schema = 'public'));

-- owns_trip is the one known extra: it only answers "does auth.uid() own this
-- trip", which is always false without a login, so it reveals nothing.
SELECT pg_temp.check('anon may call only get_shared_trip and invite_preview: ' || COALESCE(
  (SELECT string_agg(p.proname, ', ') FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND p.proname NOT IN ('get_shared_trip', 'invite_preview', 'owns_trip')), 'ok'),
  NOT EXISTS (SELECT 1 FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND p.proname NOT IN ('get_shared_trip', 'invite_preview', 'owns_trip')));

SELECT pg_temp.check('every SECURITY DEFINER function pins search_path: ' || COALESCE(
  (SELECT string_agg(proname, ', ') FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND prosecdef
      AND NOT EXISTS (SELECT 1 FROM unnest(proconfig) c WHERE c LIKE 'search_path=%')), 'ok'),
  NOT EXISTS (SELECT 1 FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND prosecdef
      AND NOT EXISTS (SELECT 1 FROM unnest(proconfig) c WHERE c LIKE 'search_path=%')));

-- agent_runs is excluded: it is a spend log read by user_id/created_at, never by trip.
SELECT pg_temp.check('trip child tables index trip_id: ' || COALESCE(
  (SELECT string_agg(c.relname, ', ') FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname <> 'agent_runs'
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'trip_id' AND NOT a.attisdropped)
      AND NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
                      WHERE i.indrelid = c.oid AND a.attname = 'trip_id')), 'ok'),
  NOT EXISTS (SELECT 1 FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname <> 'agent_runs'
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'trip_id' AND NOT a.attisdropped)
      AND NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
                      WHERE i.indrelid = c.oid AND a.attname = 'trip_id')));

SELECT pg_temp.check('agent_runs is not writable by authenticated or anon',
  NOT has_table_privilege('authenticated', 'public.agent_runs', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.agent_runs', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.agent_runs', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.agent_runs', 'INSERT'));

SELECT pg_temp.check('roles live in user_roles, not on profiles',
  NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name IN ('role', 'is_admin')));
