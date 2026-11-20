# Private accounts: one trip (for Roi's approval, 2026-11-20)

Route: **Straight** (direction set by Roi, touches the DB, several screens and possibly Edge Functions).

## Why
The first Instagram reel went out on 2026-11-20 and points private travellers at tripcraft.co.il.
A read-only check of production that morning found:
- Agent access is safe: a private user can only *request* it, and the request stays pending until an admin approves it.
- **No trip limit for private users.** Only agents (30 active trips) and demo visitors (3 trips, `guard_trip_update`, 016) have one.
- AI: $2/day per private user, but the **$15/day app-wide pool is shared with the agencies**. Enough private use in one day stops AI for the paying agencies too (`overDailyCap` in `ask` and `generate` checks the app pool before anything else).

## Goal
A private account (signed up, not an active agent, not an admin) owns **one trip**. The database enforces it;
the screens say so *before* the user spends time or AI on a second trip.

## Non-goals
- Payments or a paid private plan. There is no client price yet, so the message must not promise one.
- Trips the user **joined** (agency client, lead client, invited member). Joining never counts, so the B2B2C flow is untouched.
- Agents (keep their 30) and demo visitors (keep their 3).
- Deleting or hiding anything in existing accounts. Today one private user owns 2 trips. They keep both and can still edit them, but can't open a third.
- An admin screen for overrides (SQL line for now, see decision 4).

## Decisions for Roi (recommendation first)
1. **What "one trip" means.** **A: one at a time.** To open a new trip, delete the old one. B: one ever. B needs a counter that never goes down. A failed creation (the wizard deletes a half-built trip) would then use up the trial, so B needs extra repair logic.
2. **The "trip for example" button (Rhodes sample).** **It does not count, max one per account.** Otherwise a new user who taps it to look around has used their trial on a fake trip.
3. **"Try it yourself" copy of a showcase.** **It does not count.** It is limited already, to one copy per showcase per user.
4. **Override for a specific person** (a friend, a pilot traveller of an agency). **Yes, as one SQL line Roi runs in the SQL Editor:** `user_trip_limits(user_id, max_trips)`, writable only by `service_role`. An admin screen comes later if it's used.
5. **Message when blocked.**
   - Proposed: "בחשבון פרטי אפשר לנהל טיול אחד. כדי לפתוח טיול חדש, מחקו את הקודם או כתבו לנו ל-tripcraft26@gmail.com".
   - The trip list shows it in place of the "new trip" button, and `/new` shows it in place of the wizard.
6. **Terms line.** **Yes.** One sentence in `/terms`: "חשבון פרטי כולל טיול אחד בתקופת הניסיון; התנאים עשויים להשתנות". `/privacy` is unchanged: no new data and no third party.
7. **Phase 3: a separate AI pool for private users.** **Yes, $5/day total for private + demo users.** The per-user $2 and the $15 app pool stay as they are, so private users can never use more than $5 of the $15 and agencies always keep at least $10.

## Phases

### Phase 1: the database rule (migration 029)
- `029_private_trip_limit.sql`:
  - `trips.is_sample BOOLEAN NOT NULL DEFAULT false`.
  - `user_trip_limits` table, with RLS on, no grants to `anon` or `authenticated`, and `service_role` only.
  - `private_trip_limit(uid)`: the override, else 1; NULL for an active agent or an admin.
  - `my_trip_quota()`: `{limit, used, has_sample}` for the caller. Used by the screens only; the trigger is the gate.
  - Trigger `trips_private_limit`, BEFORE INSERT OR UPDATE OF `is_sample, demo_source_id`, with `pg_advisory_xact_lock` per user (copying `enforce_agent_trip_limit`). Templates count for private users, so `is_template` needs no watching. The sample / showcase-copy rules apply to every signed-in caller (an agent or a demo account can later become private); only the count is private-only.
    - **Counts:** owned trips that are not templates, not samples and not showcase copies.
    - **Exempt:** anonymous users, who are left to the existing 016 rule.
    - **Raises:** `private_trip_limit_reached` (23514).
    - **Second sample:** raises `sample_trip_limit_reached`.
    - **Showcase copies** count as exempt only when `demo_source_id` points at a real showcase and is the user's only copy of it.
    - **UPDATE:** turning a template, sample or copy into a counted trip is checked like an insert, so none of them is a bypass.
  - Ends with the check query that must return zero rows: no anon grants, `user_trip_limits` not writable by `authenticated`, and the trigger present.
- `supabase/tests/15_private_trip_limit.sql`:
  - First trip OK, second blocked, delete then create OK.
  - One sample free, second sample blocked.
  - Showcase copy is free and a forged `demo_source_id` is not.
  - Template→trip and sample→trip updates are blocked at the limit.
  - **An agent can still open more than one trip, and an admin is unaffected.** This is the "does nothing to the other kind of user" case CLAUDE.md asks for.
  - A member joining an agency trip is unaffected.
  - The existing 2-trip user can edit both but not add a third.
  - The override raises the limit.
  - Demo visitors keep the 3-trip rule.
  - `my_trip_quota` returns only the caller's numbers.

**Accept:**
- `npm run test:db` is green, with every case above.
- The agent tests (04, 08, 11) still pass unchanged.

**Touches:** DB; roles traveller / agent / admin / demo / member.

### Phase 2: the screens say it first
- `demo-trip.ts` inserts `is_sample: true`. The trip list hides the sample button once `has_sample`.
- **TripsListPage:** at the limit, the "new trip" button becomes the message from decision 5, with "למחיקת הטיול" guidance.
- **WizardPage (`/new`):** checks `my_trip_quota()` on load. At the limit it shows the message and never reaches a document scan, so no AI is spent.
- **HomeTab "duplicate":** hidden for a private user at the limit.
- **SharePage "try it yourself":** unchanged, because copies are exempt.
- **Errors:** `trip-drafts.ts` maps `private_trip_limit_reached` / `sample_trip_limit_reached` to their own Hebrew messages. The agent message stays as it is.
- **`/terms`:** one sentence (decision 6).

**Accept:**
- On a 375px phone, as a new private user: one trip OK, then the button shows the message, and `/new` typed directly shows the message.
- The sample trip doesn't block a real trip.
- An agent account sees no change in `/agency`.
- The share page "try it" still works logged-out and logged-in.

**Touches:** traveller screens, `/terms`; no change to the public share page payload.

### Phase 3 (decision 7): private AI pool
- Migration 030 adds `private_daily_cost_usd()`: today's spend of users who are not active agents, including demo users. One number, like `app_agent_daily_cost_usd()`. It is granted to `authenticated`, not `anon`, because the functions call it with the caller's JWT. The migration ends with the check query.
- **`ask` and `generate`:**
  - **When the caller isn't an active agent:** they're also blocked once the private pool reaches `PRIVATE_APP_DAILY_CAP_USD = 5`.
  - **On a failed read:** it counts as over (fail closed), like the app pool.
- Unit test for the cap decision; DB test that the function sums only non-agent spend.

**Accept:**
- With the pool full on the local stack, a private user gets the daily-cap message and an agent still gets an itinerary.

**Touches:** Edge Functions + DB; AI spend → `eng-security` runs.

## Production order (Roi runs it, after merge)
1. Paste `029` (and `030` for phase 3) into the prod SQL Editor. Each ends in zero rows.
2. Phase 3 only: deploy `ask` + `generate` from `C:/Users/user/tc-release`, never from the main folder.
3. Run `vercel deploy --prod`.

Between steps 1 and 3 an old bundle shows the generic "משהו השתבש" error on a second trip. That's acceptable for a few minutes.

Then: tag `prod-2026-11-2x`, and do a live check with Roi's own traveller account. That account is a plain traveller in prod. It must already own ≤1 trip, or it needs the override first.

## Risks
- **Roi's own traveller account and friends' accounts may own more than one trip.** They keep them, but can't add any; use the override.
- **Someone who uses the API directly** can still get one real trip and one sample, and edit the sample into a second trip. That is bounded and acceptable for a free tier.
- **The limit could break an agency.** It can't: an agency becomes an agent only after approval, and agents are exempt. A pending agency is a private user until Roi approves it.
