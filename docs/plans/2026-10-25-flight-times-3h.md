# Scanned flights 3 hours off: what is left

Date: 2026-10-25 · Route: Debug · Status: **awaiting Roi's approval**

## Diagnosis (with evidence)

- **The root cause is already fixed in code and in production.** A scanned voucher returns local
  wall-clock time with no zone (`"2026-10-04T07:40:00"`). Before 2026-09-29 the client sent that string
  as-is, Postgres (`TIMESTAMPTZ`, session in UTC) read it as UTC, and an Israeli browser showed the
  flight 3 hours late. Commit `78b64dd` (2026-09-29) converts it from local time first. It is an
  ancestor of `production` and `agent-chat` (`git merge-base --is-ancestor`).
- **Every insert path today converts from local time:** `create-trip.ts` (wizard and agency import),
  `DocumentsTab.localToIso` (scan inside a trip, flights and car rentals), and `TransportTab.partsToIso`
  (manual entry). No server code inserts flights or transfers.
- **What is still wrong:**
  1. **Old data.** Flights and car rentals scanned in production **before 29.9** were saved 3 hours late
     and were never corrected. This is probably what was seen in production.
  2. **The AI agent (`ask`).** `buildSnapshot` (`supabase/functions/ask/prompt.ts:167`) passes the agent
     the raw `depart_at` in UTC (`…T04:40:00+00:00`). So when asked "מתי הטיסה?" the agent may say a
     time that is 3 hours early. This was a consciously deferred item.

## Plan

### Phase 1: the agent's times (code)
- The client sends the browser's time zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) in the
  `ask` request. `buildSnapshot` formats `depart_at` in that zone (`he-IL`, date + HH:MM), with
  `Asia/Jerusalem` as the fallback for a missing or invalid value. The agent then sees exactly what
  the app shows.
- Unit test for the formatting in `buildSnapshot`, including summer and winter time, an invalid
  zone → fallback, and a null `depart_at`.
- Acceptance criteria: the test fails before the fix and passes after it. `npm run check` is green.
  On TripCraft-dev, after deploying `ask`, the snapshot shows 07:40 for a flight saved as 07:40
  local. Requires an Edge Function deploy to dev. Dev has no ANTHROPIC key, so the check is on the
  snapshot text, not on the agent's reply.

### Phase 2: fixing old data in production (Roi only, after a SELECT check)
- A read-only query listing flights (and car rentals) created before the fix was deployed, with the
  trip name, flight number and saved time.
- **Roi** checks against the vouchers and decides which ones to move by −3h (or −2h for winter
  dates). The fix itself is an UPDATE script by row id that Roi runs in the SQL Editor. No migration,
  no automatic correction: without the voucher there is no way to tell a scanned row from a
  manually entered one.

## Not in scope
- Storing the airport's time zone (a correct time for a viewer abroad). Today everything is
  displayed in the viewer's browser time zone, which is fine for the Israeli audience. That is a
  bigger change, part of "flying tomorrow" (notifications phase 2).

## Does it touch
DB: no (phase 2 is a manual production data fix) · Edge Functions: `ask` · public share page: no ·
`/privacy`: no (the time zone isn't personal data and isn't stored).
