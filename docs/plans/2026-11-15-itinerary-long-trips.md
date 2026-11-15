# Long trips: plan the AI itinerary in parallel chunks

2026-11-15 · Route: **Straight** (direction set by the A.G.Y pilot bug; no DB change).
Branch `feat/itinerary-long-trips`, based on `fix/domestic-flights-itinerary-days` (PR #42 — must
merge first; this PR goes into `agent-chat` after it).

## Why
`generate` (kind `itinerary`) asks the model for every empty day in ONE call. Measured 2026-11-15 on
local Supabase with the real model: a fresh 18-day multi-stop Thailand trip took **128 s** and
**13,665 output tokens**. Production runs on the Supabase Free plan (**150 s** wall clock per Edge
Function call) and `MAX_TOKENS` is 16,000 (thinking counts). So a trip of ~21+ days times out or
comes back as cut-off JSON → zero items, and the agent sees the app "stuck". The pilot agencies
build long Asia trips, so this is the next likely failure.

## Goal
One press of "מסלול מוצע עם AI" plans a 21-day (up to 35-day) trip in well under 150 s, every day
gets items, and a failure in one part never loses the rest.

## Non-goals
- No change for short trips: ≤ 7 days to plan → the same single call with a byte-identical prompt.
- No change to suggestions / checklist / scans, the model, effort, `MAX_TOKENS`, or streaming.
- No progress UI: still one request behind the existing spinner.
- No salvage of a cut-off JSON reply (chunks keep each call far below the cap instead).
- No DB / RLS change, no share-page or `/privacy` change (same data, same third party).

## Design
**Days to plan** — unchanged rule, moved to a pure helper `itineraryScope(days, existingDays)`:
the empty days, or "add 2-5 items" when every day already has items (that mode stays one call).

**Chunks** — `planItineraryChunks(planDays, breakDays, { maxDays: 7, maxChunks: 5 })`, pure:
1. Cut the days at hotel changes (`moveDays` on the stays). A change that falls on an already-planned
   day moves the cut to the next day being planned.
2. A stay longer than 7 days is split into balanced parts (15 → 5/5/5).
3. Neighbouring parts are packed together up to 7 days (fewest calls; a city is never split by this).
4. At most 5 chunks per press (35 days). Days beyond that are not planned in this press and are
   reported as missing — pressing again plans exactly them (they're still empty days).
Each chunk knows whether its stay continues from / into the next chunk.

**Prompt per chunk** (`buildPrompt(..., chunk)`): full trip context (dates, travellers, every stay and
flight) but "plan only these days: …; other days are planned separately". Booking rules (move day,
landing, flight home) only for the chunk's days. When a stay is split across chunks: the earlier
part gets "focus on the city's main sights", the later part "the main sights are covered — prefer
day trips, neighbourhoods and lesser-known places", so parallel calls don't pick the same places.

**Calls** — all chunks in parallel (`Promise.all`) inside the one request. Chunked runs only:
- deadline 105 s per chunk (AbortSignal) so one slow chunk can't sink the request; leaves ~45 s for
  photos + insert;
- one retry on 429 / 529 / 5xx when it fails fast (burst / ramp limits; OTPM counts real tokens, not
  `max_tokens`, so 5 × 16k caps is fine).

**Merge** — items from every chunk that answered, in day order → the existing pipeline (validate,
outside-trip filter, dedupe, photos, insert). Dedupe moves to a pure `dedupe.ts` (same
`normalizeTitle` rule) and, for the itinerary only, also treats two places with the same
`wikipedia_title` as one ("Grand Palace" under two Hebrew names).

**Failures** — a failed chunk (HTTP error, timeout, network) doesn't stop the others: rows from the
rest are inserted. All chunks failed → today's `llm_failed` 502. The response adds
`missing_days: string[]` (days that were to be planned and got no row). Client: an info toast
"N ימים נשארו בלי תוכנית — לחצו שוב על 'מסלול מוצע עם AI' כדי להשלים אותם" in the itinerary tab
and after the wizard.

**Cost / caps**
- Daily caps checked once, before any call (unchanged). The pending reservation holds
  0.06 $ × number of chunks.
- Exactly one `agent_runs` row per request (the reservation, updated): summed input/output tokens and
  cost, plus 0.12 $ estimated for each chunk aborted at the deadline (its tokens are billed but
  unknown). Diag line adds `chunks=N failed=K stop=…per chunk… chunk_ms=… missing_days=…`.
- Expected cost of a 21-day plan ≈ 0.18-0.20 $ (about the same output as one call, +~10k input).

## Phase 1 — pure helpers + unit tests (no behaviour change)
Files: `supabase/functions/generate/chunks.ts` (`itineraryScope`, `planItineraryChunks`,
`chunkPromptLines`), `supabase/functions/generate/dedupe.ts` (`normalizeTitle` moved verbatim,
`dropDuplicates` pure), `index.ts` uses them; tests `src/lib/generate-chunks.test.ts`,
`src/lib/generate-dedupe.test.ts`.

**Acceptance (unit tests, `npm run check` green):**
1. ≤ 7 plan days → one chunk with exactly those days.
2. The 18-day Thailand trip from `generate-bookings.test.ts` (stays 7/4/3/4) → 3 chunks 7/7/4, cuts
   only at hotel changes.
3. 21 days, 4 stays 6/5/5/5 → 4 chunks matching the stays.
4. One 15-day stay → 5/5/5 with continue flags; no stays, 10 days → 5/5.
5. A hotel change on an already-planned day moves the cut to the next planned day.
6. 40 empty days → 5 chunks (35 days) + 5 deferred days; every day appears exactly once, in order.
7. `itineraryScope`: no items → all days; some days planned → only empty days; all planned →
   add-mode; same results as today's inline code.
8. Dedupe: same normalized title across two chunks → second dropped; meals/free/transport unique per
   day only; same `wikipedia_title` under two Hebrew titles → dropped (itinerary only).

## Phase 2 — wire it into `generate` + client message
Files: `supabase/functions/generate/index.ts`, `src/lib/ai.ts`, `src/routes/trip/ItineraryTab.tsx`,
`src/routes/WizardPage.tsx`, `docs/ai-media-pipeline.md` (a short "long trips" note).
Touches: Edge Function, AI spend. Roles: owner / editor (unchanged gate). No DB change.

**Acceptance (local Supabase + real model, throwaway local user):**
1. Fresh 21-day trip, 4 stays, international + 2 domestic flights, empty itinerary → one request:
   every trip day (landing → flight home) has items; total time well under 150 s (target < 90 s);
   `stop=end_turn` on every chunk.
2. Exactly one new `agent_runs` row (`generate_itinerary`, status ok, tokens/cost = sum of chunks,
   `chunks=N` in diag); no `pending` row left behind.
3. A 5-day trip → single call (no `chunks=` in diag), items on all 5 days.
4. Partial failure (temporary local patch forcing one chunk to fail, not committed): the other
   chunks' rows are inserted, response lists that chunk's days in `missing_days`, the run is logged
   once with `failed=1`; pressing again plans exactly the missing days and leaves the rest untouched.
5. Phone width, itinerary tab: the info toast shows the missing-day count in Hebrew (from 4).
6. Over the daily cap → 429 before any model call (unchanged path), nothing logged as spend.

## Production (Roi, after #42 and this PR merge)
1. Deploy the `generate` Edge Function (no migration, no secret). The old site ignores the new
   `missing_days` field, so the function can go first.
2. The toast ships with the next site release.
