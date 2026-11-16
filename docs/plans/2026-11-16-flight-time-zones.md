# Phase 5 design: flight time zones (for Roi's approval, 2026-11-16)

Part of `2026-11-15-abada-promises.md`. **Roi approved Design A on 2026-11-16.**

## Root causes (all four symptoms)
1. **Wrong durations.** Every writer reads the ticket's wall-clock time in the browser's zone (almost always Israel) and stores that instant. TLV 22:40 → BKK 14:50 becomes two Israel times, 16h10 apart; the real time is 11h10.
2. **LY84 shown on 28.3.** `formatHeb` (`src/lib/trip-options.ts:168`) → `parseLocalDate` takes the UTC date prefix of `2026-03-28T21:05:00+00:00`, while the time comes from `toLocaleTimeString` — so it shows 00:05 next to the wrong date. The agency trip page embeds `TransportTab`, so it shows the same bug.
3. **Edit gives 04:05.** `addDurationIso` (`TransportTab.tsx:61-91`) adds the duration to the departure read as Israel time.
4. **WAW 21:40 shown as 22:40.** That row is a true instant written from another zone; the row doesn't record which.

Also: airport fields are free text ("Hangzhou (HGH)"); the edit form forces TLV on one side (`TransportTab.tsx:330`), so editing a domestic leg such as BKK→CNX rewrites its origin to TLV. No IATA → zone data exists in the repo.

## Design A (recommended): the ticket's wall-clock time is the truth
- **Columns on `flights`.** `depart_local` and `arrive_local` are `timestamp without time zone`. `from_tz` and `to_tz` are IANA zone names: nullable, with a CHECK on the format.
- **Trigger.**
  - It keeps `depart_at` and `arrive_at` as true instants: `depart_local AT TIME ZONE coalesce(from_tz, 'Asia/Jerusalem')`.
  - Old clients that write only `depart_at` get `depart_local` derived in Jerusalem time. Cached bundles, the n8n reminder, `order("depart_at")` and the next-flight check all keep working.
- **Display.** Format `*_local` as a string, never through `Date`. The viewer's zone can't change it, and an unknown airport still shows the ticket time.
- **Duration.** `arrive_at − depart_at`, shown only when both zones are known; otherwise it is hidden.
- **Library.** A pure module in `supabase/functions/_shared/flight-time.ts`, shared with `src`. It holds:
  - `iataOf` (handles "Bangkok (BKK)" and נתב"ג);
  - `zoneOf`;
  - `wallToInstant` / `instantToWall` (Intl offsets);
  - `formatFlightClock` (he/en);
  - `flightMinutes`.
- **Zone data.**
  - About 4,000 scheduled-service airports grouped by zone, ~10 KB gzipped and lazy-loaded. Only writers need it, because the zone is stored on the row.
  - Source: mwgg/Airports (MIT) or OpenTravelData (CC BY 4.0). Check the licence and credit it on `/credits`. The generator script is committed with the data.
  - `/privacy` needs no change.

## Design B: true instants + zones only
Convert existing rows to true instants and add only `from_tz` and `to_tz`. Every reader formats with `timeZone: from_tz`.
- **Fewer columns,** but display depends on knowing the zone: an unknown airport falls back to guessing, which is the current bug.
- **Easy to break again:** any reader that forgets the zone regresses, and this family of bugs has already hit three times.
- **Silent corruption:** an old cached client writing a time without a zone corrupts the row.

## Migration and backfill (A)
- **Number:** the next free migration, after Phase 6.
- **Backfill:** `depart_local = depart_at AT TIME ZONE 'Asia/Jerusalem'`. This is exactly what an Israeli viewer sees today, so nothing visibly shifts (criterion 6).
- **Zones** for existing rows come from a VALUES list of the codes actually in prod. A read-only `SELECT DISTINCT` runs first.
- **Safety:** a backup table `(id, depart_at, arrive_at)`, BEGIN/COMMIT, and check queries that must return zero rows:
  - no `depart_at` row left without `depart_local`;
  - the brochure has no `booking_ref`.
- **Rows to review:** a read-only report of rows whose new duration is ≤0 or over 20h, or that were created before 30.9. Rows like the WAW one keep today's display and are fixed by id after Roi checks the voucher.
- **Prod-copy test:** load `id`, airports, times and `created_at` (no personal data) into a scratch table and run the backfill. Assert zero display differences.
- **RLS:** no change (new columns on an existing table). `clone_showcase_trip` copies columns generically.
- **`get_shared_trip`:** redefined to also return the local times and zones, with the same fields added to `SharedTripPayload`.
- **db tests** (`supabase/tests/13_flight_times.sql`):
  - the trigger computes TLV→BKK as 11:10;
  - an old-client write is handled;
  - an invalid zone is rejected;
  - the brochure carries the local times and no secrets;
  - a clone keeps the local times;
  - a participant can't update a flight.

## Sub-phases (each shippable)
- **5a — library and data.** Zone map, `flight-time.ts`, Vitest tests: DST edges, `iataOf` cases, LY84 at 29.3 00:05. No behaviour change.
- **5b — migration.** Columns, trigger, backfill, `get_shared_trip`, payload type, db tests, review report.
  - Deploy order: migration → functions → web.
- **5c — readers.**
  - TransportTab, which also fixes the agency page.
  - SharePage, which gains the arrival time.
  - HomeTab.
  - `formatHeb`.
  - The `ask` snapshot and `generate/bookings.ts`, with a multi-stop domestic-legs fixture.
- **5d — writers.**
  - The edit form: both airports editable and a correct arrival preview ("נחיתה 29.3 00:05 שעון TLV"). When a zone is unknown, it asks for the arrival time instead.
  - The scan prompt asks for IATA codes and the local time as printed.
  - The import paths.
  - Seeds.
  - The n8n reminder.

## Acceptance mapping
1. The ABADA copy shows the ticket times in every view; read-only prod check after release.
2. `flightMinutes` for the 7 legs is within ±5 min of block time.
3. LY84 shows "29.3 00:05".
4. Playwright MCP with `timezoneId` set to Jerusalem, Los Angeles and Bangkok gives identical text.
5. Form round-trip test, plus the trigger test.
6. The prod-copy test shows zero differences, plus the backup table and the report.
