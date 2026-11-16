# What the ABADA email promises, plus the AI bugs found while building their demo (2026-11-15)

Branch: `feat/abada-promises` (from agent-chat 0a76fc9). Route: Straight. Phase 3 also has a debug part.

## Why
On 15.11 Roi sent ABADA Travels (a boutique agency) an email with these commitments:
- the "נבנה עם TripCraft" line is removed from agency pages;
- the WhatsApp link card shows the agency's name and logo;
- a trip can be exported as a PDF;
- the "family" assumption and the empty return day are fixed.

Building their 18-day Vietnam+Thailand demo in prod also showed that the AI itinerary fails on long trips.

## Non-goals
- Agency custom domain (a paid add-on, later).
- Recommendation library.
- Server-side PDF and offline/PWA.
- Flight time zones (naive durations, arrival date shown in UTC).
- Editing suggestions.
- Detecting a multi-country destination.

## Phase 1: agency share page carries only the agency's brand
- Remove the "נבנה עם TripCraft" line on agency pages (`SharePage.tsx`, `isAgencyPage` branch). The legal links stay. Non-agency pages keep the line.
- Add a link-preview (OG) card for `/share/:slug`:
  - a Vercel function behind a rewrite placed before the SPA catch-all;
  - it reads `get_shared_trip(slug)` with the publishable key;
  - it returns `index.html` with `<title>`, `og:title`, `og:description`, `og:image` and `og:site_name` injected, escaped;
  - the tag-building logic is a pure function in `src/lib/` with unit tests.
- No DB change. The function only reads what the public RPC already returns.

**Acceptance criteria**
1. On an agency share page (anonymous, 390px wide), no "TripCraft" text is visible apart from the legal links' page names.
2. A non-agency share page still shows "נבנה עם TripCraft".
3. `GET /share/<agency slug>` HTML contains `og:title` with the agency name and trip title, and `og:image` equal to the agency logo's public URL.
4. An unknown slug returns the plain `index.html` with status 200, and the SPA still shows its not-found state.
5. A trip title containing `"<&` is escaped.
6. The page still renders: same CSP, no console errors.

## Phase 2: PDF export (browser "Save as PDF")
- Add print styles (`@media print`) for the share page:
  - action buttons, map buttons and the bottom nav are hidden;
  - days and cards don't split across pages (`break-inside: avoid`);
  - light colours whatever the theme;
  - the agency header on top.
- A "שמירה כ-PDF" button on the share page calls `window.print()`, so the client can save it too.
- A "PDF ללקוח" action in the agency trip and send screens opens `/share/<slug>?print=1`, which prints once the trip has loaded.
- Google Places photos can't reach the print: the share page never shows them. Check this.

**Acceptance criteria**
1. Playwright `page.pdf()` of an agency share page (Hebrew) produces an RTL PDF with:
   - the agency header;
   - all flights, stays and every itinerary day;
   - no buttons or nav.
2. No day card splits across a page in the ABADA-like trip.
3. `?lang=en` prints in English.
4. `?print=1` opens the print dialog once, after the data has loaded, not on an empty page.

## Phase 3: the AI itinerary works on long trips, and the return day isn't empty
- **Debug:** reproduce the 546 on a local or dev 18-day trip, and record the latency per call.
- **Fix: generate in chunks.**
  - The client sends `days: [from, to]` windows of about 5 days, one call each, in order.
  - Each call already sees the items inserted before it, so nothing repeats.
  - The UI shows progress ("בונה ימים 6–10 מתוך 18").
  - When a chunk fails, the user gets a Hebrew error that says which days are missing. The days already saved stay.
- `generate` honours the window: `tripDays` is clipped to it. The existing per-agent cost caps are unchanged and are checked on every call.
- **Return day:** the departure-day rule asks for breakfast/check-out and a transfer to the airport, timed before the flight.

**Acceptance criteria**
1. Local stack with a real key: the ABADA-like trip (18 days, 5 stays, 7 flights) gets items on every day from 11.3 to 28.3 in one press, with no call over 100s.
2. 28.3 has check-out and an airport transfer ending at least 2–3h before the 14:00 flight.
3. With one failed chunk forced, a Hebrew toast names the missing days, and the other days are saved.
4. A 4-day trip still makes one call.
5. Unit tests cover the window split and the return-day prompt line.

## Phase 4: agency trips get the right trip type
- `AgentNewTripPage` no longer hard-codes `trip_type: "family"`.
  - **Default from the imported passengers:** any child or infant → family; exactly 2 adults → couple; else friends.
  - **Editable:** a Segmented control with the existing `TRIP_TYPES` on the review screen.
- `partyKind` already treats "couple" as adults-only.

**Acceptance criteria**
1. Importing a 2-adult booking creates a trip with `trip_type = couple`, and its AI itinerary contains no "משפחה" or "ילדים" wording.
2. A booking with a child creates `family`.
3. The agent can change the type before creating.
4. A unit test covers the derivation.

## Phase 5: flight time zones (added by Roi, 15.11)
Seen on the ABADA demo:
- **Durations ignore time zones.** TLV 22:40 → BKK 14:50 shows "16ש 10ד"; the real duration is about 11h10.
- **Arrival dates are shown in UTC.** LY84 lands in TLV on 29.3 at 00:05 and is shown as 28.3. This happens on the agency trip page and in the trip app's transport tab.
- **Editing a flight adds the duration naively.** In the flight edit form, a corrected duration makes the arrival 04:05.
- **Known earlier:** the share page showed WAW 21:40 as 22:40 to an Israeli viewer (memory, A.G.Y).

Goal: every flight time is the wall-clock time at its own airport, in every view and for every viewer's zone, and durations are real.
- Likely a Blueprint: each airport's time zone (IATA → IANA) and how times are stored. A migration may be needed; if so, write RLS tests per CLAUDE.md.
- The design goes to Roi before building.

**Acceptance criteria**
1. The 7 ABADA flights show the ticket times in every view: agency trip page, transport tab, share page.
2. The ABADA durations are right (±5 min of the real block time).
3. LY84 shows arrival 29.3 00:05.
4. The same trip viewed from a browser in another time zone (Playwright `timezoneId`) shows identical times.
5. Editing a flight keeps both local times correct.
6. Existing prod flights are not shifted. Write a migration or backfill plan, tested on a copy.

## Phase 6: edit a recommendation (added by Roi, 15.11)
Today a suggestion card offers only map, navigation and delete. Editors should also be able to edit the title, description, kind and tags, with the same `can(role, "edit")` gate and the RLS that already allows updates. Check this in `supabase/tests`. A changed title re-runs the photo lookup the same way manual add does.

**Acceptance criteria**
1. An editor or owner can edit a suggestion. The change shows in the app and on the share page.
2. A viewer or participant gets no edit control, and the RLS rejects the update. Prove both in `supabase/tests`.
3. Editing a demo (anonymous) trip behaves like other edits there.

## Production steps (Roi)
- Deploy `generate` (Phase 3).
- `vercel deploy --prod` from a release branch (Phases 1, 2, 4).
- Check that `VITE_SUPABASE_URL` and the publishable key are available to Vercel functions at runtime.
- Upgrade to Vercel Pro (approved #2). Hobby forbids commercial use, and functions are now part of the site.
- No migrations, so no `/privacy` change: the OG card shows only data that the share page already makes public.

## Order
- Phase 1 then Phase 2 (both touch `SharePage.tsx`).
- Phases 3 and 4 in parallel worktrees.
- Phase 5 needs a design approved by Roi first.
- Phases 3, 5 and 6 all touch `supabase/` (functions, migrations or tests), so they never run in parallel with each other.
- The promised items (1–4) come first, then 6, then 5.

## Customer service (support-manager, Noa)
- Open an ABADA customer file in `C:/Users/user/tripcraft-support/customers/` with:
  - the demo trip, its link and account;
  - the promises in the 15.11 email;
  - the known issues found while building.
- Add those issues to `known-issues.md`.
- When each promised item ships, draft the update to Haim (a draft only, Roi sends).
- Check the demo trip in prod (read only) after each release.
