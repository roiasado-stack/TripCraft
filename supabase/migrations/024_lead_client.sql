-- ============================================================================
-- 024 — The lead client manages who joins an agent's trip
--
-- On an agent's trip every traveller who opened the WhatsApp join link waited
-- in "pending" until the agent approved them — 40 approvals for a bar mitzvah.
-- Now the agent sends the client a PERSONAL link instead:
--
-- 1. trip_invites.grants_lead: a single-use participant link. Accepting it
--    makes the caller the trip's lead client (trip_members.is_lead) and
--    revokes the link in the same transaction.
--    - With lead_email (the client's address, typed by the agent): only an
--      account whose CONFIRMED email matches can accept; it joins active. Any
--      other account gets 'wrong_account' and the link is NOT used up.
--    - Without lead_email: the caller joins as a PENDING lead and the agent
--      approves that one person.
--    One lead per trip, pending or active. A second lead link is refused
--    ('lead_taken') rather than letting the caller in as a plain participant.
-- 2. The lead has a participant's rights on the trip — nothing more. On top,
--    through SECURITY DEFINER RPCs only (table RLS is not widened):
--    lead_group_link     the trip's live participant link (created without
--                        approval if there is none), to forward to the group
--    lead_rotate_group_link  revoke it and issue a new one
--    lead_set_member_status  approve or remove a viewer/participant who isn't
--                        the lead — never the owner, an editor or themselves
--    The lead also sees pending members ("members list").
-- 3. set_trip_lead (owner only) moves the lead mark to another member.
-- 4. trip_clients.client_email: the client's address, owner-only like the
--    phone (022). invite_preview shows it masked (da***@gmail.com) so the
--    wrong account knows which one to use.
--
-- Trips that never get a personal link behave exactly as before.
-- Idempotent. Paste into the SQL Editor after 023.
-- ============================================================================

-- Columns ------------------------------------------------------------------------
ALTER TABLE public.trip_members ADD COLUMN IF NOT EXISTS is_lead BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS trip_members_one_lead_idx
  ON public.trip_members (trip_id) WHERE is_lead AND status IN ('pending', 'active');

ALTER TABLE public.trip_invites ADD COLUMN IF NOT EXISTS grants_lead BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.trip_invites ADD COLUMN IF NOT EXISTS lead_email TEXT;
ALTER TABLE public.trip_invites DROP CONSTRAINT IF EXISTS trip_invites_lead_check;
ALTER TABLE public.trip_invites ADD CONSTRAINT trip_invites_lead_check CHECK (
  (NOT grants_lead AND lead_email IS NULL)
  OR (grants_lead AND role = 'participant' AND NOT requires_approval
      AND (lead_email IS NULL OR lead_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(lead_email) <= 254))
);
-- "One live link per role" (015) covers the regular links only; a trip has at
-- most one live personal link on top.
DROP INDEX IF EXISTS public.trip_invites_live_role_idx;
CREATE UNIQUE INDEX IF NOT EXISTS trip_invites_live_role_idx
  ON public.trip_invites (trip_id, role) WHERE revoked_at IS NULL AND NOT grants_lead;
CREATE UNIQUE INDEX IF NOT EXISTS trip_invites_live_lead_idx
  ON public.trip_invites (trip_id) WHERE revoked_at IS NULL AND grants_lead;

ALTER TABLE public.trip_clients ADD COLUMN IF NOT EXISTS client_email TEXT;
ALTER TABLE public.trip_clients DROP CONSTRAINT IF EXISTS trip_clients_email_check;
ALTER TABLE public.trip_clients ADD CONSTRAINT trip_clients_email_check
  CHECK (client_email IS NULL OR length(client_email) <= 254);

-- Who is the lead ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_trip_lead(_trip_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.trip_members m
                 WHERE m.trip_id = _trip_id AND m.user_id = auth.uid()
                   AND m.is_lead AND m.status = 'active')
         AND NOT public.is_anon_user()
$$;

-- The lead sees pending joiners too (only relevant if the owner turned approval back on).
DROP POLICY IF EXISTS "members list" ON public.trip_members;
CREATE POLICY "members list" ON public.trip_members FOR SELECT TO authenticated
  USING (public.owns_trip(trip_id) OR user_id = auth.uid()
         OR (status = 'active' AND public.can_view_trip(trip_id))
         OR public.is_trip_lead(trip_id));

-- The owner may now also move the lead mark (UPDATE stays owner-only by policy).
CREATE OR REPLACE FUNCTION public.guard_member_update()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.trip_id IS DISTINCT FROM OLD.trip_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.invite_id IS DISTINCT FROM OLD.invite_id THEN
    RAISE EXCEPTION 'only role, status and is_lead can change' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- Invite RPCs ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mask_email(_email TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN _email IS NULL OR position('@' IN _email) = 0 THEN NULL
    ELSE left(split_part(_email, '@', 1), 2) || '***@' || split_part(_email, '@', 2) END
$$;

-- Same as 015 plus whether the link makes you the lead, and for whom (masked).
CREATE OR REPLACE FUNCTION public.invite_preview(p_token TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'title', t.title, 'destination', t.destination, 'start_date', t.start_date,
    'end_date', t.end_date, 'cover_emoji', t.cover_emoji, 'role', i.role,
    'grants_lead', i.grants_lead, 'lead_email_hint', public.mask_email(i.lead_email)
  )
  FROM public.trip_invites i JOIN public.trips t ON t.id = i.trip_id
  WHERE i.token = p_token AND i.revoked_at IS NULL
$$;

CREATE OR REPLACE FUNCTION public.accept_trip_invite(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  inv public.trip_invites;
  existing public.trip_members;
  new_status TEXT;
  name TEXT;
  my_email TEXT;
  my_confirmed TIMESTAMPTZ;
  is_member BOOLEAN;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF public.is_anon_user() THEN RAISE EXCEPTION 'anonymous_not_allowed' USING ERRCODE = '42501'; END IF;

  -- Locked, so two people opening the same personal link can't both become the lead.
  SELECT * INTO inv FROM public.trip_invites WHERE token = p_token AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_invite' USING ERRCODE = 'P0002'; END IF;

  IF EXISTS (SELECT 1 FROM public.trips WHERE id = inv.trip_id AND user_id = uid) THEN
    RETURN jsonb_build_object('trip_id', inv.trip_id, 'status', 'owner');
  END IF;

  SELECT COALESCE(NULLIF(trim(p.full_name), ''), split_part(u.email, '@', 1)), u.email, u.email_confirmed_at
    INTO name, my_email, my_confirmed
    FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
   WHERE u.id = uid;

  SELECT * INTO existing FROM public.trip_members WHERE trip_id = inv.trip_id AND user_id = uid;
  is_member := FOUND;

  -- Regular link: unchanged from 015. An existing member keeps their role and status.
  IF NOT inv.grants_lead THEN
    IF is_member THEN
      RETURN jsonb_build_object('trip_id', inv.trip_id, 'status', existing.status);
    END IF;
    new_status := CASE WHEN inv.requires_approval THEN 'pending' ELSE 'active' END;
    INSERT INTO public.trip_members (trip_id, user_id, role, status, display_name, invite_id)
    VALUES (inv.trip_id, uid, inv.role, new_status, name, inv.id);
    RETURN jsonb_build_object('trip_id', inv.trip_id, 'status', new_status);
  END IF;

  -- Personal link --------------------------------------------------------------
  IF inv.lead_email IS NOT NULL
     AND (my_email IS NULL OR my_confirmed IS NULL OR lower(my_email) <> lower(inv.lead_email)) THEN
    -- Not used up: the right account can still open it.
    RAISE EXCEPTION 'wrong_account' USING ERRCODE = '42501';
  END IF;
  IF is_member AND existing.status = 'removed' THEN
    RETURN jsonb_build_object('trip_id', inv.trip_id, 'status', 'removed');
  END IF;
  IF EXISTS (SELECT 1 FROM public.trip_members m
             WHERE m.trip_id = inv.trip_id AND m.is_lead AND m.status IN ('pending', 'active')
               AND m.user_id <> uid) THEN
    RAISE EXCEPTION 'lead_taken' USING ERRCODE = '42501';
  END IF;

  -- Already on the trip without a verified email: nothing proves they are the
  -- client, and they can't be made to wait again. Left as is, link not used up;
  -- the owner can mark them lead by hand (set_trip_lead).
  IF is_member AND inv.lead_email IS NULL THEN
    RETURN jsonb_build_object('trip_id', inv.trip_id, 'status', existing.status);
  END IF;

  -- Verified by email → in at once. Otherwise the owner approves this one person.
  new_status := CASE WHEN inv.lead_email IS NOT NULL THEN 'active' ELSE 'pending' END;
  IF is_member THEN
    -- Already on the trip (e.g. joined through the group link first), email verified:
    -- mark as lead. An existing editor stays editor; a viewer becomes a participant.
    UPDATE public.trip_members
       SET is_lead = true, status = new_status,
           role = CASE WHEN role = 'editor' THEN 'editor' ELSE 'participant' END
     WHERE id = existing.id;
  ELSE
    INSERT INTO public.trip_members (trip_id, user_id, role, status, display_name, invite_id, is_lead)
    VALUES (inv.trip_id, uid, 'participant', new_status, name, inv.id, true);
  END IF;
  UPDATE public.trip_invites SET revoked_at = now() WHERE id = inv.id;
  RETURN jsonb_build_object('trip_id', inv.trip_id, 'status', new_status, 'lead', true);
END;
$$;

-- Lead RPCs ---------------------------------------------------------------------------
-- The group link the lead forwards: the trip's live participant link. Created
-- (no approval, on the owner's name) when there is none.
CREATE OR REPLACE FUNCTION public.lead_group_link(p_trip_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.trip_invites;
BEGIN
  IF NOT public.is_trip_lead(p_trip_id) THEN RAISE EXCEPTION 'not_lead' USING ERRCODE = '42501'; END IF;
  SELECT * INTO inv FROM public.trip_invites
   WHERE trip_id = p_trip_id AND role = 'participant' AND NOT grants_lead AND revoked_at IS NULL;
  IF NOT FOUND THEN
    INSERT INTO public.trip_invites (trip_id, role, requires_approval, created_by)
    SELECT p_trip_id, 'participant', false, t.user_id FROM public.trips t WHERE t.id = p_trip_id
    ON CONFLICT DO NOTHING;
    SELECT * INTO inv FROM public.trip_invites
     WHERE trip_id = p_trip_id AND role = 'participant' AND NOT grants_lead AND revoked_at IS NULL;
  END IF;
  RETURN jsonb_build_object('token', inv.token, 'requires_approval', inv.requires_approval);
END;
$$;

-- The link leaked: the old one stops working, people already in stay.
CREATE OR REPLACE FUNCTION public.lead_rotate_group_link(p_trip_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE approval BOOLEAN;
BEGIN
  IF NOT public.is_trip_lead(p_trip_id) THEN RAISE EXCEPTION 'not_lead' USING ERRCODE = '42501'; END IF;
  UPDATE public.trip_invites SET revoked_at = now()
   WHERE trip_id = p_trip_id AND role = 'participant' AND NOT grants_lead AND revoked_at IS NULL
  RETURNING requires_approval INTO approval;
  INSERT INTO public.trip_invites (trip_id, role, requires_approval, created_by)
  SELECT p_trip_id, 'participant', COALESCE(approval, false), t.user_id FROM public.trips t WHERE t.id = p_trip_id;
  RETURN public.lead_group_link(p_trip_id);
END;
$$;

-- Approve ('active') or remove ('removed') a viewer/participant. Never the
-- owner (not a member row), an editor, the lead, or someone already removed.
CREATE OR REPLACE FUNCTION public.lead_set_member_status(p_member_id UUID, p_status TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.trip_members;
BEGIN
  IF p_status NOT IN ('active', 'removed') THEN RAISE EXCEPTION 'bad_status' USING ERRCODE = '22023'; END IF;
  SELECT * INTO m FROM public.trip_members WHERE id = p_member_id;
  IF NOT FOUND OR NOT public.is_trip_lead(m.trip_id) THEN RAISE EXCEPTION 'not_lead' USING ERRCODE = '42501'; END IF;
  IF m.role NOT IN ('viewer', 'participant') OR m.is_lead OR m.status = 'removed'
     OR (p_status = 'active' AND m.status <> 'pending') THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  UPDATE public.trip_members SET status = p_status WHERE id = p_member_id;
  RETURN true;
END;
$$;

-- Owner only: make an active or pending member the lead (the old mark is cleared).
CREATE OR REPLACE FUNCTION public.set_trip_lead(p_member_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.trip_members;
BEGIN
  SELECT * INTO m FROM public.trip_members WHERE id = p_member_id;
  IF NOT FOUND OR NOT public.owns_trip(m.trip_id) OR public.is_anon_user() THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;
  IF m.status NOT IN ('pending', 'active') THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  UPDATE public.trip_members SET is_lead = false WHERE trip_id = m.trip_id AND is_lead AND id <> m.id;
  UPDATE public.trip_members
     SET is_lead = true, role = CASE WHEN role = 'editor' THEN 'editor' ELSE 'participant' END
   WHERE id = m.id;
  RETURN true;
END;
$$;

-- Grants ---------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.is_trip_lead(uuid), public.mask_email(text),
  public.lead_group_link(uuid), public.lead_rotate_group_link(uuid),
  public.lead_set_member_status(uuid, text), public.set_trip_lead(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_trip_lead(uuid),
  public.lead_group_link(uuid), public.lead_rotate_group_link(uuid),
  public.lead_set_member_status(uuid, text), public.set_trip_lead(uuid) TO authenticated;
-- invite_preview / accept_trip_invite keep their 015 grants (CREATE OR REPLACE keeps them).

-- Check: must return zero rows --------------------------------------------------------------
SELECT 'trip_members.is_lead missing' AS problem, '' AS detail, '' AS extra
WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'trip_members' AND column_name = 'is_lead')
UNION ALL
SELECT 'one-lead index missing', '', ''
WHERE NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'trip_members_one_lead_idx')
UNION ALL
SELECT 'live-role index still covers personal links', '', ''
WHERE NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'trip_invites_live_role_idx'
  AND indexdef LIKE '%grants_lead%')
UNION ALL
SELECT 'accept_trip_invite: personal link not single-use or not email-checked', '', ''
WHERE pg_get_functiondef('public.accept_trip_invite(text)'::regprocedure) NOT LIKE '%SET revoked_at = now()%'
   OR pg_get_functiondef('public.accept_trip_invite(text)'::regprocedure) NOT LIKE '%email_confirmed_at%'
UNION ALL
SELECT 'lead RPC callable by anon', p, ''
FROM unnest(ARRAY['public.lead_group_link(uuid)', 'public.lead_rotate_group_link(uuid)',
                  'public.lead_set_member_status(uuid, text)', 'public.set_trip_lead(uuid)',
                  'public.is_trip_lead(uuid)']) AS p
WHERE has_function_privilege('anon', p, 'EXECUTE')
UNION ALL
SELECT 'trip_clients.client_email readable beyond the owner', policyname, cmd
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trip_clients'
  AND coalesce(qual, '') NOT LIKE '%owns_trip%';
