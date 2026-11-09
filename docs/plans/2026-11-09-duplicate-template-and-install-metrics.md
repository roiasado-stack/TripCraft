# Duplicate trip as a clean template (#47) + install / push metrics

2026-11-09 · Roi approved building both ("כן, תבנה"). Branch `fix/duplicate-template-and-install-metrics`.

## Goal
1. **#47 (privacy bug):** "שכפול הטיול כתבנית חדשה" (`HomeTab.tsx`, `duplicate`) copies the previous
   client's participants (with notes), flights and transfers with booking refs, seats and notes, the
   trip notes, and per-person checklist items, and keeps the old dates. An agent who duplicates a
   client's trip to build the next one carries client A's data into client B's trip.
2. **Metrics for the 31.3 app-store decision:** how many signed-in users open the app installed
   (home-screen / standalone) vs in a browser, and how many have push on, by platform (iOS / Android
   / desktop). Admin-only.

## Non-goals
- No change to the public share page, `get_shared_trip`, or the agency board.
- No metrics for anonymous brochure visitors (`/share/:slug`): that would need an `anon` write, which
  CLAUDE.md forbids. Stated as a limitation on the admin screen.
- No third-party analytics.

## Phase 1 — Duplicate = clean template (Debug route; no DB change)
Pure logic in `src/lib/trip-template.ts` (unit-tested), used by `HomeTab.duplicate`:

| Copied | Not copied |
|---|---|
| trip: title "(עותק)", destination, trip_type, budget_level, cover_emoji, image_url | trip **notes**, guide name/phone, share state |
| itinerary_items (all content, dates shifted) | **participants** (none) |
| stays: hotel, address, phone, url, map, dates shifted | stays **booking_ref, notes** |
| suggestions (liked reset) | **flights** (the client's booking) |
| checklist: shared items only, unticked | checklist items tied to a participant |
| | **transfers** (booking with times/refs) |

- Clicking the button opens a `Modal` asking for the new start date (default: empty → keeps the
  original dates). All dates move by the same number of days (`@/lib/trip-dates` only).
- The button shows only for `can(role, "edit")` (a viewer/participant can no longer clone a
  client's trip into their own account).
- Insert errors are checked (today they are silently ignored) → Hebrew toast on failure.

**Acceptance (verifier, local Supabase, phone width, as owner):**
1. A trip with 2 participants (with notes), a flight with booking ref, a stay with booking ref + notes,
   a transfer, 3 itinerary items on 2 days, one shared + one per-person checklist item, trip notes.
   Duplicate with a new start date 30 days later → new trip has: 0 participants, 0 flights,
   0 transfers, stay with empty booking ref and notes, 3 itinerary items each 30 days later, 1
   checklist item, empty notes; stay check-in/out and trip start/end 30 days later.
2. Duplicate with no date → same dates as the source.
3. As a viewer member the button is not shown.
4. The source trip is unchanged.
Unit tests: `trip-template.test.ts` (field stripping, date shift across month/year end, null dates).

## Phase 2 — Install / push metrics (Blueprint: new table + RPC + cron; DB change)
Migration `027_app_opens.sql`:
- `app_opens (user_id uuid default auth.uid(), day date, platform text check in ('ios','android','desktop','other'), standalone bool, primary key (user_id, day, standalone))`.
  RLS on; `authenticated` may INSERT own rows only (not anonymous demo users); no SELECT for anyone
  but through the RPC. No `anon` grant.
- `record_app_open(p_platform, p_standalone)` — SECURITY DEFINER, upsert-ignore, so one row per user
  per day per mode (no tracking beyond that: no pages, no times).
- `admin_install_metrics(p_days int default 30)` — admin only (`has_role(auth.uid(),'admin')`), returns
  per platform: users who opened, users who opened installed, % installed, users with ≥1 push
  subscription (platform from the endpoint host / user agent), % with push.
- pg_cron: delete rows older than 180 days.
- `supabase/tests/`: non-admin gets nothing from the RPC; a user can't insert for another user;
  anon can't call either; a demo user can't record.
Client: `src/lib/install-metrics.ts` (pure: platform from UA, standalone from `matchMedia` /
`navigator.standalone`) + one call after login in the app shell, at most once per day per mode
(localStorage guard). Admin section "התקנה והתראות" on `/admin/monitoring`.
`/privacy`: one line — we record, per day, whether you opened the app installed and on which
device type, kept 180 days.

**Acceptance:** as a signed-in user on phone width the RPC writes one row; reopening the same day
adds nothing; admin sees the counts; a non-admin calling the RPC gets an error; `npm run test:db` green.

## Production steps (Roi, after merge)
Paste `027_app_opens.sql` into the prod SQL Editor (ends with the zero-row check), then deploy the site.
Phase 1 alone needs no migration.
