# Combined booking scan: one file, several bookings (and price quotes)

Route: **Debug → Straight**. Approved by Roi 2026-11-01 (verification option: local functions serve).

## Why
An agency from the outreach campaign uploaded a real document to "יצירת טיול מהזמנות" and got
"לא זוהה — ידולג". The file was a booking-platform (NEXT reservations) "הצעת מחיר משולבת": two
flights and two hotels in one PDF, and a quote ("לא הוזמנו מקומות"), not a confirmation.

Root cause (code identical on `production` and `agent-chat`):
- `generate` kind `voucher` asked the model for ONE `doc_type` per file and said "not sure → unknown".
  A mixed file has no single type, and a quote "doesn't look like a booking confirmation" → `unknown`.
- `ImportBookings.scanOne` marked anything but flight/hotel/car as "unknown — skipped".

This is what agency documents look like, so it blocked the "upload what you already have" promise for
exactly the agents we pitch.

## Goal
One uploaded file can produce any mix of flights, hotels and cars, and price quotes / combined
itineraries are read like confirmations.

## Non-goals
- The single-voucher "add a document" flow in a trip (`ImportVoucher`) keeps reading `doc_type` / `data`.
- No train / activity / insurance booking types.
- No DB, RLS, share page or `/privacy` change (same data, same AI vendor, same caps).
- Merging the same hotel scanned from two different files (a quote + its voucher) — pre-existing
  behaviour; the agent removes the extra card in review. Possible follow-up.

## Phase 1: the scan reads every booking in a file
**Edge Function `generate` (kind `voucher`)**
- Prompt asks for `{"bookings":[…],"destination":…,"passengers":[…]}` and says quotes, itineraries and
  combined summaries count. The old single shape is still accepted as one booking.
- Response adds `items: [{doc_type, data}]` (every flight segment, hotel and car, through the existing
  sanitizers; caps: flights 8, hotels 8, cars 4).
- Backward compatible: `doc_type` / `data` / `segments` describe the first booking matching `body.hint`,
  else the first booking, so the function can be deployed before the frontend.

**Client**
- `src/lib/voucher-scan.ts` (pure, unit-tested): response → `{docType, data}[]` (falls back to the old
  shape) and the Hebrew summary ("זוהו: 2 טיסות ו-2 מלונות").
- `ImportBookings` uses it; a mixed file's destination ranks by its strongest booking (hotel).

**Acceptance criteria**
1. A combined quote (2 flights + 2 hotels) in "טיול חדש מהמסמכים" shows "זוהו: 2 טיסות ו-2 מלונות";
   review shows all four with the right numbers and dates; destination filled; the created trip has
   2 flights + 2 stays and the PDF once in documents.
2. Single-type files still scan as before.
3. `ImportVoucher` with hint "hotel" on the combined file gets a hotel.
4. Unit tests: new shape, old shape, mixed types, empty/unknown, summary text.
5. Phone width (375px): no overflow on the scan list and review.

Touches: Edge Function, frontend. No DB.

## Release (exception to the prod freeze, like PR #22)
1. PR into `agent-chat`.
2. Same commits cherry-picked onto a branch from `production`, PR into `production`.
3. Roi deploys `generate` to prod first (backward compatible), then the frontend from `production`, and tags.
