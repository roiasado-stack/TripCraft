-- 026 — Web push notifications (phase 1: data + who gets a push)
--
-- A traveller who turns notifications on gets a push when someone else posts a
-- trip update, and a trip owner gets one when someone asks to join.
--
-- 1. push_subscriptions       one row per device (browser push endpoint + keys).
--                             Own rows only; a demo (anonymous) user can't add one.
--                             The endpoint must belong to a known push service
--                             (Google, Apple, Mozilla, Microsoft): notify POSTs to it
--                             with the server's VAPID key, so it must never be an
--                             arbitrary URL a user typed in.
-- 2. notification_settings    one row per user: trip_updates / join_requests (default on).
-- 3. trip_notification_mutes  mute one trip; only a trip the user can see.
-- 4. push_recipients_for_update(update_id) / push_recipients_for_join(member_id)
--                             who gets the push, decided here so test:db can prove it.
--                             service_role only — notify calls them; no client can.
--    update → the owner + active members, minus the author, minus anyone who
--             muted the trip or turned trip_updates off.
--    join   → the owner only (the row must still be 'pending'), unless they muted
--             the trip or turned join_requests off.
-- 5. Triggers: AFTER INSERT on trip_updates, and a trip_members row entering
--    'pending' (a join by an approval link, or a lead link re-joining) call the
--    notify Edge Function through pg_net, but only when someone would actually
--    get a push (a recipient with a subscription). The function URL and the
--    shared secret come from Vault ('notify_url', 'notify_secret'); without them
--    (a local DB, the tests) the trigger does nothing. It never fails the insert.
--
-- Apply: paste into the SQL Editor after 025. Then, once notify is deployed:
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/notify', 'notify_url');
--   select vault.create_secret('<random 32+ chars, same as the NOTIFY_SECRET function secret>', 'notify_secret');
-- Ends with the check query that must return zero rows.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 1. Devices -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE CHECK (
    length(endpoint) <= 1000
    AND endpoint ~ '^https://(fcm\.googleapis\.com|[a-z0-9.-]+\.push\.apple\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com)/'),
  p256dh TEXT NOT NULL CHECK (length(p256dh) BETWEEN 1 AND 200),
  auth TEXT NOT NULL CHECK (length(auth) BETWEEN 1 AND 100),
  user_agent TEXT CHECK (user_agent IS NULL OR length(user_agent) <= 400),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_ok_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON public.push_subscriptions (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;

DROP POLICY IF EXISTS "own subscriptions read" ON public.push_subscriptions;
DROP POLICY IF EXISTS "own subscriptions add" ON public.push_subscriptions;
DROP POLICY IF EXISTS "own subscriptions update" ON public.push_subscriptions;
DROP POLICY IF EXISTS "own subscriptions delete" ON public.push_subscriptions;
CREATE POLICY "own subscriptions read" ON public.push_subscriptions FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "own subscriptions add" ON public.push_subscriptions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND NOT public.is_anon_user());
CREATE POLICY "own subscriptions update" ON public.push_subscriptions FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid() AND NOT public.is_anon_user());
CREATE POLICY "own subscriptions delete" ON public.push_subscriptions FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- 2. Per-user settings ------------------------------------------------------------------
-- No row = both on.
CREATE TABLE IF NOT EXISTS public.notification_settings (
  user_id UUID PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_updates BOOLEAN NOT NULL DEFAULT true,
  join_requests BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_settings TO authenticated;
GRANT ALL ON public.notification_settings TO service_role;

DROP POLICY IF EXISTS "own settings" ON public.notification_settings;
CREATE POLICY "own settings" ON public.notification_settings FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 3. Muted trips -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trip_notification_mutes (
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, trip_id)
);
CREATE INDEX IF NOT EXISTS trip_notification_mutes_trip_idx ON public.trip_notification_mutes (trip_id);

ALTER TABLE public.trip_notification_mutes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trip_notification_mutes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.trip_notification_mutes TO authenticated;
GRANT ALL ON public.trip_notification_mutes TO service_role;

DROP POLICY IF EXISTS "own mutes read" ON public.trip_notification_mutes;
DROP POLICY IF EXISTS "own mutes add" ON public.trip_notification_mutes;
DROP POLICY IF EXISTS "own mutes delete" ON public.trip_notification_mutes;
CREATE POLICY "own mutes read" ON public.trip_notification_mutes FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "own mutes add" ON public.trip_notification_mutes FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_view_trip(trip_id));
CREATE POLICY "own mutes delete" ON public.trip_notification_mutes FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- 4. Who gets a push -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.push_recipients_for_update(p_update_id UUID)
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH u AS (
    SELECT trip_id, created_by FROM trip_updates WHERE id = p_update_id
  ), people AS (
    SELECT t.user_id FROM trips t JOIN u ON t.id = u.trip_id
    UNION
    SELECT m.user_id FROM trip_members m JOIN u ON m.trip_id = u.trip_id WHERE m.status = 'active'
  )
  SELECT p.user_id FROM people p CROSS JOIN u
  WHERE p.user_id IS DISTINCT FROM u.created_by
    AND NOT EXISTS (SELECT 1 FROM trip_notification_mutes x
                    WHERE x.user_id = p.user_id AND x.trip_id = u.trip_id)
    AND COALESCE((SELECT s.trip_updates FROM notification_settings s WHERE s.user_id = p.user_id), true)
$$;

CREATE OR REPLACE FUNCTION public.push_recipients_for_join(p_member_id UUID)
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.user_id
  FROM trip_members m JOIN trips t ON t.id = m.trip_id
  WHERE m.id = p_member_id AND m.status = 'pending'
    AND t.user_id IS DISTINCT FROM m.user_id
    AND NOT EXISTS (SELECT 1 FROM trip_notification_mutes x
                    WHERE x.user_id = t.user_id AND x.trip_id = t.id)
    AND COALESCE((SELECT s.join_requests FROM notification_settings s WHERE s.user_id = t.user_id), true)
$$;

-- 5. Queue a call to notify -------------------------------------------------------------------
-- Swallows every error: a push is never worth a failed insert.
CREATE OR REPLACE FUNCTION public.queue_push(p_type TEXT, p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_url TEXT; v_secret TEXT;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'notify_url';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'notify_secret';
  IF v_url IS NULL OR v_secret IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := v_url,
    body := jsonb_build_object('type', p_type, 'id', p_id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret),
    timeout_milliseconds := 5000);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'queue_push skipped: %', SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION public.push_on_trip_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.push_recipients_for_update(NEW.id) r(user_id)
             JOIN public.push_subscriptions s ON s.user_id = r.user_id) THEN
    PERFORM public.queue_push('update', NEW.id);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'push_on_trip_update skipped: %', SQLERRM;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trip_updates_push ON public.trip_updates;
CREATE TRIGGER trip_updates_push AFTER INSERT ON public.trip_updates
FOR EACH ROW EXECUTE FUNCTION public.push_on_trip_update();

-- A row entering 'pending': a new join by an approval link (accept_trip_invite)
-- or a lead link moving an existing row back to pending (024).
CREATE OR REPLACE FUNCTION public.push_on_member_pending()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status <> 'pending' OR (TG_OP = 'UPDATE' AND OLD.status = 'pending') THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.push_recipients_for_join(NEW.id) r(user_id)
             JOIN public.push_subscriptions s ON s.user_id = r.user_id) THEN
    PERFORM public.queue_push('join', NEW.id);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'push_on_member_pending skipped: %', SQLERRM;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trip_members_push ON public.trip_members;
CREATE TRIGGER trip_members_push AFTER INSERT OR UPDATE OF status ON public.trip_members
FOR EACH ROW EXECUTE FUNCTION public.push_on_member_pending();

-- Supabase grants EXECUTE on new public functions to anon and authenticated by
-- default; none of these is for a client.
REVOKE EXECUTE ON FUNCTION public.push_recipients_for_update(uuid), public.push_recipients_for_join(uuid),
  public.queue_push(text, uuid), public.push_on_trip_update(), public.push_on_member_pending()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_recipients_for_update(uuid), public.push_recipients_for_join(uuid)
  TO service_role;

-- Check: must return zero rows -----------------------------------------------------
SELECT 'RLS off' AS problem, c AS detail
FROM unnest(ARRAY['push_subscriptions', 'notification_settings', 'trip_notification_mutes']) AS c
WHERE NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || c)::regclass)
UNION ALL
SELECT 'policy', tablename || ': ' || policyname
FROM pg_policies WHERE schemaname = 'public' AND 'anon' = ANY (roles)
UNION ALL
SELECT 'anon grant', table_name || ': ' || privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'anon' AND table_schema = 'public'
UNION ALL
SELECT 'policy not own-rows', tablename || ': ' || policyname
FROM pg_policies WHERE schemaname = 'public'
  AND tablename IN ('push_subscriptions', 'notification_settings', 'trip_notification_mutes')
  AND coalesce(qual, with_check) NOT LIKE '%auth.uid()%'
UNION ALL
SELECT 'callable by a client', p.oid::regprocedure::text
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('push_recipients_for_update', 'push_recipients_for_join', 'queue_push',
                    'push_on_trip_update', 'push_on_member_pending')
  AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
UNION ALL
SELECT 'trigger missing', tg
FROM unnest(ARRAY['trip_updates_push', 'trip_members_push']) AS tg
WHERE NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = tg AND NOT tgisinternal);
