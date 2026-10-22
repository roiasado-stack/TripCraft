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
--    claim_push_subscription  what the client calls to register a device: upserts by
--                             endpoint and hands it to the caller, so a phone shared
--                             by two accounts follows whoever turned pushes on last.
-- 2. notification_settings    one row per user: trip_updates / join_requests (default on).
-- 3. trip_notification_mutes  mute one trip; only a trip the user can see.
-- 4. push_recipients_for_update(update_id) / push_recipients_for_join(member_id)
--                             who gets the push, decided here so test:db can prove it.
--                             service_role only — notify calls them; no client can.
--    update → the owner + active members, minus the author, minus anyone who
--             muted the trip or turned trip_updates off.
--    join   → the owner only (the row must still be 'pending'), unless they muted
--             the trip or turned join_requests off.
-- 5. push_throttle            service-role-only "last sent" keys (push_throttle_claim):
--                             join:<trip>:<user>     one join push per person per trip per 24h
--                                                    (leave + re-join through an approval link
--                                                    would otherwise push the owner every time)
--                             update:<trip>:<author> one update push per author per trip per 60s
--                             test:<user>            notify's test push, one per 30s
--                             nonce:<uuid>           each signed call to notify works once
-- 6. Triggers: AFTER INSERT on trip_updates, and a trip_members row entering
--    'pending' (a join by an approval link, or a lead link re-joining) call the
--    notify Edge Function through pg_net, but only when someone would actually
--    get a push (a recipient with a subscription) and the throttle allows it.
--    The function URL and the signing secret come from Vault ('notify_url',
--    'notify_secret'); without them (a local DB, the tests) the trigger does
--    nothing. It never fails the insert.
--
-- Why the call is signed instead of carrying the secret: pg_net's install grants
-- anon/authenticated USAGE on schema net, SELECT on net.http_request_queue and
-- EXECUTE on net.http_post. Those grants are supabase_admin's, and a REVOKE run as
-- postgres (the SQL Editor) silently revokes nothing. So whatever is queued must
-- be safe to read: the body {type, id, ts, nonce} goes out with
-- x-notify-signature = HMAC-SHA256(body, secret). notify checks the HMAC, refuses
-- a ts more than 5 minutes off and burns the nonce, so a copied call can't be
-- replayed and the secret itself never leaves the database.
--
-- Apply: paste into the SQL Editor after 025. Then, once notify is deployed:
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/notify', 'notify_url');
--   select vault.create_secret('<random 32+ chars, same as the NOTIFY_SECRET function secret>', 'notify_secret');
-- Ends with the check query that must return zero rows.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

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

-- Register this device for the caller. A new endpoint, or the caller's own, is
-- written as given. Another account's endpoint moves to the caller only with the
-- same p256dh and auth (the same browser, now signed in as someone else);
-- otherwise 42501 'endpoint_taken' and the row is untouched. The endpoint CHECK
-- above still applies (23514). Returns the row id.
CREATE OR REPLACE FUNCTION public.claim_push_subscription(
  p_endpoint TEXT, p_p256dh TEXT, p_auth TEXT, p_user_agent TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE uid UUID := auth.uid(); sid UUID;
BEGIN
  IF uid IS NULL OR public.is_anon_user() THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.push_subscriptions AS s (user_id, endpoint, p256dh, auth, user_agent)
  VALUES (uid, p_endpoint, p_p256dh, p_auth, p_user_agent)
  ON CONFLICT (endpoint) DO UPDATE
    SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
        user_agent = EXCLUDED.user_agent, created_at = now(), last_ok_at = NULL
    -- Own device: keys may change. Someone else's: only the browser itself, which
    -- holds the same keys, can move it — knowing the endpoint URL isn't enough.
    WHERE s.user_id = EXCLUDED.user_id
       OR (s.p256dh = EXCLUDED.p256dh AND s.auth = EXCLUDED.auth)
  RETURNING s.id INTO sid;
  IF sid IS NULL THEN
    RAISE EXCEPTION 'endpoint_taken' USING ERRCODE = '42501';
  END IF;
  RETURN sid;
END;
$$;

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
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH u AS (
    SELECT trip_id, created_by FROM public.trip_updates WHERE id = p_update_id
  ), people AS (
    SELECT t.user_id FROM public.trips t JOIN u ON t.id = u.trip_id
    UNION
    SELECT m.user_id FROM public.trip_members m JOIN u ON m.trip_id = u.trip_id WHERE m.status = 'active'
  )
  SELECT p.user_id FROM people p CROSS JOIN u
  WHERE p.user_id IS DISTINCT FROM u.created_by
    AND NOT EXISTS (SELECT 1 FROM public.trip_notification_mutes x
                    WHERE x.user_id = p.user_id AND x.trip_id = u.trip_id)
    AND COALESCE((SELECT s.trip_updates FROM public.notification_settings s WHERE s.user_id = p.user_id), true)
$$;

CREATE OR REPLACE FUNCTION public.push_recipients_for_join(p_member_id UUID)
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.user_id
  FROM public.trip_members m JOIN public.trips t ON t.id = m.trip_id
  WHERE m.id = p_member_id AND m.status = 'pending'
    AND t.user_id IS DISTINCT FROM m.user_id
    AND NOT EXISTS (SELECT 1 FROM public.trip_notification_mutes x
                    WHERE x.user_id = t.user_id AND x.trip_id = t.id)
    AND COALESCE((SELECT s.join_requests FROM public.notification_settings s WHERE s.user_id = t.user_id), true)
$$;

-- 5. Throttle -------------------------------------------------------------------------------
-- No policies and no client grants: only the SECURITY DEFINER functions below and
-- service_role (notify) touch it.
CREATE TABLE IF NOT EXISTS public.push_throttle (
  key TEXT PRIMARY KEY CHECK (length(key) <= 200),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_throttle_sent_idx ON public.push_throttle (sent_at);
ALTER TABLE public.push_throttle ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_throttle FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.push_throttle TO service_role;

-- true = go ahead (the key is stamped now); false = already sent within p_window.
-- Keys older than 2 days are swept on every call, so windows stay under that.
CREATE OR REPLACE FUNCTION public.push_throttle_claim(p_key TEXT, p_window INTERVAL)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE claimed BOOLEAN;
BEGIN
  DELETE FROM public.push_throttle WHERE sent_at < now() - interval '2 days';
  INSERT INTO public.push_throttle AS t (key, sent_at) VALUES (p_key, now())
  ON CONFLICT (key) DO UPDATE SET sent_at = now() WHERE t.sent_at <= now() - p_window
  RETURNING true INTO claimed;
  RETURN COALESCE(claimed, false);
END;
$$;

-- 6. Queue a signed call to notify ------------------------------------------------------------
-- Not configured (no Vault secrets) → nothing, and the throttle key isn't stamped.
-- Throttled → nothing. Swallows every error (which also undoes the stamp): a push
-- is never worth a failed insert.
DROP FUNCTION IF EXISTS public.queue_push(text, uuid);
CREATE OR REPLACE FUNCTION public.queue_push(p_type TEXT, p_id UUID, p_throttle_key TEXT, p_window INTERVAL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_url TEXT; v_secret TEXT; v_body JSONB;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'notify_url';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'notify_secret';
  IF v_url IS NULL OR v_secret IS NULL THEN RETURN; END IF;
  IF NOT public.push_throttle_claim(p_throttle_key, p_window) THEN RETURN; END IF;
  v_body := jsonb_build_object('type', p_type, 'id', p_id,
    'ts', floor(extract(epoch FROM clock_timestamp()))::bigint, 'nonce', gen_random_uuid());
  -- pg_net sends the body as v_body::text, so that exact text is what gets signed.
  PERFORM net.http_post(
    url := v_url,
    body := v_body,
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-notify-signature', encode(extensions.hmac(v_body::text, v_secret, 'sha256'), 'hex')),
    timeout_milliseconds := 5000);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'queue_push skipped: %', SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION public.push_on_trip_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.push_recipients_for_update(NEW.id) r(user_id)
             JOIN public.push_subscriptions s ON s.user_id = r.user_id) THEN
    PERFORM public.queue_push('update', NEW.id,
      format('update:%s:%s', NEW.trip_id, coalesce(NEW.created_by::text, 'system')), interval '60 seconds');
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
-- or a lead link moving an existing row back to pending (024). Throttled by trip
-- and user, not row id: leaving deletes the row and a re-join makes a new one.
CREATE OR REPLACE FUNCTION public.push_on_member_pending()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status <> 'pending' OR (TG_OP = 'UPDATE' AND OLD.status = 'pending') THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.push_recipients_for_join(NEW.id) r(user_id)
             JOIN public.push_subscriptions s ON s.user_id = r.user_id) THEN
    PERFORM public.queue_push('join', NEW.id, format('join:%s:%s', NEW.trip_id, NEW.user_id), interval '24 hours');
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
-- default; only claim_push_subscription is for a client.
REVOKE EXECUTE ON FUNCTION public.push_recipients_for_update(uuid), public.push_recipients_for_join(uuid),
  public.queue_push(text, uuid, text, interval), public.push_on_trip_update(), public.push_on_member_pending(),
  public.push_throttle_claim(text, interval), public.claim_push_subscription(text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_recipients_for_update(uuid), public.push_recipients_for_join(uuid),
  public.push_throttle_claim(text, interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_push_subscription(text, text, text, text) TO authenticated;

-- Check: must return zero rows -----------------------------------------------------
SELECT 'RLS off' AS problem, c AS detail
FROM unnest(ARRAY['push_subscriptions', 'notification_settings', 'trip_notification_mutes', 'push_throttle']) AS c
WHERE NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || c)::regclass)
UNION ALL
SELECT 'policy', tablename || ': ' || policyname
FROM pg_policies WHERE schemaname = 'public' AND 'anon' = ANY (roles)
UNION ALL
SELECT 'anon grant', table_name || ': ' || privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'anon' AND table_schema = 'public'
UNION ALL
SELECT 'client grant on push_throttle', grantee || ': ' || privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'push_throttle' AND grantee IN ('anon', 'authenticated', 'PUBLIC')
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
                    'push_on_trip_update', 'push_on_member_pending', 'push_throttle_claim')
  AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
UNION ALL
SELECT 'claim_push_subscription callable by anon', p.oid::regprocedure::text
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'claim_push_subscription'
  AND has_function_privilege('anon', p.oid, 'EXECUTE')
UNION ALL
SELECT 'claim_push_subscription not callable by authenticated', ''
WHERE NOT has_function_privilege('authenticated', 'public.claim_push_subscription(text, text, text, text)', 'EXECUTE')
UNION ALL
SELECT 'claim_push_subscription takes over an endpoint without the keys', ''
WHERE pg_get_functiondef('public.claim_push_subscription(text, text, text, text)'::regprocedure) NOT LIKE '%endpoint_taken%'
UNION ALL
SELECT 'SECURITY DEFINER without search_path', p.oid::regprocedure::text
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
  AND p.proname IN ('push_recipients_for_update', 'push_recipients_for_join', 'queue_push', 'push_on_trip_update',
                    'push_on_member_pending', 'push_throttle_claim', 'claim_push_subscription')
  AND NOT coalesce(p.proconfig, '{}') @> ARRAY['search_path=public, pg_temp']
UNION ALL
-- net's grants to anon/authenticated can't be revoked as postgres (see the header),
-- so the queued call must never carry the secret: signed, not sent.
SELECT 'queue_push puts the secret in the queue', ''
WHERE pg_get_functiondef('public.queue_push(text, uuid, text, interval)'::regprocedure) NOT LIKE '%hmac(%'
   OR pg_get_functiondef('public.queue_push(text, uuid, text, interval)'::regprocedure) LIKE '%x-notify-secret%'
UNION ALL
SELECT 'trigger missing', tg
FROM unnest(ARRAY['trip_updates_push', 'trip_members_push']) AS tg
WHERE NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = tg AND NOT tgisinternal);
