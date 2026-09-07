/**
 * Hand-written types for the TripCraft Supabase schema.
 * Mirrors supabase/migrations. Kept intentionally lightweight.
 */

export type AppRole = "admin" | "agent" | "traveler";

export interface Profile {
  id: string;
  full_name: string | null;
  agency_name: string | null;
  agency_logo_url: string | null;
  agency_color: string | null;
  created_at: string;
  updated_at: string;
}

export interface Trip {
  id: string;
  user_id: string;
  title: string;
  destination: string;
  start_date: string | null;
  end_date: string | null;
  trip_type: string;
  budget_level: string | null;
  notes: string | null;
  cover_emoji: string | null;
  is_shared: boolean;
  share_slug: string | null;
  is_template: boolean;
  photos_album_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface TripUpdate {
  id: string;
  trip_id: string;
  title: string;
  body: string | null;
  kind: string; // info | warning | urgent
  is_pinned: boolean;
  created_at: string;
}

export interface Participant {
  id: string;
  trip_id: string;
  name: string;
  age: number | null;
  age_range: string | null;
  preferences: string[];
  notes: string | null;
  created_at: string;
}

export interface Flight {
  id: string;
  trip_id: string;
  direction: string; // outbound | inbound
  airline: string | null;
  flight_number: string | null;
  from_airport: string | null;
  to_airport: string | null;
  depart_at: string | null;
  arrive_at: string | null;
  booking_ref: string | null;
  from_terminal: string | null;
  to_terminal: string | null;
  seats: string | null;
  baggage: string | null;
  notes: string | null;
  created_at: string;
}

export interface Stay {
  id: string;
  trip_id: string;
  hotel_name: string;
  address: string | null;
  check_in: string | null;
  check_out: string | null;
  booking_ref: string | null;
  notes: string | null;
  phone: string | null;
  url: string | null;
  map_url: string | null;
  created_at: string;
}

export interface Transfer {
  id: string;
  trip_id: string;
  kind: string; // transfer | car_rental
  provider: string | null;
  pickup_location: string | null;
  dropoff_location: string | null;
  pickup_at: string | null;
  return_at: string | null;
  booking_ref: string | null;
  notes: string | null;
  phone: string | null;
  url: string | null;
  created_at: string;
}

export interface ItineraryItem {
  id: string;
  trip_id: string;
  day_date: string;
  start_time: string | null;
  title: string;
  description: string | null;
  category: string;
  location: string | null;
  map_url: string | null;
  sort_order: number;
  created_at: string;
}

export interface Suggestion {
  id: string;
  trip_id: string;
  kind: string; // attraction | restaurant | tip | gear
  title: string;
  description: string | null;
  tags: string[];
  age_min: number | null;
  age_max: number | null;
  price_level: string | null;
  liked: boolean;
  location: string | null;
  map_url: string | null;
  created_at: string;
}

export interface DocumentRow {
  id: string;
  trip_id: string;
  participant_id: string | null;
  category: string;
  name: string;
  storage_path: string | null;
  external_url: string | null;
  created_at: string;
}

export interface ChecklistItem {
  id: string;
  trip_id: string;
  participant_id: string | null;
  title: string;
  is_done: boolean;
  is_shared: boolean;
  sort_order: number;
  created_at: string;
}

export interface UserRole {
  id: string;
  user_id: string;
  role: AppRole;
  created_at: string;
}

export interface UserRoleRow {
  role: AppRole;
}

/** One recommendation the agent returned, which the user can add to the trip. */
export interface AgentCard {
  kind: string; // attraction | restaurant | tip | gear
  title: string;
  description: string | null;
  tags: string[];
  price_level: string | null;
  location: string | null;
}

/** One logged call to the `ask` or `generate` Edge Functions — Monitoring only, admin-read-only. */
export interface AgentRun {
  id: string;
  trip_id: string | null;
  user_id: string;
  kind: string; // ask | generate_suggestions | generate_itinerary | generate_checklist | generate_passports
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number;
  status: string; // ok | error
  error_message: string | null;
  created_at: string;
}

/** One row from `stale_knowledge_chunks()` — a curated fact overdue for
 *  re-verification. Admin-read-only, same as AgentRun. */
export interface StaleKnowledgeChunk {
  id: string;
  destination: string;
  category: string;
  title: string;
  source_url: string;
  source_verified_on: string;
  days_stale: number;
}

/** A tool call the agent proposed but did not execute — shown as an approval
 *  card; the actual write only happens if the user confirms it. */
export interface PendingAction {
  tool: "add_to_itinerary" | "add_suggestion";
  id: string;
  input: Record<string, unknown>;
}

export interface TripChatMessage {
  id: string;
  trip_id: string;
  role: string; // user | assistant
  content: string;
  cards: AgentCard[]; // legacy — pre-tool-use messages only
  pending_actions: PendingAction[];
  created_at: string;
}
