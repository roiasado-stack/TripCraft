-- ============================================================================
-- TripCraft — migration 005
-- Adds pending_actions to trip_chat_messages: proposed tool calls
-- (add_to_itinerary / add_suggestion) from the Day 6-8 tool-use agent, shown
-- to the user as approval cards before anything is written. Safe to run more
-- than once.
-- ============================================================================

ALTER TABLE public.trip_chat_messages
  ADD COLUMN IF NOT EXISTS pending_actions JSONB NOT NULL DEFAULT '[]'::jsonb;
