---
title: Apple-style premium pilot — trips list + trip home, real flags
date: 2026-10-06
route: Straight (/ship)
status: approved by Roi 2026-10-06
---

# Apple-style premium pilot

## Goal

Make the two screens a user sees first feel calm, crafted and "Apple-like" on a phone, so Roi can judge
the direction before it spreads to the rest of the app:

1. **Trips list** (`/`, `TripsListPage` + `TripCard`)
2. **Trip home** (`/trip/:id`, `TripHeader` + `HomeTab` + the bottom nav in `TripLayout`)

…and make every country show a **real flag** on every device. Today flag emoji render as letters
("IT", "DE", "JP") wherever the OS has no flag glyphs — seen on Windows, and Roi reports it on his phone.

"Apple-like" here means the principles in the `apple-design` skill, applied with restraint:
hierarchy from type weight + size + spacing (not from more boxes), fewer and calmer surfaces, translucent
chrome over scrolling content, instant press feedback, motion only where it explains something, and
full support for reduced motion / larger text / dark mode.

## Non-goals

- Any screen other than the two above (itinerary, suggestions, share page, wizard…). They roll out later,
  after Roi approves the pilot.
- **Destination photo in the hero.** `trips.image_url` exists but nothing fills it; filling it means a new
  photo flow in `generate` + Wikimedia attribution in the hero. Worth doing, but it is its own decision.
- New fonts, a component library, or an animation library. CSS transitions/springs-by-curve only;
  Rubik/Heebo stay (CLAUDE.md).
- Any DB, RLS, Edge Function or `/privacy` change. Nothing new leaves the device.

## How every phase is verified (Roi's rule: phone first)

Each phase is done only when **all** of this passes, with screenshots in the phase report:

- **Mobile emulation** in the browser pane: `mobile` preset (touch + mobile UA) at 390px, and 320px.
- Light **and** dark mode; text at 150%; `prefers-reduced-motion: reduce`.
- The break-ui fixtures (Demo / Worst case / Empty / One / Huge) — no regression on any of them.
- **Real phone**: a LAN preview (Vite `--host` + local Supabase on the PC's Wi-Fi IP) that Roi opens on
  his own phone, with what to look at listed. Emulation is not called "verified on device" — only
  Roi's check is.
- Gates: `npm run check` green. No `supabase/` change, so no `test:db`.

## Phases

### Phase 0 — Branch + phone preview
- Branch `feat/premium-pilot` off `agent-chat`. First commit: the already-verified break-ui work
  (fixes 1–4, fixture SQL, seed script, dev toggle) — only those paths.
- Add launch config **`tripcraft-phone`**: Vite on `0.0.0.0:5175`, `--mode localstack`, with
  `VITE_SUPABASE_URL` pointed at the PC's LAN IP so a phone on the same Wi-Fi reaches local Supabase.
- **Acceptance:** from the PC, `http://<LAN-IP>:5175` loads and signs in with the local fixture account;
  Roi gets the URL + short instructions (Windows may ask once to allow Node through the firewall).

### Phase 1 — Real flags everywhere
- `country-flag-icons` (MIT; flag artwork is public domain), importing **only** the 52 countries in
  `DESTINATION_FLAGS` — bundled SVGs, no network request, nothing to add to `/privacy`.
- New `Flag` component in `src/components/` (rounded 3:2 flag tile, subtle inner border so white flags
  don't vanish). Falls back to `cover_emoji`, then 🌍, exactly like today.
- `destinationFlag` picks the country that appears **first in the user's text**
  (break-ui #9: "מילאנו … מינכן" → 🇮🇹, not 🇩🇪). Unit test in `trip-options.test.ts`.
- Used wherever the flag shows today: `TripCard`, `TripHeader`, `SharePage`, `JoinPage`, `WizardPage`
  (same function, so they change together; the share page's data is untouched).
- Credits line for the flag set on `/credits`.
- **Acceptance:** every one of the 52 destinations renders a real flag image (not letters) in the
  pane's mobile mode; the worst-case trip shows 🇮🇹; a destination with no match still shows its
  `cover_emoji`; the JS bundle grows by < 40 KB; Roi sees real flags on his phone.

### Phase 2 — Design foundation (additive, no existing token changes)
- In `src/styles.css`: a small type scale as utilities (large title / title / headline / body /
  footnote, each with its own tracking and leading — tight negative tracking on large text, ~0 on body),
  a `material` utility (translucent background + `backdrop-blur` + hairline edge) with
  `prefers-reduced-transparency` fallback, a `pressable` utility (scale .97 on press, 100 ms, ease-out;
  off under reduced motion), and a hairline-separator token.
- Existing tokens and other screens stay untouched — this phase changes nothing visible by itself.
- **Acceptance:** `npm run check` green; no screen other than a scratch check changes (before/after
  screenshot of the itinerary tab is identical).

### Phase 3 — Trips list
- iOS-style **large title** ("הטיולים שלי", greeting as a quieter subtitle) that the settings button
  aligns with; no emoji in headings.
- Trips grouped into **"עכשיו" / "בקרוב" / "עברו"** (undated trips under "בקרוב"), each group one inset
  list instead of a stack of shadowed cards: flag, title, destination · dates, and a single quiet
  countdown ("בעוד 12 ימים") instead of three colored badges.
- Delete moves off the card surface into a "⋯" menu on the row (destructive actions don't sit next to
  the primary tap target); confirmation dialog stays.
- "טיול חדש" becomes a calm primary button on a translucent bar, not a coral floating pill.
- Press feedback on every row; long titles clamp to 2 lines (break-ui rule).
- **Acceptance:** at 390 and 320 the list shows grouped sections with real flags; a trip with no dates
  appears under "בקרוב" with no countdown; the worst-case title wraps to 2 lines without overflow;
  delete is reachable via "⋯" and still asks to confirm; no horizontal scroll at 150% text; reduced
  motion removes the press scale.

### Phase 4 — Trip home
- Header: back · flag · title (2 lines max) · share — on a translucent material that content scrolls
  under, with a scroll-edge fade instead of a hard border.
- Hero: calm countdown in the large-title style; correct Hebrew counts ("מחר", "יום אחד", "יומיים",
  "עוד 3 ימים"); no emoji decorations.
- The three stat tiles become one inset grouped list (משתתפים / טיסות / ימים, with chevrons where
  tappable, singular/plural correct).
- Guide, updates, album, agent, flight, today, stays: same content, fewer boxes — grouped lists with
  hairline separators, consistent 16 px rhythm. Includes break-ui fixes 6–8, 10–13 on these screens
  (English titles `dir="auto"`, guide name wraps, email in update body wraps, flight card airports
  clamp without crushing the airline, pin aligns to the title's first line).
- Bottom nav: translucent material, active tab by weight + color only.
- **Acceptance:** all five fixture trips at 390 and 320, light + dark, 150% text: no horizontal scroll,
  nothing clipped, counts read correctly in Hebrew, the flight card's airline stays on ≤ 2 lines,
  `Lindt Home of Chocolate…` truncates at its end; content visibly scrolls under the header and nav.

## Roles touched
Owner, editor, participant, viewer see the same layout; edit controls stay gated by `can()` as today.
The anonymous demo banner in `TripLayout` stays visible above the new header.

## Changes outside the app
None. No migration, no Edge Function, no secret, no `/privacy` change. `/credits` gets one line.

## Decisions (Roi, 2026-10-06)
1. Delete moves into a "⋯" menu on the trips list — **yes**.
2. Hero destination photo — **separate follow-up plan**, not part of this pilot.
