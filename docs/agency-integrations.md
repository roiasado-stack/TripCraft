# Connecting an agency's own system

Status (2026-10-20): **groundwork only**. No external system is connected yet. This page says where a
connection plugs in, so the first one doesn't have to restructure the agent workspace.

## What exists

- **One import shape:** `BookingImport` in `src/lib/agency-import.ts`. It holds the client, the trip
  (title, destination, dates), travellers, flights, stays, transfers, `source`, and `externalRef` (the
  agency's own booking/file number).
- **One writer:** `createImportedTrip` in `src/lib/create-trip.ts`. It inserts the trip and its
  bookings (through `insertTripWithDrafts`), then the owner-only `trip_clients` row with `source` and
  `external_ref`.
- **One source so far:** `documentsSource`, the document scan on `/agency/new`. It turns the
  `ImportBookings` results into a `BookingImport` and drops bookings that came in twice
  (`dedupeBookings`).
- **The data** (migration 025):
  - `trip_clients.source` is `'manual'` or `'documents'`. It has a CHECK, mirrored by `IMPORT_SOURCES`.
  - `trip_clients.external_ref` is free text, at most 80 characters. The agent types it on the trip
    screen, and the board shows it and searches it.
  - Both columns are owner-only (`owns_trip`) and never reach `get_shared_trip`.
  - `supabase/tests/08_trip_source.sql` covers who can see them.

## Adding a source (e.g. a booking system or CRM)

1. **Migration.** Add the new value to the `trip_clients_source_check` CHECK, and add it to
   `IMPORT_SOURCES` and `IMPORT_SOURCE_LABEL` in the same change. If the system needs its own
   credentials per agency, store them in a new service-role-only table keyed by `agent_accounts.user_id`:
   - Turn RLS on and add no policies.
   - Run `REVOKE ALL … FROM PUBLIC, anon, authenticated`.
   - Encrypt secrets at rest (Supabase Vault, or a hash where only comparison is needed).
   - Never put credentials on `profiles`, and never send them to the browser.
2. **Mapping.** Write an `ImportSource<TheirPayload>` whose `toImport` maps their booking into a
   `BookingImport`, with `externalRef` set to their booking number. Put it in `src/lib` as pure
   functions with unit tests, like `documentsSource`.
3. **Transport.** Two shapes fit how the app works today:
   - **Pull, from the browser.** The agent presses "ייבוא מהמערכת" and an Edge Function, using the
     stored credentials, fetches the booking and returns their payload. The page maps it and calls
     `createImportedTrip` as the agent. RLS stays the authority, and nothing new writes with the
     service role. The function must:
     - Verify the caller's JWT, the agent role and `agent_accounts.status = 'active'`.
     - Read only the caller's own credentials row.
     - Never return the credentials.
     - If an agency can configure the upstream URL, fetch only hosts on an allowlist (SSRF).
   - **Push, from their system.** A webhook Edge Function authenticates the agency, maps the payload,
     and writes on that agent's behalf. Because it uses the service role, where RLS doesn't apply and
     `auth.uid()` is NULL, it must:
     - Check an HMAC signature of the body, including a timestamp so a replayed call is refused.
       Compare in constant time against the agency's stored secret.
     - Take the agent's identity only from the matched secret, never from the payload.
     - Re-check that `agent_accounts.status = 'active'`.
     - Set `trips.user_id`, plus every author column (`created_by`, `uploaded_by`, `user_id`), to that
       agent explicitly.
     - Store documents under `trip-docs/<agent uid>/…`.
     - Re-check the agent's limits (`agent_limits`, the trip-limit trigger).
4. **Matching.** Before creating, look up `trip_clients.external_ref` among that agent's trips only.
   - Under the service role, the lookup must join `trips` and filter `trips.user_id = <agent>`.
     Otherwise two agencies' colliding booking numbers would let one update the other's trip.
   - If the number is already there, update that trip instead of creating a second one.
   - Uniqueness per agent can't be an index on `trip_clients` as it is, because the table has no owner
     column. The first push source adds either a denormalised owner column kept in sync by trigger, or a
     uniqueness check in a trigger.
5. **Privacy.** A new flow to or from a third party means updating `/privacy` (`LegalPages.tsx`) in
   the same change.

## Out of scope until a real agency asks

- Two-way sync, meaning writing back to their system.
- Bulk import of past trips.
- Mapping their client records into accounts.
