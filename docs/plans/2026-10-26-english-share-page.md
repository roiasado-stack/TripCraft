# English trip page for a demo — plan

26.10.2026 | Route: **Straight**. The direction is set, there is no new table, and the change is on one page.
Status: **waiting for Roi's approval.**

## Goal
Alejandro Esperanza is the owner of a large travel agency, and most of his clients aren't Jewish. He'll be
introduced through Roi's neighbour. Roi needs to send him a link to a client trip that reads entirely in
English and left to right: the same public trip page (`/share/:slug`) that Israeli agencies get today, with
a real English demo trip behind it.

## Non-goals
- The agent's side (board, document import, settings) stays in Hebrew. It's shown on a screen share or in a
  video with English subtitles.
- The full app (`/trip/...`) stays in Hebrew. The English page therefore doesn't show "try it yourself",
  because that button leads into the Hebrew app.
- No Spanish for now. The string table is built so Spanish can be added later as a third column.
- No kosher or Shabbat in the English demo. Positioning in Israel doesn't change.
- No AI generation in English. The demo content is written by hand.
- The legal pages stay in Hebrew. The links at the bottom of the English page get English labels and
  lead to the Hebrew pages.

## As built (phase 1)
There's no `he`/`en` table. The Hebrew stays inline, as CLAUDE.md requires. The English lives in
`src/lib/share-english.ts` (`SHARE_EN` and the English formatters). `SharePage` provides it through a
context (`useShareEnglish()` in `src/hooks/use-share-english.tsx`), and each component that renders on
the page uses `en?.x ?? "the Hebrew"`. In the rest of the app the context is null, so nothing there
changes.

## Exception to CLAUDE.md
CLAUDE.md says "No i18n layer". The exception: one string table, `src/lib/share-strings.ts`, with `he` and
`en`, used by the public trip page only. Roi approved it on 26.10. A line goes into CLAUDE.md under
"Language and layout" so that nobody spreads it to other screens without a decision.

## Decisions for Roi (my recommendation first)
1. **How a link becomes English.** **`?lang=en` on the link.** There's no database change and no
   migration, and every existing trip can open in English. The alternative is a `language` column on the
   trip plus a change to `get_shared_trip`, which means a migration in production. That's worth doing only
   once there's a real agency in English.
2. **Where it runs, since production is frozen.** **Cherry-pick only this page onto `production`.** It's a
   frontend-only change: without `?lang=en` the page is identical to today's. The alternative is a Vercel
   preview address, which needs separate settings to work against the production database and doesn't look
   like a real product.
3. **The demo trip.** **Rome, 5 days, a family of 4, from the "TripCraft" demo agency** (Tripcraft26). This
   is the English twin of the Hebrew demo that has already been sent. The alternative is a destination or
   agency name that suits him better, once the neighbour tells us where he works. Don't use the name of his
   real agency without his permission.

## Phase 1: the trip page in English (`?lang=en`)
What changes:
- New file `src/lib/share-strings.ts`: the page's strings in `he`/`en`, plus formatters for dates, day
  names and times in English (`en-GB`), and English labels for itinerary categories and suggestion kinds.
  It has a unit test (`share-strings.test.ts`): every key exists in both languages, and the English dates
  come out right for a local calendar day (the `trip-dates` rule).
- `SharePage.tsx` reads `?lang=en`:
  - The wrapper gets `lang="en" dir="ltr"`. `document.documentElement` gets them too while the page is
    open, so toasts and overlays follow, and they're restored on leaving the page.
  - Every string on the page comes from the table, including loading, "trip not available", the agency
    header, the hero, the sections and the footer.
  - "Try it yourself" is hidden.
- The shared components get an optional `lang` prop, used only in their read-only state on this page:
  `GuideCard`, `MapLink`, `TripUpdates` (`editable={false}`), `PhotoAlbumCard` (`editable={false}`),
  `ImageCredit` and `LegalLinks`. Their behaviour inside the app doesn't change.
- `CLAUDE.md`: a line about the exception.

Acceptance (verifier, anonymous visitor, phone width 375, light and dark):
- `/share/<slug>?lang=en` on a trip with English content has no Hebrew letters anywhere outside the trip's
  own content. That covers headings, dates, labels, buttons, tooltips (`aria-label`) and the footer. It's
  checked by scanning the page text and the `aria-label` attributes.
- The page runs left to right: the agency stripe is on the left, the map buttons are on the right, and
  the flight route reads correctly.
- Dates look like "Mon 9 Nov" / "9 Nov 2026", and "5 days" appears in the hero.
- There's no "Try it yourself" button, even on a showcase trip.
- Without `?lang=en` the page is identical to today's: the Hebrew Rome demo looks the same, and the
  try-it button works.
- Going from the English page to `/terms` brings `dir` back to `rtl`.
- No horizontal scroll at 375 pixels, and no errors in the console.

Touches: the public share page only (anonymous visitors). Database: no. Edge Functions: no.
`/privacy`: no (no new data and no new third party).

## Phase 2: an English demo trip
- `scripts/demo-trip-en.sql`: a SQL script that creates the trip under the account of a given email (an
  active agent), shares it, and prints the link. Roi runs it in production the same way he runs migrations.
  The content:
  - Rome, 5 days, a family of 4.
  - Two flights (TLV↔FCO is the default, or a city that suits him).
  - One hotel.
  - Itinerary: 3–4 items a day with real locations, so the map buttons work.
  - 6 suggestions (attractions, restaurants, tips).
  - One pinned update ("Meeting point for the Vatican tour moved to 8:30").
  - A Wikimedia photo of Rome and the 🇮🇹 flag.
  - No kosher content and no Shabbat times.
- If the script runs again, it deletes the previous copy (identified by the title) and creates it fresh,
  so there are never two copies.
- First on the local database, then on TripCraft-dev. Production is for Roi to run.

Acceptance:
- The script runs twice in a row on a local database. There's exactly one trip, and the link opens.
- `/share/<slug>?lang=en` for that trip passes everything in phase 1, at phone width.
- The trip's text has no Hebrew, and has no "kosher" or "Shabbat".

Touches: database data only, with no schema change. The script inserts rows as the agent, so `created_by`
and `user_id` belong to the agent.

## Checks
- `npm run check` after every phase. `npm run test:db` doesn't apply, because `supabase/` doesn't change.
- Phase 1: reviewer and verifier. Security isn't needed (no RPC or RLS change), but the reviewer checks
  that `?lang` doesn't reach anything except the choice of strings.
- Final review, then a PR to `agent-chat`. A separate cherry-pick onto `production` happens only with
  Roi's OK.

## What Roi does in production (after the merge)
1. Cherry-pick phase 1 onto `production` and deploy (as in the README).
2. Run `scripts/demo-trip-en.sql` in the SQL Editor with Tripcraft26@gmail.com, and copy the link it prints.
3. Send Alejandro `<link>?lang=en`, and update the link in the English one-pager.

Estimate: phase 1 is about a day, and phase 2 is half a day.
