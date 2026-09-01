-- ============================================================================
-- TripCraft — migration 003
-- Conversation history for the trip agent (questions + recommendations).
-- Safe to run more than once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.trip_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  role TEXT NOT NULL,                                -- user | assistant
  content TEXT NOT NULL,
  cards JSONB NOT NULL DEFAULT '[]'::jsonb,          -- AgentCard[] the client can add
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- NOTE: deliberately NOT part of the child-table loop in schema.sql.
-- The agent is owner-only: no GRANT to anon and no "shared read" policy, so a
-- trip owner's conversation never surfaces on /share/:slug. Don't "fix" this by
-- adding the table to the shared-read FOREACH array.
GRANT SELECT, INSERT, DELETE ON public.trip_chat_messages TO authenticated;
GRANT ALL ON public.trip_chat_messages TO service_role;

ALTER TABLE public.trip_chat_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owner all" ON public.trip_chat_messages;
CREATE POLICY "owner all" ON public.trip_chat_messages FOR ALL TO authenticated
USING (public.owns_trip(trip_id)) WITH CHECK (public.owns_trip(trip_id));

CREATE INDEX IF NOT EXISTS trip_chat_messages_trip_idx
  ON public.trip_chat_messages (trip_id, created_at);
