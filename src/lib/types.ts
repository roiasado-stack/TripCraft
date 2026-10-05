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
  guide_name: string | null;
  guide_phone: string | null;
  is_shared: boolean;
  share_slug: string | null;
  is_template: boolean;
  photos_album_url: string | null;
  image_url: string | null;
  /** Public page offers "try it yourself" (migration 016). Owner-only toggle. */
  is_showcase: boolean;
  /** Set on demo copies: the showcase this trip was cloned from. */
  demo_source_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Caller's relationship to a trip, from the trip_role() RPC (migration 015). */
export type TripRole = "owner" | "editor" | "participant" | "viewer";
export type MemberRole = Exclude<TripRole, "owner">;

export interface TripMember {
  id: string;
  trip_id: string;
  user_id: string;
  role: MemberRole;
  status: "pending" | "active" | "removed";
  display_name: string | null;
  created_at: string;
}

export interface TripInvite {
  id: string;
  trip_id: string;
  role: MemberRole;
  token: string;
  requires_approval: boolean;
  revoked_at: string | null;
  created_at: string;
}

export interface TripUpdate {
  id: string;
  trip_id: string;
  title: string;
  body: string | null;
  kind: string; // info | warning | urgent
  is_pinned: boolean;
  created_by?: string | null;
  created_at: string;
}

/**
 * What get_shared_trip(slug) returns (migration 013) — exactly the fields
 * /share/:slug renders. Anonymous visitors have no table access at all.
 */
export interface SharedTripPayload {
  trip: Pick<
    Trip,
    "id" | "title" | "destination" | "start_date" | "end_date" | "cover_emoji" | "guide_name" | "guide_phone" | "photos_album_url"
  > & { is_showcase?: boolean };
  agency: { name: string | null; color: string | null } | null;
  flights: Pick<Flight, "id" | "from_airport" | "to_airport" | "airline" | "flight_number" | "depart_at">[];
  stays: Pick<Stay, "id" | "hotel_name" | "address" | "check_in" | "check_out" | "map_url">[];
  itinerary: Pick<
    ItineraryItem,
    "id" | "day_date" | "start_time" | "title" | "description" | "category" | "location" | "map_url"
  >[];
  suggestions: Pick<Suggestion, "id" | "kind" | "title" | "description" | "location" | "map_url">[];
  updates: Omit<TripUpdate, "trip_id">[];
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
  image_url: string | null;
  lat: number | null;
  lng: number | null;
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
  image_url: string | null;
  /** Google place ID for a fresh venue photo ('' = looked up, no match). Migration 017. */
  google_place_id?: string | null;
  lat: number | null;
  lng: number | null;
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
  /** "private" = uploader only; "members" = everyone on the trip (migration 015). */
  visibility: "private" | "members";
  uploaded_by: string | null;
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
  created_by?: string | null;
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
  kind: string; // ask | generate_suggestions | generate_itinerary | generate_checklist | generate_passports | generate_voucher
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

/* ----------------------------- Kosher layer ------------------------------ */
// Shapes returned by the `ask` Edge Function's `kosher` request
// (supabase/functions/ask/kosher.ts). Three trust tiers: only "verified"
// may ever be presented as kosher.

export type KosherTier = "verified" | "unverified" | "none";

export interface KosherPlace {
  tier: "verified" | "unverified";
  name: string;
  kind: "restaurant" | "shop" | "synagogue" | "other";
  address: string | null;
  lat: number;
  lng: number;
  distance_km: number;
  source: "osm" | "google";
  source_label: string;
  source_url: string;
  checked_on: string | null;
  maps_url: string;
  osm_diet: "yes" | "only" | null;
}

export interface CuratedKosherItem {
  tier: "verified" | "unverified";
  title: string;
  content: string;
  category: string;
  source_url: string;
  source_verified_on: string;
  /** Ready-made Hebrew tier line, e.g. "מאומת · מקור: … · נבדק 09/2026". */
  label: string;
}

export interface ShabbatDay {
  date: string;
  /** Local "HH:MM" at the destination. */
  candles: string | null;
  havdalah: string | null;
  /** Hebrew yom tov name, if one falls on this date. */
  holiday: string | null;
  /** Shabbat or yom tov — restricted until havdalah. */
  restricted: boolean;
}

export interface ShabbatInfo {
  tzid: string | null;
  days: ShabbatDay[];
  source_label: string;
  source_url: string;
}

export interface KosherLookup {
  place: string;
  point: { lat: number; lng: number; label: string } | null;
  too_wide: boolean;
  curated: CuratedKosherItem[];
  places: KosherPlace[];
  synagogues: KosherPlace[];
  shabbat: ShabbatInfo | null;
  google: "used" | "no_key" | "cap" | "demo" | "failed" | "skipped";
  osm_failed: boolean;
  search_links: { kosher: string; chabad: string };
}
