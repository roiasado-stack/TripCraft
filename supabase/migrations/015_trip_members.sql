-- ============================================================================
-- 015 — Trip members, roles and invites
--
-- A trip can now be shared with people who log in: viewer (read-only),
-- participant (checklist, suggestion likes/adds, trip updates) and editor
-- (everything except delete / public sharing / members). Owners join nothing —
-- ownership stays trips.user_id. Every "owner all" policy is replaced by
-- per-operation policies built on trip_role().
--
-- Documents become per-document: "private" (uploader only, the default for
-- every existing row) or "members". Personal checklist items and AI chat stay
-- private to whoever created them.
--
-- Idempotent. Paste into the SQL Editor after 014.
-- ============================================================================

-- Anonymous (demo) sessions are `authenticated` too; this tells them apart.
CREATE OR REPLACE FUNCTION public.is_anon_user()
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false)
$$;

-- Tables -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trip_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'participant', 'editor')),
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  requires_approval BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL DEFAULT auth.uid(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One live link per role; revoking and creating again gives a fresh token.
CREATE UNIQUE INDEX IF NOT EXISTS trip_invites_live_role_idx
  ON public.trip_invites (trip_id, role) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.trip_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'participant', 'editor')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active')),
  -- Snapshot at join time: profiles stay owner-only (migration 013).
  display_name TEXT,
  invite_id UUID REFERENCES public.trip_invites(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trip_id, user_id)
);
CREATE INDEX IF NOT EXISTS trip_members_user_idx ON public.trip_members (user_id);

-- Roles ------------------------------------------------------------------------
-- 'owner' | 'editor' | 'participant' | 'viewer' | NULL. Pending members get NULL.
CREATE OR REPLACE FUNCTION public.trip_role(_trip_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.trips t WHERE t.id = _trip_id AND t.user_id = auth.uid()) THEN 'owner'
    ELSE (SELECT m.role FROM public.trip_members m
          WHERE m.trip_id = _trip_id AND m.user_id = auth.uid() AND m.status = 'active')
  END
$$;
CREATE OR REPLACE FUNCTION public.can_view_trip(_trip_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT public.trip_role(_trip_id) IS NOT NULL
$$;
CREATE OR REPLACE FUNCTION public.can_participate_trip(_trip_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT public.trip_role(_trip_id) IN ('owner', 'editor', 'participant')
$$;
CREATE OR REPLACE FUNCTION public.can_edit_trip(_trip_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT public.trip_role(_trip_id) IN ('owner', 'editor')
$$;

-- New columns + backfill (existing rows belong to the trip owner) ----------------
ALTER TABLE public.checklist_items ADD COLUMN IF NOT EXISTS created_by UUID DEFAULT auth.uid();
ALTER TABLE public.trip_updates ADD COLUMN IF NOT EXISTS created_by UUID DEFAULT auth.uid();
ALTER TABLE public.trip_chat_messages ADD COLUMN IF NOT EXISTS user_id UUID DEFAULT auth.uid();
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS uploaded_by UUID DEFAULT auth.uid();
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private';

UPDATE public.checklist_items c SET created_by = t.user_id FROM public.trips t WHERE c.trip_id = t.id AND c.created_by IS NULL;
UPDATE public.trip_updates u SET created_by = t.user_id FROM public.trips t WHERE u.trip_id = t.id AND u.created_by IS NULL;
UPDATE public.trip_chat_messages m SET user_id = t.user_id FROM public.trips t WHERE m.trip_id = t.id AND m.user_id IS NULL;
UPDATE public.documents d SET uploaded_by = t.user_id FROM public.trips t WHERE d.trip_id = t.id AND d.uploaded_by IS NULL;

ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_visibility_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_visibility_check CHECK (visibility IN ('private', 'members'));
-- A document row may only point at a file under its uploader's own folder.
-- Without this a member could insert a "members" row naming someone else's
-- file path and read it through the member storage policy below.
ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_path_owner_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_path_owner_check
  CHECK (storage_path IS NULL OR split_part(storage_path, '/', 1) = uploaded_by::text) NOT VALID;
CREATE INDEX IF NOT EXISTS documents_storage_path_idx ON public.documents (storage_path);

-- Policies: trips --------------------------------------------------------------
DROP POLICY IF EXISTS "own trips" ON public.trips;
DROP POLICY IF EXISTS "trips select" ON public.trips;
DROP POLICY IF EXISTS "trips insert" ON public.trips;
DROP POLICY IF EXISTS "trips update" ON public.trips;
DROP POLICY IF EXISTS "trips delete" ON public.trips;
CREATE POLICY "trips select" ON public.trips FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.can_view_trip(id));
CREATE POLICY "trips insert" ON public.trips FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "trips update" ON public.trips FOR UPDATE TO authenticated
  USING (public.can_edit_trip(id)) WITH CHECK (public.can_edit_trip(id));
CREATE POLICY "trips delete" ON public.trips FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Editors may edit trip details but not who owns it or whether it is public.
CREATE OR REPLACE FUNCTION public.guard_trip_update()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'trip owner cannot change' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NOT NULL AND OLD.user_id <> auth.uid()
     AND (NEW.is_shared IS DISTINCT FROM OLD.is_shared OR NEW.share_slug IS DISTINCT FROM OLD.share_slug) THEN
    RAISE EXCEPTION 'only the owner can change sharing' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trips_guard ON public.trips;
CREATE TRIGGER trips_guard BEFORE UPDATE ON public.trips FOR EACH ROW EXECUTE FUNCTION public.guard_trip_update();

-- Policies: editor-level content ---------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['participants','flights','stays','transfers','itinerary_items']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "owner all" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "members read" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "editors write" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "editors update" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "editors delete" ON public.%I', t);
    EXECUTE format('CREATE POLICY "members read" ON public.%I FOR SELECT TO authenticated USING (public.can_view_trip(trip_id))', t);
    EXECUTE format('CREATE POLICY "editors write" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_edit_trip(trip_id))', t);
    EXECUTE format('CREATE POLICY "editors update" ON public.%I FOR UPDATE TO authenticated USING (public.can_edit_trip(trip_id)) WITH CHECK (public.can_edit_trip(trip_id))', t);
    EXECUTE format('CREATE POLICY "editors delete" ON public.%I FOR DELETE TO authenticated USING (public.can_edit_trip(trip_id))', t);
  END LOOP;
END $$;

-- Policies: suggestions (participants add and like) ----------------------------
DROP POLICY IF EXISTS "owner all" ON public.suggestions;
DROP POLICY IF EXISTS "members read" ON public.suggestions;
DROP POLICY IF EXISTS "participants add" ON public.suggestions;
DROP POLICY IF EXISTS "participants update" ON public.suggestions;
DROP POLICY IF EXISTS "editors delete" ON public.suggestions;
CREATE POLICY "members read" ON public.suggestions FOR SELECT TO authenticated
  USING (public.can_view_trip(trip_id));
CREATE POLICY "participants add" ON public.suggestions FOR INSERT TO authenticated
  WITH CHECK (public.can_participate_trip(trip_id));
CREATE POLICY "participants update" ON public.suggestions FOR UPDATE TO authenticated
  USING (public.can_participate_trip(trip_id)) WITH CHECK (public.can_participate_trip(trip_id));
CREATE POLICY "editors delete" ON public.suggestions FOR DELETE TO authenticated
  USING (public.can_edit_trip(trip_id));

-- Participants may only toggle `liked`.
CREATE OR REPLACE FUNCTION public.guard_suggestion_update()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF public.trip_role(OLD.trip_id) = 'participant'
     AND (to_jsonb(NEW) - 'liked') IS DISTINCT FROM (to_jsonb(OLD) - 'liked') THEN
    RAISE EXCEPTION 'participants can only like suggestions' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS suggestions_guard ON public.suggestions;
CREATE TRIGGER suggestions_guard BEFORE UPDATE ON public.suggestions FOR EACH ROW EXECUTE FUNCTION public.guard_suggestion_update();

-- Policies: checklist (shared items for participants; personal items private) ----
DROP POLICY IF EXISTS "owner all" ON public.checklist_items;
DROP POLICY IF EXISTS "members read" ON public.checklist_items;
DROP POLICY IF EXISTS "participants add" ON public.checklist_items;
DROP POLICY IF EXISTS "participants update" ON public.checklist_items;
DROP POLICY IF EXISTS "participants delete" ON public.checklist_items;
CREATE POLICY "members read" ON public.checklist_items FOR SELECT TO authenticated
  USING (public.can_view_trip(trip_id) AND (is_shared OR created_by = auth.uid()));
CREATE POLICY "participants add" ON public.checklist_items FOR INSERT TO authenticated
  WITH CHECK (public.can_participate_trip(trip_id) AND created_by = auth.uid());
CREATE POLICY "participants update" ON public.checklist_items FOR UPDATE TO authenticated
  USING (public.can_participate_trip(trip_id) AND (is_shared OR created_by = auth.uid()))
  WITH CHECK (public.can_participate_trip(trip_id) AND (is_shared OR created_by = auth.uid()));
CREATE POLICY "participants delete" ON public.checklist_items FOR DELETE TO authenticated
  USING (public.can_participate_trip(trip_id) AND (is_shared OR created_by = auth.uid()));

-- Policies: trip updates (participants post; edit/delete only their own) -------
DROP POLICY IF EXISTS "owner all" ON public.trip_updates;
DROP POLICY IF EXISTS "members read" ON public.trip_updates;
DROP POLICY IF EXISTS "participants post" ON public.trip_updates;
DROP POLICY IF EXISTS "authors update" ON public.trip_updates;
DROP POLICY IF EXISTS "authors delete" ON public.trip_updates;
CREATE POLICY "members read" ON public.trip_updates FOR SELECT TO authenticated
  USING (public.can_view_trip(trip_id));
CREATE POLICY "participants post" ON public.trip_updates FOR INSERT TO authenticated
  WITH CHECK (public.can_participate_trip(trip_id) AND created_by = auth.uid());
CREATE POLICY "authors update" ON public.trip_updates FOR UPDATE TO authenticated
  USING (public.can_edit_trip(trip_id) OR (public.can_participate_trip(trip_id) AND created_by = auth.uid()))
  WITH CHECK (public.can_edit_trip(trip_id) OR (public.can_participate_trip(trip_id) AND created_by = auth.uid()));
CREATE POLICY "authors delete" ON public.trip_updates FOR DELETE TO authenticated
  USING (public.can_edit_trip(trip_id) OR (public.can_participate_trip(trip_id) AND created_by = auth.uid()));

-- Policies: documents ----------------------------------------------------------
DROP POLICY IF EXISTS "owner all" ON public.documents;
DROP POLICY IF EXISTS "members read" ON public.documents;
DROP POLICY IF EXISTS "participants upload" ON public.documents;
DROP POLICY IF EXISTS "uploader update" ON public.documents;
DROP POLICY IF EXISTS "uploader delete" ON public.documents;
CREATE POLICY "members read" ON public.documents FOR SELECT TO authenticated
  USING (public.can_view_trip(trip_id) AND (uploaded_by = auth.uid() OR visibility = 'members'));
CREATE POLICY "participants upload" ON public.documents FOR INSERT TO authenticated
  WITH CHECK (public.can_participate_trip(trip_id) AND uploaded_by = auth.uid());
CREATE POLICY "uploader update" ON public.documents FOR UPDATE TO authenticated
  USING (uploaded_by = auth.uid() AND public.can_participate_trip(trip_id))
  WITH CHECK (uploaded_by = auth.uid() AND public.can_participate_trip(trip_id));
CREATE POLICY "uploader delete" ON public.documents FOR DELETE TO authenticated
  USING (uploaded_by = auth.uid());

-- Policies: AI chat (each person's own conversation) -----------------------------
DROP POLICY IF EXISTS "owner all" ON public.trip_chat_messages;
DROP POLICY IF EXISTS "own chat read" ON public.trip_chat_messages;
DROP POLICY IF EXISTS "own chat write" ON public.trip_chat_messages;
DROP POLICY IF EXISTS "own chat delete" ON public.trip_chat_messages;
CREATE POLICY "own chat read" ON public.trip_chat_messages FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.can_participate_trip(trip_id));
CREATE POLICY "own chat write" ON public.trip_chat_messages FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_participate_trip(trip_id));
CREATE POLICY "own chat delete" ON public.trip_chat_messages FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Policies: members and invites ------------------------------------------------
GRANT SELECT, UPDATE, DELETE ON public.trip_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_invites TO authenticated;
GRANT ALL ON public.trip_members, public.trip_invites TO service_role;
REVOKE ALL ON public.trip_members, public.trip_invites FROM anon;
ALTER TABLE public.trip_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members list" ON public.trip_members;
DROP POLICY IF EXISTS "owner manages" ON public.trip_members;
DROP POLICY IF EXISTS "owner or self removes" ON public.trip_members;
-- Owner sees everyone incl. pending; a member sees active members and their own row.
CREATE POLICY "members list" ON public.trip_members FOR SELECT TO authenticated
  USING (public.owns_trip(trip_id) OR user_id = auth.uid()
         OR (status = 'active' AND public.can_view_trip(trip_id)));
CREATE POLICY "owner manages" ON public.trip_members FOR UPDATE TO authenticated
  USING (public.owns_trip(trip_id)) WITH CHECK (public.owns_trip(trip_id));
-- Owner removes anyone; a member can leave.
CREATE POLICY "owner or self removes" ON public.trip_members FOR DELETE TO authenticated
  USING (public.owns_trip(trip_id) OR user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.guard_member_update()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.trip_id IS DISTINCT FROM OLD.trip_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.invite_id IS DISTINCT FROM OLD.invite_id THEN
    RAISE EXCEPTION 'only role and status can change' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trip_members_guard ON public.trip_members;
CREATE TRIGGER trip_members_guard BEFORE UPDATE ON public.trip_members FOR EACH ROW EXECUTE FUNCTION public.guard_member_update();

DROP POLICY IF EXISTS "owner invites" ON public.trip_invites;
CREATE POLICY "owner invites" ON public.trip_invites FOR ALL TO authenticated
  USING (public.owns_trip(trip_id) AND NOT public.is_anon_user())
  WITH CHECK (public.owns_trip(trip_id) AND NOT public.is_anon_user() AND created_by = auth.uid());

-- Invite RPCs -------------------------------------------------------------------
-- What an invite link offers, shown before sign-in. Unknown/revoked → NULL.
CREATE OR REPLACE FUNCTION public.invite_preview(p_token TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'title', t.title, 'destination', t.destination, 'start_date', t.start_date,
    'end_date', t.end_date, 'cover_emoji', t.cover_emoji, 'role', i.role
  )
  FROM public.trip_invites i JOIN public.trips t ON t.id = i.trip_id
  WHERE i.token = p_token AND i.revoked_at IS NULL
$$;

-- Joins the caller. Idempotent: an existing member keeps their role and status,
-- so re-opening a link never changes a role — only the owner does that.
CREATE OR REPLACE FUNCTION public.accept_trip_invite(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  inv public.trip_invites;
  existing public.trip_members;
  new_status TEXT;
  name TEXT;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF public.is_anon_user() THEN RAISE EXCEPTION 'anonymous_not_allowed' USING ERRCODE = '42501'; END IF;

  SELECT * INTO inv FROM public.trip_invites WHERE token = p_token AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_invite' USING ERRCODE = 'P0002'; END IF;

  IF EXISTS (SELECT 1 FROM public.trips WHERE id = inv.trip_id AND user_id = uid) THEN
    RETURN jsonb_build_object('trip_id', inv.trip_id, 'status', 'owner');
  END IF;

  SELECT * INTO existing FROM public.trip_members WHERE trip_id = inv.trip_id AND user_id = uid;
  IF FOUND THEN
    RETURN jsonb_build_object('trip_id', inv.trip_id, 'status', existing.status);
  END IF;

  SELECT COALESCE(NULLIF(trim(p.full_name), ''), split_part(u.email, '@', 1))
    INTO name
    FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
   WHERE u.id = uid;
  new_status := CASE WHEN inv.requires_approval THEN 'pending' ELSE 'active' END;
  INSERT INTO public.trip_members (trip_id, user_id, role, status, display_name, invite_id)
  VALUES (inv.trip_id, uid, inv.role, new_status, name, inv.id);
  RETURN jsonb_build_object('trip_id', inv.trip_id, 'status', new_status);
END;
$$;

-- Storage: members read "members" documents -------------------------------------
-- A definer helper rather than an inline subquery, so the storage policy does
-- not depend on documents' own RLS.
CREATE OR REPLACE FUNCTION public.can_read_trip_doc(_object_name TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.storage_path = _object_name AND d.visibility = 'members' AND public.can_view_trip(d.trip_id)
  )
$$;
DROP POLICY IF EXISTS "member docs read" ON storage.objects;
CREATE POLICY "member docs read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'trip-docs' AND public.can_read_trip_doc(name));

-- Account deletion also removes what the caller left on other people's trips ---
CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  DELETE FROM public.trips WHERE user_id = uid;
  DELETE FROM public.trip_members WHERE user_id = uid;
  DELETE FROM public.documents WHERE uploaded_by = uid;
  DELETE FROM public.trip_chat_messages WHERE user_id = uid;
  DELETE FROM public.trip_updates WHERE created_by = uid;
  DELETE FROM public.checklist_items WHERE created_by = uid AND NOT is_shared;
  -- Shared checklist items they added stay on the trip, owned by its owner.
  UPDATE public.checklist_items c SET created_by = t.user_id
    FROM public.trips t WHERE c.trip_id = t.id AND c.created_by = uid;
  DELETE FROM public.agent_runs WHERE user_id = uid;
  DELETE FROM public.user_roles WHERE user_id = uid;
  DELETE FROM public.profiles WHERE id = uid;
  DELETE FROM auth.users WHERE id = uid;
END;
$$;

-- Function grants ----------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.trip_role(uuid), public.can_view_trip(uuid), public.can_participate_trip(uuid),
  public.can_edit_trip(uuid), public.accept_trip_invite(text), public.can_read_trip_doc(text),
  public.is_anon_user(), public.delete_my_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trip_role(uuid), public.can_view_trip(uuid), public.can_participate_trip(uuid),
  public.can_edit_trip(uuid), public.accept_trip_invite(text), public.can_read_trip_doc(text),
  public.is_anon_user(), public.delete_my_account() TO authenticated;
-- The one anon-callable function besides get_shared_trip: title/destination/role for a valid token only.
REVOKE EXECUTE ON FUNCTION public.invite_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invite_preview(text) TO anon, authenticated;

-- Check ------------------------------------------------------------------------
-- Should return ZERO rows: anything in public still open to anon.
SELECT 'policy' AS kind, tablename AS name, policyname AS detail
FROM pg_policies WHERE schemaname = 'public' AND 'anon' = ANY (roles)
UNION ALL
SELECT 'grant', table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'anon' AND table_schema = 'public';
