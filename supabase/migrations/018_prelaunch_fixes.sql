-- ============================================================================
-- 018 — Three fixes from the feat/trip-members code review (PR #1)
--
-- 1. agent_runs "own insert" let any signed-in or anonymous user insert rows
--    with a made-up cost. One large row filled the $5/day app-wide AI cap and
--    switched AI off for everyone. Only the Edge Functions (service role) may
--    write usage rows now; generate/ask log through their admin client.
-- 2. delete_my_account() failed for anyone who had added a shared checklist
--    item on someone else's trip: it hands those items to the trip owner, and
--    guard_checklist_update rejected every change of created_by. Handing your
--    own item to the trip's owner is now allowed.
-- 3. Turning off sharing on a showcase trip raised 'a showcase must be
--    shared'. Unsharing now also clears is_showcase.
--
-- Idempotent. Paste into the SQL Editor after migrations 002–017.
-- ============================================================================

-- 1. agent_runs: server-side writes only ---------------------------------------
DROP POLICY IF EXISTS "own insert" ON public.agent_runs;
REVOKE INSERT, UPDATE, DELETE ON public.agent_runs FROM authenticated, anon;

-- 2. Checklist guard: an author may hand their own item to the trip owner ------
CREATE OR REPLACE FUNCTION public.guard_checklist_update()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.created_by IS DISTINCT FROM OLD.created_by AND auth.uid() IS NOT NULL
     AND NOT (OLD.created_by = auth.uid()
              AND NEW.created_by = (SELECT t.user_id FROM public.trips t WHERE t.id = NEW.trip_id)) THEN
    RAISE EXCEPTION 'checklist author cannot change' USING ERRCODE = '42501';
  END IF;
  IF NEW.is_shared IS DISTINCT FROM OLD.is_shared AND OLD.created_by IS DISTINCT FROM auth.uid()
     AND NOT public.can_edit_trip(OLD.trip_id) THEN
    RAISE EXCEPTION 'only the author can move this item' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Trip guard (replaces 016's): unsharing also ends the showcase ------------
CREATE OR REPLACE FUNCTION public.guard_trip_update()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'trip owner cannot change' USING ERRCODE = '42501';
    END IF;
    IF auth.uid() IS NOT NULL AND OLD.user_id <> auth.uid()
       AND (NEW.is_shared IS DISTINCT FROM OLD.is_shared
            OR NEW.share_slug IS DISTINCT FROM OLD.share_slug
            OR NEW.is_showcase IS DISTINCT FROM OLD.is_showcase) THEN
      RAISE EXCEPTION 'only the owner can change sharing' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- A showcase is a public trip; once the owner unshares it, it stops being one.
  IF NOT NEW.is_shared THEN
    NEW.is_showcase := false;
  END IF;
  IF public.is_anon_user() AND (NEW.is_shared OR NEW.is_showcase) THEN
    RAISE EXCEPTION 'demo trips cannot be shared' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' AND public.is_anon_user()
     AND (SELECT count(*) FROM public.trips WHERE user_id = auth.uid()) >= 3 THEN
    RAISE EXCEPTION 'demo trip limit reached' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- Check: must return zero rows ---------------------------------------------------
SELECT 'agent_runs still writable by ' || r AS problem
FROM unnest(ARRAY['authenticated', 'anon']) AS r
WHERE has_table_privilege(r, 'public.agent_runs', 'INSERT')
UNION ALL
SELECT 'policy still present: ' || policyname
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'agent_runs' AND policyname = 'own insert';
