# Transfers on the share page, at the voucher's time (#69)

Approved by Roi 2026-11-27. Source: `business/product/spirit-claims-audit-2026-12-02.md`, rows
"שעות העברה" (bug) and "העברות, סירות, מעבורות, מטוס ים" (missing from the page).

## What the code does today (confirmed)

- `get_shared_trip` (latest definition: 028; 029–031 only check it) returns flights, stays,
  itinerary, suggestions and updates. No `transfers`. A client never sees a transfer, boat or ferry.
- `transfers.pickup_at` / `return_at` are TIMESTAMPTZ. Every writer reads the typed or scanned wall
  clock in the **device's** zone and stores the instant (`TransportTab` `partsToIso`, `create-trip.ts`
  `new Date(..).toISOString()`, `DocumentsTab` `localToIso`, `ImportVoucher`'s car fields,
  `demo-trip.ts`). Every reader formats the instant in the **viewer's** zone
  (`formatDateTimeHeb`, and `new Date()` in the edit form). 14:00 saved in Israel shows 16:00 on a
  phone in the Seychelles.
- A scanned car/transfer voucher is always saved as `kind = 'car_rental'` (`trip-drafts.ts`,
  `DocumentsTab`), so a scanned ferry is labelled "רכב שכור".

## Goal

1. `/share/:slug` shows the trip's transfers (boats, ferries and seaplanes are transfers) in their
   own section, with only the fields the page renders.
2. A transfer time shows exactly as printed on the voucher (the local wall clock) for every viewer
   in any device zone, in the app and on the share page, wherever the agent typed it.

## Non-goals

- No new transfer kinds (boat / ferry / seaplane): they stay `transfer`, labelled "העברה".
- No zone column for transfers: nothing knows a transfer's zone (no airport code), and nothing
  needs a true instant — times are shown as wall clocks and only ordered. Flights' `from_tz`
  exists to compute durations; a transfer has none.
- No change to `ask`, `generate`, reminders, or anything else that doesn't read transfers.
- Transfers are not placed inside the itinerary's days; they get their own section.

## Design

### DB — migration 032_transfer_local_times.sql

- `transfers.pickup_local`, `transfers.return_local` TIMESTAMP (no zone): the voucher's wall clock.
- Trigger `transfers_local_times` (BEFORE INSERT OR UPDATE), the 028 logic with the zone fixed to
  `Asia/Jerusalem`: a written/changed local derives the instant (`local AT TIME ZONE
  'Asia/Jerusalem'`); otherwise a written/changed instant (an old cached client) derives the local
  in Israel time. The instant is now only an ordering key (`order("pickup_at")` keeps working).
- Backfill before the trigger exists: `pickup_local = pickup_at AT TIME ZONE 'Asia/Jerusalem'`
  (same for return). Instants are not touched.
- `get_shared_trip` = 028's definition plus `transfers`, ordered by pickup time:
  `id`, `kind` (normalised to `transfer` / `car_rental`), `provider` (dropped when it holds
  7+ digits in total or an "@"), `pickup_local`, `return_local` (car rentals only).
- Ends with the zero-rows check.

### Old rows (stated, not guessed)

Old rows were stored as "the wall clock read in the saving device's zone". The backfill reads
them back in Israel time:
- saved from a device on Israel time (the normal case — agents and travellers in Israel): the
  local is exactly what was typed or scanned, i.e. the voucher time. Nothing visibly moves for an
  Israeli viewer; a viewer abroad now sees the voucher time instead of a shifted one.
- saved from a device in another zone: the local is shifted by the difference between that zone
  and Israel on that date. The data can't tell these rows apart, so nothing guesses: the row shows
  the shifted time until someone re-saves it once in the transport tab.

### Privacy — which `transfers` columns reach the anonymous page

| column | public? | why |
|---|---|---|
| `kind` | yes, normalised | fixed vocabulary |
| `provider` | yes, as entered, unless it holds 7+ digits in total (any script, after NFKC so full-width forms count; counted so separators do not hide them) or an "@" | a company name ("Hertz", "Sun Boats"); the filter drops a typed-in driver mobile or email; the transport tab says the name appears on the public link |
| `pickup_local`, `return_local` | yes | the whole point; `return_local` only for car rentals |
| `pickup_location`, `dropoff_location` | **no** | free text; for a transfer from home to the airport it is the client's home address. Not clearly safe, so left out (one-line change in a later migration if Roi decides otherwise) |
| `phone` | no | can be a private driver's mobile |
| `url` | no | booking-management links often carry a token |
| `booking_ref`, `notes` | no | never public (CLAUDE.md) |
| `pickup_at`, `return_at` | no | the page renders the locals; instants add nothing |

No new category of personal data becomes public (a company name and a time). Both legal pages
list exactly what the public link shows, so that list gains "העברות (סוג, שעה ושם הספק כפי שהוזן…)" in
`/privacy` §4 and the terms §5 — the list stays accurate; nothing else in them changes.

### Client

- `src/lib/transfer-times.ts` (pure): `transferWall(local, instant)`, `transferStamp(local, instant,
  lang)`, `transferKind(kind)`, `scannedTransferKind(voucher)` (a voucher with a return time is a
  car rental, otherwise a transfer), `transferFormParts(local, instant)`, `joinTransferWall(...)`.
- Writers send `pickup_local` / `return_local` (wall clocks), never `pickup_at` / `return_at`:
  `TransportTab`, `create-trip.ts`, `DocumentsTab`, `demo-trip.ts`; `ImportVoucher`'s car fields
  keep a wall clock (`wall`) like flights.
- Readers show the local as a string: `TransportTab` list and edit form; `SharePage` new section
  "העברות" / "Transfers" (English in `@/lib/share-english`).
- `SharedTripPayload.transfers` (optional: an old payload lacks it), `Transfer.pickup_local` /
  `return_local`.

## Acceptance criteria (a verifier can check)

1. On local Supabase, a shared trip with a transfer "Sun Boats", 2027-03-12 14:00 shows it on
   `/share/:slug` under "העברות" with "12.3 14:00", and with `?lang=en` under "Transfers" with
   "12 Mar 14:00" — also with the browser/emulated zone set to `Indian/Mahe` and to
   `America/Los_Angeles`.
2. The share page never shows the transfer's pickup/drop-off place, phone, link, booking number or
   notes (SQL test: exact key set; no SECRET-* marker in the payload).
3. An unshared trip, a wrong slug and a short slug return NULL to anon (SQL test); anon still has no
   access to the `transfers` table.
4. In the transport tab, adding a transfer at 14:00 shows 14:00 in the list and in the edit form in
   any device zone, and saving it unchanged writes the same values back.
5. A scanned ferry voucher (no return time) is saved as a transfer, not a car rental.
6. Existing rows: after 032, `pickup_local` equals the Jerusalem wall clock of the stored instant
   (zero-rows check), instants unchanged.
7. `npm run check` and `npm run test:db` green.

## Deploy order

032 → web. A cached old bundle keeps writing `pickup_at` only; the trigger fills `pickup_local`
in Israel time, which is what that bundle showed an Israeli user.
