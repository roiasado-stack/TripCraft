---
title: Destination photo on the trip screen + suggestions redesign
date: 2026-10-07
route: Straight (/ship)
status: approved by Roi 2026-10-07 (all four phases, order 1→2→3→4)
---

# Destination photo + suggestions redesign

## Goal

Give every trip a face, and bring the suggestions screen up to the premium pilot (PR #6):

1. The trip screen's hero shows a real photo of the destination (Wikipedia, credited), with the
   blue gradient as the fallback.
2. Suggestions read as a calm, photo-led screen instead of three rows of controls and cards with
   five actions each.
3. Photos are photos: no museum logos, flags, maps or coats of arms (today "Galleria Borghese"
   shows its logo).

Mockup of (1) was shown to Roi on 2026-10-07 (Trevi Fountain behind "בעוד 39 ימים").

## Non-goals

- Photos on the trips list rows — the flag stays (Roi approved it in the pilot).
- Itinerary, transport and the other tabs (still palette-only).
- New photo sources. Wikipedia (already used by `generate`) stays the only one for the hero; the
  existing Google Places path for suggestions is untouched.

## How every phase is verified (Roi's rule: phone first)

Mobile emulation (375 / 320, light + dark, 150% text) on the break-ui fixtures; `npm run check`
(including the new contrast and local-date rules); Roi checks on his phone via the LAN preview
(`tripcraft-phone`). Phases that touch `supabase/` also run `npm run test:db` and `eng-security`.

## Phases

### Phase 1 — Photos are photos (server + client)
- `generate`'s `wikipediaPhoto` rejects page images that aren't photographs: rendered SVGs
  (`….svg.png`) and file names with logo / emblem / coat of arms / seal / flag / map / locator —
  for new lookups **and** for cached hits, so a bad cached URL is dropped.
- Client guard `isPhotoUrl()` in `src/lib` (unit-tested), used by `MediaCard`, so rows that
  already store a logo fall back to the gradient/ambience photo without a data migration.
- **Acceptance:** the Borghese fixture shows the fallback, not the logo; unit tests for the URL
  classifier (photo, SVG render, logo, flag, map); Colosseum/Trevi/Pantheon still show.
- **Production:** deploy the `generate` function.

### Phase 2 — Destination photo in the trip hero
- `trips.image_url` (exists, unused) is filled lazily: when someone who can edit opens a trip with
  no photo, the app asks `generate` (kind `"photo"`, the destination text) once and saves the URL.
  Viewers and anonymous demo visitors never trigger a lookup (the demo clone already copies the
  source trip's photo). A miss stays null → today's gradient.
- Hero: the photo full-bleed, a dark bottom overlay strong enough that white text is ≥ 4.5:1 even
  over a pure-white pixel (provable from the overlay values, checked in the contrast rule), and the
  ⓘ credit link to the file's Wikimedia page (author + licence), like every other photo.
- **Acceptance:** Demo (Rome) shows a Rome photo with a working credit link; Empty (unknown
  destination) keeps the gradient; text over the photo measured ≥ 4.5:1; one lookup per trip
  (second open makes no request); a viewer opening an un-photographed trip makes no request.
- **Production:** none beyond phase 1's function (writes go through existing RLS: editors can
  update their trip).

### Phase 3 — The photo on the public share page (optional — Roi decides)
- Migration `021`: `get_shared_trip` also returns the trip's `image_url`; `SharedTripPayload`
  gets the field; the share page hero uses the same photo + credit.
- `supabase/tests`: anonymous visitor gets `image_url` for a shared trip and still nothing for an
  unshared one. `eng-security` review (public, anonymous page).
- **Production:** Roi pastes migration 021 in the SQL Editor, then the site deploy.

### Phase 4 — Suggestions screen redesign
- Header: title + one "+" that opens every way to add (manual / AI / import), a small list ↔ map
  toggle; one horizontally scrolling filter row (הכל · אטרקציות · מסעדות · טיפים · ציוד · ♥)
  instead of two rows.
- Cards with a photo: the photo fills the card with the title over its bottom (App Store "Today"
  style), a heart on the photo, one "למסלול" button; map / navigate / delete move behind "⋯"
  (same pattern as the trips list).
- Tips and gear (no photo): a grouped list, not big image-less cards. Restaurants keep their
  ambience photo, still labelled illustrative.
- **Acceptance:** the Demo fixture at 375 and 320, light + dark, 150% text — no horizontal
  scroll, every action reachable, delete still asks to confirm, long English titles truncate at
  their end, filters and map toggle work; contrast rule green.

## Roles touched
Owner/editor trigger the hero photo lookup; participant/viewer only see it. Suggestion actions
stay gated by `can()` as today.

## Changes outside the app
Phase 1: deploy `generate`. Phase 3 (if approved): migration 021, then the site. Every phase: the
site deploy. No new third party — Wikipedia and Wikimedia are already used and listed on
/privacy and /credits.

## Decisions (Roi, 2026-10-07)
1. Phase 3 is in: the photo also appears on the public share page (migration 021).
2. Order 1 → 2 → 3 → 4, each checked on the phone.
