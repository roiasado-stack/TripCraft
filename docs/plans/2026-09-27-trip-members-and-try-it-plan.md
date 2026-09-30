---
title: Trip members, invites and "try it yourself"
date: 2026-09-27
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
depth: deep
---

# Trip members, invites and "try it yourself"

## Goal Capsule

**Objective:** a family or an agency's client can open a shared TripCraft trip with every detail they need (flights, booking refs, hotels, chosen documents) under their own login, changing only what their role allows. A LinkedIn visitor can edit a personal copy of the demo trip, and try the AI a little, without signing up.

**Means:** role-based trip membership enforced in Postgres RLS (KTD1–KTD3), plus Supabase anonymous sign-in for the demo sandbox (KTD8).

**Authority:** this plan's Product Contract > CLAUDE.md > the Planning Contract > existing code patterns. CLAUDE.md's "no tests, no linter" rule holds: verification uses throwaway scripts against a **local** Supabase, never a committed test suite.

**Stop conditions:**
- An owner loses access to anything they have today → stop and fix before continuing.
- Any member-escalation or anonymous probe succeeds → stop; nothing ships.
- A step needs a test account in **production** → stop. Test accounts exist only on the local Docker stack.

**Who ships:** the implementing agent works on a feature branch and verifies locally. Roi pastes migrations, flips the two Supabase dashboard switches (U10), and approves every production deploy.

## Product Contract

### Summary

The trip owner shares an invite link per role over WhatsApp. People who open it sign in with Google or email, are approved by the owner, and see the trip in their own list with full details. Roles decide what they can change: viewers change nothing, participants handle the checklist, suggestion likes and updates, and editors change everything except the trip's sharing and members. Documents stay private unless the owner marks one for all members. The public share link stays as a read-only brochure. For a showcase trip it also gets a "try it yourself" button that opens an editable personal copy, with a very small AI allowance.

### Problem Frame

Today the only way to share a trip is the public `/share/:slug` page. Since migration 013 it deliberately omits booking refs, participants, documents and the checklist, because anyone holding the link can see it. That fits a brochure but fails both real audiences. A family travelling together needs everything (booking refs, who's in which room, passports). An agency's client expects to see the full itinerary they paid for. Sharing the owner's password was considered and rejected: an agency client would see every other client.

For the LinkedIn launch, a read-only page shows the product without letting anyone use it. Group and family logistics is TripCraft's chosen differentiator (see memory: market position), so this feature is also the headline of the launch post.

### Actors

- **A1 Owner:** created the trip (`trips.user_id`). All rights, including deleting the trip and managing sharing and members.
- **A2 Editor:** co-planner, e.g. a partner or a second agent. Edits everything except delete, public sharing and members.
- **A3 Participant:** e.g. a family member. Sees everything shared, edits only the checklist, suggestion likes and new suggestions, and posts trip updates.
- **A4 Viewer:** e.g. an agency client. Sees everything shared and changes nothing.
- **A5 Demo visitor:** anonymous Supabase user from the showcase "try it yourself" button. Owns only their clone.
- **A6 Public visitor:** unauthenticated, `/share/:slug` only (unchanged).

### Requirements

**Membership and invites**
- **R1.** The owner can create one invite link per role (viewer, participant, editor), copy it or send it to WhatsApp, and revoke or regenerate it at any time. A revoked link stops working immediately.
- **R2.** Opening an invite link shows the trip's title and destination and the offered role before sign-in. After sign-in with Google or email, the invitee returns to the invite and joins.
- **R3.** New joiners are **pending** until the owner approves them (default on). The owner can turn approval off per link.
- **R4.** The owner sees all members (name, role, status), can approve, reject, change role or remove. A member can leave a trip.
- **R5.** Trips shared with a user appear in their trip list in a separate "shared with me" group, with a role badge.

**Permissions (server-enforced; the UI mirrors them)**
- **R6.** Viewer: read-only access to the trip and all shared content. No AI.
- **R7.** Participant: viewer rights plus checklist (shared items and their own personal items), liking and adding suggestions, and posting trip updates (editing and deleting only their own). AI chat and suggestion/checklist generation are allowed under their own daily cap.
- **R8.** Editor: everything except deleting the trip, toggling public sharing or showcase, and managing invites or members.
- **R9.** Personal checklist items are visible only to the member who created them.
- **R10.** Each member's AI chat history is private to them.

**Documents**
- **R11.** Every document is "only me" (uploader only) or "all members". The default is "only me", and existing documents stay "only me".
- **R12.** Participants and editors can upload their own documents (e.g. their passport) and choose the visibility. Viewers cannot upload.

**Public link and "try it yourself"**
- **R13.** `/share/:slug` keeps working exactly as after migration 013 (brochure fields only).
- **R14.** The owner can mark a shared trip as a **showcase**. Its share page then shows a "try it yourself" button.
- **R15.** The button signs the visitor in anonymously, clones the showcase trip (no documents, chat, members or photo album link) into a trip they own, and opens it with full edit rights and a visible "demo mode" banner.
- **R16.** Demo visitors get a very small AI allowance: at most $0.10/day each and $1/day for all demo visitors combined. Passport and voucher scanning are unavailable to them.
- **R17.** Demo visitors cannot share publicly, invite members or upload files.
- **R18.** Demo accounts and their trips are deleted automatically 7 days after creation.

**Legal**
- **R19.** `/privacy` and `/terms` describe members' access and the demo data deletion.

### Key Decisions

- **Roles viewer / participant / editor with per-person logins** (session-settled: user-chosen, over a shared agency username and password). Governs R1–R8.
- **One reusable invite link per role, owner approval on by default** (session-settled: user-chosen, over single-use personal invites). Governs R1, R3.
- **Documents default to "only me"; owner chooses per document** (session-settled: user-chosen, over "all members see everything" and "owner only"). Governs R11, R12.
- **Keep the public link as a brochure alongside invites** (session-settled: user-chosen, over replacing it). Governs R13.
- **AI for editor and participant, not viewer** (session-settled: user-chosen). Governs R6, R7.
- **Demo visitors get a tiny AI allowance** (session-settled: user-chosen, revising the earlier "no AI"; the cap values are this plan's proposal). Governs R16.
- **No change notifications in this round** (session-settled). See Scope Boundaries.
- **Demo sandboxes are deleted after 7 days** (session-settled). Governs R18.
- **The LinkedIn post waits for this feature** (session-settled).

### Acceptance Examples

- **AE1.** A participant updates a flight through the API → rejected by RLS, and the flight is unchanged.
- **AE2.** A participant likes a suggestion → saved. The same participant changes that suggestion's title → rejected.
- **AE3.** An editor sets `is_shared = true` → rejected. The editor changes the trip title → saved.
- **AE4.** A stranger (signed in, not a member) selects the trip, its flights and the members list by id → zero rows.
- **AE5.** An editor asks for a signed URL to the owner's "only me" passport → denied. Once the owner switches it to "all members" → allowed.
- **AE6.** Someone opens an invite link after it was revoked → sees "this invite is no longer valid" and joins nothing.
- **AE7.** A pending member opens the trip → "waiting for the owner's approval", and no trip data is readable.
- **AE8.** A demo visitor makes AI calls until $0.10 → the next call returns the daily-cap message. Other demo visitors are unaffected until the $1 combined cap is reached.
- **AE9.** A demo visitor tries to upload a document or create an invite → rejected by the server.
- **AE10.** An owner removes a member → that member's next request returns zero rows for the trip.

### Success Criteria

- Roi and one family member complete the flow on production with real accounts: invite → join → approve → member sees booking refs → member can't edit flights.
- The local probe matrix (Verification Contract) passes for every role × table × operation, and the anonymous 013 probe still shows 401 everywhere.

### Scope Boundaries

**Deferred for later:**
- Email or push notifications when the owner changes the trip.
- Converting a demo account into a real account and keeping the trip.
- CAPTCHA on anonymous sign-in. Add it only if abuse appears; Supabase's per-IP rate limit covers launch.
- Per-field permissions beyond the three roles.
- Realtime co-editing (live refresh while two people edit).

**Outside this feature:** agency billing, client portals with agency branding beyond today's `agency_name`/`agency_color`.

### Outstanding Questions

- *Deferred:* should the local verification scripts be committed (e.g. under `supabase/checks/`)? CLAUDE.md forbids adding tests. They stay in `.tmp/` unless Roi says otherwise.

## Planning Contract

### Key Technical Decisions

- **KTD1: Role is resolved in the database.** Add a `SECURITY DEFINER` function `trip_role(trip_id)`, which returns `owner` (from `trips.user_id`), the active member's role, or null. Add three thin wrappers: `can_view_trip`, `can_participate_trip`, `can_edit_trip`. Every policy uses those wrappers, the same way `owns_trip` is used today. Owners never get a `trip_members` row, so there are no duplicate owner states. Index `trip_members (trip_id, user_id)`.
- **KTD2: Column-level limits are enforced with BEFORE UPDATE triggers, not column GRANTs.** Postgres column privileges are per role, not per row, so they can't tell an editor from an owner. Guards:
  - On `trips`: only the owner may change `user_id`, `is_shared`, `share_slug` or `is_showcase`.
  - On `suggestions`: a participant may change only `liked`.
  - On `trip_updates` and checklist personal items: non-editors may change only their own rows (`created_by`).
- **KTD3: Invites are reusable per-role tokens.** A `trip_invites` table holds `token` (16 random bytes, hex), `role`, `requires_approval` and `revoked_at`. Joining goes only through the `accept_trip_invite(token)` RPC; nobody inserts into `trip_members` directly. `invite_preview(token)` returns title, destination and role and is callable by `anon`. It's the one deliberate anon-callable function besides `get_shared_trip`. It must reveal nothing more, and an unknown or revoked token returns null.
- **KTD4: Member names are snapshotted.** `profiles` stays owner-only (migration 013), so `trip_members.display_name` is filled at join time from the joiner's profile name or email local-part.
- **KTD5: Documents get `visibility` (`private` | `members`) and `uploaded_by`.** Backfill `uploaded_by` with the trip owner. Storage keeps the `<uid>/…` layout. A new storage SELECT policy calls a `SECURITY DEFINER` helper `can_read_trip_doc(object_name)`. The helper returns true when a `documents` row with that `storage_path` is `members`-visible and `can_view_trip`. Going through a helper, rather than an inline subquery against `documents`, keeps the storage policy from depending on `documents`' own RLS and keeps it cheap. Signed URLs work because `createSignedUrl` checks the SELECT policy. Upload stays under the uploader's own uid prefix.
- **KTD6: `checklist_items.created_by` and `trip_updates.created_by`** (backfill to the owner). `is_shared = false` checklist rows are visible only to `created_by`.
- **KTD7: `trip_chat_messages.user_id`** (backfill to the owner). Chat policies become "own rows on a trip I can participate in".
- **KTD8: The demo uses Supabase anonymous sign-in plus a `clone_showcase_trip(slug)` RPC.**
  - The RPC requires an authenticated caller and a trip with `is_shared AND is_showcase`, and allows at most one clone per caller.
  - It copies trip, participants, flights, stays, transfers, itinerary, suggestions and shared checklist. It does not copy documents, chat, members, invites or the album link.
  - Anonymous callers are identified in SQL by `(auth.jwt()->>'is_anonymous')::boolean`, and in Edge Functions by `user.is_anonymous`.
- **KTD9: Anonymous limits are layered.** RLS/triggers reject anonymous `is_shared`/`is_showcase`, invite creation and storage uploads. The Edge Functions add a demo cap: per-user $0.10 and all-anonymous $1/day. That needs an `anon_agent_daily_cost_usd()` that joins `auth.users.is_anonymous`. The functions also refuse `passports`/`voucher` scans for anonymous users.
- **KTD10: Cleanup runs as a daily `pg_cron` job.** It deletes trips owned by anonymous users older than 7 days, then those `auth.users` rows. Trips have no FK to `auth.users`, so trips go first.
- **KTD11: Edge Functions check role, not ownership.** `ask` and `generate` replace `trip.user_id === auth.user.id` with `trip_role`:
  - Owner, editor and participant may use AI.
  - Itinerary generation and the `add_to_itinerary` confirm need editor or above.
  - Suggestions and checklist generation need participant or above.
  - Viewers get a 403 with a Hebrew-mapped error.
- **KTD12: Verification happens on a local Supabase stack (Docker).** Run `supabase init`/`start`, apply `schema.sql` plus migrations 002–016 in order, and use seeded test users for each role. This is the only place test accounts are created (local host, allowed). Production is verified with the anonymous probe plus Roi's real-account walkthrough.

### High-Level Technical Design

Permission matrix (✓ = allowed; server-enforced):

| Operation | Owner | Editor | Participant | Viewer | Pending / stranger | Demo (own clone) |
|---|---|---|---|---|---|---|
| Read trip + flights/stays/transfers/itinerary/participants/suggestions/updates | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| Edit trip details, flights, stays, transfers, itinerary, participants | ✓ | ✓ | — | — | — | ✓ |
| Toggle public share / showcase, manage invites and members, delete trip | ✓ | — | — | — | — | delete only |
| Add suggestion, like suggestion | ✓ | ✓ | ✓ | — | — | ✓ |
| Edit or delete suggestion content | ✓ | ✓ | — | — | — | ✓ |
| Shared checklist: add, tick, delete | ✓ | ✓ | ✓ | — | — | ✓ |
| Personal checklist items | own | own | own | — | — | own |
| Post trip update / edit or delete | ✓ / all | ✓ / all | ✓ / own | — | — | ✓ |
| Documents: read "members" / upload own / change own visibility | ✓ | ✓ | ✓ | read only | — | — (no upload) |
| AI chat, generate suggestions/checklist | ✓ | ✓ | ✓ | — | — | tiny cap |
| AI generate itinerary, add to itinerary from chat | ✓ | ✓ | — | — | — | tiny cap |

Join flow:

```
WhatsApp link /join/:token
  → invite_preview(token)          (anon OK: title, destination, role — or "invalid")
  → not signed in? sign in (Google redirectTo=/join/:token, or email) and come back
  → accept_trip_invite(token)      (SECURITY DEFINER; not anonymous; idempotent)
      requires_approval → status pending → "waiting for approval" screen
      else              → status active  → navigate /trip/:id
Owner: ShareSheet → Members → approve / reject / change role / remove
```

Demo flow:

```
/share/:slug (is_showcase) → "נסו בעצמכם"
  → supabase.auth.signInAnonymously()
  → clone_showcase_trip(slug) → new trip id owned by the anon user
  → /trip/:id with demo banner; AI under demo caps; pg_cron removes after 7 days
```

### Assumptions

- Supabase anonymous sign-in and `pg_cron` are available on Roi's plan. Both are standard on hosted Supabase and are enabled in the dashboard (U10).
- The Supabase Auth redirect allow-list accepts `https://tripcraft-lac.vercel.app/**` and `http://localhost:5173/**`, so Google OAuth can return to `/join/:token`.
- Supabase's default anonymous sign-in rate limit (per IP) is acceptable for launch.

### Sequencing

Migrations first (015 members/permissions, 016 demo), verified locally. Then Edge Functions, then frontend. The production rollout order is migrations → functions → frontend. Old frontend code keeps working against the new migrations: owners keep every right, and today's queries filter by `user_id`.

### System-Wide Impact

- **Auth boundary:** every RLS policy on trip data is rewritten. This is the same surface where migration 013 closed three holes, so the anonymous probe from 013 must be re-run after deploy.
- **Cost:** members and demo visitors can now spend the shared Anthropic key. Bounded by the per-user, app-wide (migration 014) and demo caps, plus the Anthropic console limit Roi set.
- **Privacy:** members see booking refs and chosen documents of other people, and the privacy policy must say so (R19). Demo data is personal-data-free by construction: cloned showcase content plus whatever the visitor types, deleted after 7 days.

### Risks & Dependencies

- **RLS regression locks owners out** (high impact). Mitigation: the local matrix runs an "owner can do everything they did before" row set first.
- **`trip_role()` per-row cost** on large lists. Mitigation: STABLE SECURITY DEFINER, the members index, and trips are small (tens of rows per trip).
- **Anonymous abuse** (scripted sign-ins creating rows or AI calls). Mitigations: per-IP rate limit, the $1/day combined demo cap, no uploads, 7-day cleanup. CAPTCHA is deferred.
- **Google OAuth return path** depends on the redirect allow-list (U10).
- **Orphaned member files.** When an owner deletes a trip, the `documents` rows cascade away, but files a member uploaded stay under the member's uid prefix. This is acceptable for launch: the files are private to that member and removed when they delete their account. A cleanup can follow later.
- **Demo users creating many trips.** An anonymous user can also use the wizard. AI is capped, but row count is not. If abuse shows up, add a per-anonymous-user trip limit in 016's guards.

## Implementation Units

### U1. Migration 015: membership, roles and RLS rewrite

- **Goal:** everything in the permission matrix except demo-specific rules is enforced in Postgres.
- **Requirements:** R1–R12, AE1–AE7, AE10.
- **Files:** `supabase/migrations/015_trip_members.sql` (new); `supabase/schema.sql` (comment pointer only, same pattern as 013, since the new objects depend on 002-era tables).
- **Approach:**
  - Create `trip_members` (trip_id, user_id, role, status `pending|active`, display_name, created_at, unique (trip_id, user_id)) and `trip_invites` (KTD3).
  - Add `trip_role` and the three wrapper functions (KTD1). Grant them to `authenticated` only.
  - Replace each table's `"owner all"` policy with split SELECT / INSERT / UPDATE / DELETE policies per the matrix, following the `DO $$` loop style in `schema.sql`. Add the KTD2 guard triggers.
  - Add the new columns and backfills from KTD5–KTD7, and the storage member-read policy.
  - Add RPCs: `invite_preview`, `accept_trip_invite`, `leave_trip`.
    - `accept_trip_invite` rejects anonymous callers and the trip's owner. An existing member keeps their current role and status, so re-opening a link never changes a role. Only the owner changes roles.
  - Extend `delete_my_account()` (from 013): also delete the caller's `trip_members` rows, and the `documents` rows they uploaded to other people's trips. Their files are already removed by the client, since they live under the caller's uid prefix.
  - Owner-only policies on `trip_members` update/delete and `trip_invites`. Members can read the member list of trips they can view.
  - Explicit `REVOKE ALL … FROM anon` on the new tables, and end with 013's zero-rows check query.
- **Patterns:** `supabase/schema.sql` (`owns_trip`, `DO $$` loop), `supabase/migrations/013_prelaunch_lockdown.sql` (RPC shape, revoke-and-check style).
- **Test scenarios:** see U2's matrix. Specifically AE1–AE7 and AE10; owner-regression rows for every table; the trigger guard rows (AE2, AE3); storage signed URL private vs. members (AE5).
- **Verification:** the U2 local matrix is green; the migration re-runs idempotently.

### U2. Local Supabase stack and probe matrix

- **Goal:** a repeatable local check that proves U1/U3/U8 before anything touches production.
- **Requirements:** KTD12, the Success Criteria's local matrix.
- **Files:** `supabase/config.toml` (from `supabase init`, if Roi agrees to commit it; otherwise kept local); `.tmp/members/seed.mjs` and `.tmp/members/matrix.mjs` (not committed).
- **Approach:**
  - `supabase start` in Docker, then apply `schema.sql` and migrations 002→016.
  - Seed users owner / editor / participant / viewer / pending / stranger via the local admin API, plus one anonymous sign-in.
  - Run each matrix cell as that user through supabase-js, and print PASS/FAIL per cell.
  - Re-run 013's anonymous probe (`.tmp/debug/probe2.mjs`) against the local URL.
- **Test scenarios:** every cell of the permission matrix, both allowed and denied. The anonymous table probe expects 401/empty everywhere. Invite lifecycle: create → preview → accept (pending) → approve → revoke → accept again fails.
- **Verification:** all cells PASS. Output saved to `.tmp/members/matrix-<date>.txt` for the handoff.

### U3. Role-aware Edge Functions and demo caps

- **Goal:** AI access follows roles and demo limits.
- **Requirements:** R6, R7, R10, R16, AE8; KTD9, KTD11.
- **Files:** `supabase/functions/ask/index.ts`, `supabase/functions/generate/index.ts`; `src/routes/trip/AskTab.tsx` (chat rows are inserted and read client-side, so `user_id` is set and filtered there); `supabase/migrations/016_demo_try_it.sql` (for `anon_agent_daily_cost_usd`, see U8).
- **Approach:**
  - Replace the owner checks (`ask/index.ts` ~line 208, `generate/index.ts` ~line 985) with a `trip_role` RPC call and the KTD11 gates.
  - Extend `overDailyCap` with the anonymous branch: per-user $0.10 and all-anonymous $1.
  - Reject `passports`/`voucher` scans for anonymous callers.
  - Chat inserts carry `user_id`, and history reads filter by it.
  - Keep `verify_jwt` on, and deploy with the same command as before.
- **Test scenarios:**
  - A viewer calls `ask` → 403.
  - A participant asks the agent to add to the itinerary → the proposal isn't offered, and `confirm_action` for itinerary is refused.
  - An editor generates the itinerary → OK.
  - An anonymous user hits $0.10 → `daily_cap_reached`.
  - An anonymous user calls a passport scan → refused.
  - Two members chat on one trip → each sees only their own history.
- **Verification:** these scenarios run against the local functions (`supabase functions serve`) with the seeded users.

### U4. Role plumbing in the client

- **Goal:** every screen knows the caller's role, and member trips load.
- **Requirements:** R5, R6–R8.
- **Files:** `src/lib/permissions.ts` (new: role type and `can(role, action)` helper mirroring the matrix); `src/lib/types.ts` (TripMember, TripInvite, TripRole; `documents.visibility`, `created_by` fields); `src/routes/trip/TripLayout.tsx` (load the trip by id without the `user_id` filter, now safe since 013, fetch the role via RPC, and add `role` to `TripContext`); `src/routes/TripsListPage.tsx` ("my trips" plus "shared with me" with role badges; handles pending memberships).
- **Approach:** follow the existing `useTrip()` context pattern. The comments at `TripLayout.tsx:48-55` and `TripsListPage.tsx:39-42` about "shared trips readable" become obsolete after 013 and should be rewritten.
- **Test scenarios:** the owner list is unchanged; a member sees the trip under "shared with me"; a pending member sees a "waiting for approval" card and cannot open it; a removed member no longer sees it.
- **Verification:** browser pass on the local stack as each seeded user.

### U5. Role-aware UI across the trip screens

- **Goal:** controls a role can't use are hidden, not left to fail.
- **Requirements:** R6–R9, R12.
- **Files:**
  - Trip tabs: `src/routes/trip/HomeTab.tsx`, `TransportTab.tsx`, `ItineraryTab.tsx`, `SuggestionsTab.tsx`, `ChecklistTab.tsx`, `DocumentsTab.tsx`, `PeopleTab.tsx`, `AskTab.tsx` (all under `src/routes/trip/`).
  - Components: `src/components/TripUpdates.tsx`, `PhotoAlbumCard.tsx`, `GuideCard.tsx`, `TripHeader.tsx`, `TripCard.tsx`, `PreflightPanel.tsx`.
- **Approach:**
  - Gate each edit, add and delete control with `can(role, …)` from `useTrip()`.
  - Viewers see the AskTab with a short Hebrew explanation instead of the input.
  - Personal checklist tab shows only the caller's items.
  - Trip updates show delete/pin only on the caller's own posts (or all, for editor and owner).
- **Test scenarios:** walk every tab as viewer, participant and editor. No visible control may lead to an RLS error toast.
- **Verification:** browser pass per role on the local stack, plus screenshots at phone width.

### U6. Invites, joining and members management

- **Goal:** the owner can invite and manage people, and invitees can join from WhatsApp.
- **Requirements:** R1–R5, AE6, AE7.
- **Files:**
  - Screens: `src/components/ShareSheet.tsx` (a "Members" section for the owner: per-role link create / copy / WhatsApp / revoke, approval toggle, pending list, member list with role change and remove; members see a "leave trip" action); `src/routes/JoinPage.tsx` (new, `/join/:token`, public route).
  - Wiring: `src/App.tsx` (the join route); `src/hooks/use-auth.tsx` (`signInWithGoogle` accepts a return path).
- **Approach:**
  - The join page calls `invite_preview` and shows a login prompt when signed out. It keeps the token in the Google `redirectTo` path, then calls `accept_trip_invite` and routes by status.
  - Reuse `Modal`, `Segmented`, `Chip` and `Badge` from `ui.tsx`.
  - WhatsApp share uses a `https://wa.me/?text=` URL with the Hebrew invite text.
- **Test scenarios:**
  - Join while signed out via email, then via Google (redirect returns to `/join/:token`).
  - Join while already a member → idempotent.
  - Revoked link → invalid screen.
  - Approval off → immediate access.
  - Owner changes a viewer to editor → edit controls appear on the member's next load.
  - An anonymous demo user opens an invite → asked to sign in with a real account.
- **Verification:** local browser pass with two browser tabs (owner and invitee). Then on production with Roi and one family member (U10).

### U7. Document visibility

- **Goal:** the owner decides which documents members see, and members can add their own.
- **Requirements:** R11, R12, AE5.
- **Files:** `src/routes/trip/DocumentsTab.tsx`; `src/lib/documents.ts` (`uploadTripDocument` sets `uploaded_by` and `visibility`); `src/components/ImportVoucher.tsx` if it uploads through the same path.
- **Approach:**
  - A visibility chip on each document row ("רק אני" / "כל החברים"), editable only by the uploader.
  - The upload modal gets a visibility choice (default "רק אני").
  - Signed URLs are created as today, and RLS decides.
- **Test scenarios:** the AE5 pair; a participant uploads their own passport as "members" and the owner sees it; a viewer sees the upload control hidden and the API upload denied.
- **Verification:** included in the U2 matrix, plus a browser pass.

### U8. "Try it yourself" (migration 016 + UI)

- **Goal:** a LinkedIn visitor edits their own copy of the showcase trip with a tiny AI allowance.
- **Requirements:** R14–R18, AE8, AE9; KTD8–KTD10.
- **Files:**
  - Database: `supabase/migrations/016_demo_try_it.sql` (`trips.is_showcase`, `clone_showcase_trip`, `anon_agent_daily_cost_usd`, the anonymous guards on trips/invites/storage, and the `pg_cron` cleanup schedule).
  - Screens: `src/routes/SharePage.tsx` (the button when showcase); `src/components/ShareSheet.tsx` (showcase toggle, owner only, when shared); a demo banner in `TripLayout.tsx` or `TripsListPage.tsx`; `src/hooks/use-auth.tsx` (expose `isAnonymous`).
  - Data: `get_shared_trip` must return `is_showcase`, so 016 re-creates it with that one extra field.
- **Approach:**
  - The button calls `signInAnonymously()`, then `clone_showcase_trip(slug)`, then navigates. A second click by the same browser reuses the existing clone.
  - Hide sharing, invites and upload for anonymous users. The server enforces this too.
- **Test scenarios:**
  - The demo visitor's full path works end to end.
  - A second clone attempt returns the same trip.
  - AE8 and AE9.
  - A non-showcase shared trip has no button, and the RPC refuses it.
  - The cleanup job, run manually on the local stack against a backdated anonymous user, removes the user and their trips.
- **Verification:** U2 matrix rows for anonymous users, plus a local browser pass in a private window.

### U9. Legal pages and project docs

- **Goal:** the legal pages and CLAUDE.md describe the new sharing model.
- **Requirements:** R19.
- **Files:** `src/routes/LegalPages.tsx`; `CLAUDE.md` ("Two audiences, two paths" becomes three: public brochure, members, demo; plus the rule that new trip tables use the `can_*` helpers).
- **Approach:**
  - Privacy: members see shared data including booking refs; documents are shared only when marked; demo data is deleted after 7 days; demo AI goes to Anthropic.
  - Terms: owners are responsible for whom they invite.
- **Test scenarios:** none (text).
- **Verification:** read through in the browser. `npm run typecheck` passes.

### U10. Production rollout (Roi-gated)

- **Goal:** the feature is live with nothing opened by accident.
- **Requirements:** all; the Success Criteria.
- **Files:** none (operational).
- **Approach:**
  1. **Roi:** enable **Anonymous sign-ins** (Auth → Providers). Enable the `pg_cron` extension. Add `https://tripcraft-lac.vercel.app/**` to Auth → URL Configuration → Redirect URLs.
  2. **Roi:** paste 015, then 016, and check that each final query returns zero rows.
  3. **Agent** (with approval): deploy `ask` and `generate`, run the anonymous probe, then run `vercel build` + `deploy --prebuilt --prod` as in the 2026-09-26 rollout, and push the branch.
  4. **Roi + a family member:** the Success Criteria walkthrough. Roi marks the demo trip as a showcase.
- **Test scenarios:** the anonymous probe (all 401 or empty); invite → join → approve on production; the "try it yourself" button in a private window.
- **Verification:** probe output and a walkthrough checklist reported back.

## Verification Contract

- `npm run typecheck` and `npm run build` after every unit (CLAUDE.md: the only checks).
- **Local stack (U2):** run `.tmp/members/matrix.mjs` → every cell PASS; run `.tmp/debug/probe2.mjs` against local → 401/empty everywhere.
- **Edge Functions:** the U3 scenarios via `supabase functions serve` locally.
- **Browser:** the preview (`tripcraft` in `.claude/launch.json`) pointed at the local stack, one pass per role at phone width. No console errors, and no edit control visible that RLS would reject.
- **Production:** the anonymous probe after deploy, plus Roi's walkthrough. No test accounts are ever created in production.

## Definition of Done

- Every requirement R1–R19 is traceable to a passing matrix cell, scenario or walkthrough step.
- The local matrix and the anonymous probe are green. The production probe is green after rollout.
- Owners have every capability they had before this change.
- CLAUDE.md and the legal pages are updated.
- No abandoned-attempt code, debug logging or leftover `.tmp` references in committed files.
- Migrations 015/016 are idempotent and end with a zero-rows check.
