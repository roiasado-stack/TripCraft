# Agency workspace: a separate area for agents, built for a big screen

Date: 2026-10-19 · Route: Brief → Plan · Status: **awaiting Roi's approval**

## Goal

Agents get their own workspace at `/agency`. Nothing in it comes from the traveller app: no
traveller header, no tabs, no "my trips" screen, and no landing in `/trip/:id` when they open a trip.
The workspace is designed for a desktop browser first (side menu, wide tables, two columns), and
the same screens still collapse to one column on a phone, so an agent can still send a trip from
the field. All of a trip's booking data enters through a single import layer, so a later connection
to an agency's own system (booking system, CRM) plugs into that layer instead of being a rebuild.

Roi's decisions (2026-10-19): a separate area on the same site, **not** a subdomain · a new trip
screen for agents · desktop first, still works on a phone · build only the integration
infrastructure for now, no real connection yet.

## Non-goals

- No subdomain, no separate build or deploy. Login, Supabase and Vercel stay the same.
- No real connection to an external system, no API keys for agencies, no new Edge Function.
- No change to what the traveller or the lead client sees. `/trip/:id` stays the same for them.
- No change to who can see what. RLS stays the authority, and the workspace only uses what an
  agent can already read and write.
- No PWA or "install to home screen" (separate topic). No offline support.

## Current state (what we change)

- `/agent`, `/agent/new` and `/agent/send/:tripId` are each a `max-w-lg` column, so on a computer
  they show as a narrow strip.
- A trip on the list links to `/trip/:id` ([AgentPage.tsx:185](../../src/routes/AgentPage.tsx)):
  the agent lands in the traveller's screen.
- The mockup [design/agency-dashboard.html](../../design/agency-dashboard.html) already has a side
  menu and a work area. Phase 1 starts from it.

---

## Phase 1: the workspace shell and the trip board

**What gets built**
- `AgencyLayout`: a side menu on the right (RTL) on desktop, a top bar plus a menu drawer on a
  phone. The top bar shows the agency's name, color and logo (`agency-brand`, migration 023).
  Menu: trips · new trip · (admin only) agent management.
- Routes under `/agency`: `/agency` (board), `/agency/new`, `/agency/trips/:tripId` (phase 2),
  `/agency/trips/:tripId/send`. The old `/agent/*` routes redirect to the new ones, so links already
  sent out keep working. Links from Settings and TripsListPage point to `/agency`.
- Trip board: on desktop, a table (client, destination, dates, send status, join status, "needs
  attention") with search, a filter, and sorting by date. On a phone, the current list. Same RPC,
  `agent_trip_board`.
- The new-trip wizard and the send screen move into the shell as they are (wide screen: content
  stays in a readable column inside the work area). The send screen's logic is pulled out into a
  component so phase 2 can embed it.

**Acceptance criteria (verifier)**
1. An agent at 1440×900 opening `/agency` sees a side menu and a table, with no element from the
   traveller app (no traveller header and no tabs).
2. At 375×812 the same screen is one column with a menu button. No horizontal scrolling.
3. `/agent`, `/agent/new` and `/agent/send/<id>` go to their matching `/agency` addresses.
4. A non-agent user on `/agency` gets the same behaviour as today under `AgentRoute` (no access).
5. Search and filter on the board work. "Needs attention" shows the same count as today.
6. Creating a trip and sending a link (WhatsApp/copy) works end to end inside the shell, in both widths.

Roles: agent, non-agent user, admin (menu item) · DB: no · Edge: no · share: no · /privacy: no

## Phase 2: the agent's trip screen

**What gets built**
- `/agency/trips/:tripId`, the replacement for `/trip/:id`. Desktop is two columns:
  - Main column: trip details and the client (`trip_clients`) · bookings (`flights`, `stays`,
    `transfers`) with add/edit/delete · documents (`documents`, private bucket as today) · a
    short itinerary summary.
  - Side column: the send panel (the component from phase 1): link status, join status, lead
    client, members waiting for approval.
- "View as the client" opens `/trip/:id` in a new tab, for checking the result only.
- Every edit control is gated with `can(role, "edit")`. Writes go through `useToast`. Dates go
  only through `@/lib/trip-dates`.
- The board and the wizard's last step lead here instead of to `/trip/:id`.

**Acceptance criteria (verifier)**
1. Clicking a trip on the board opens `/agency/trips/<id>`, not `/trip/<id>`.
2. An agent can add, edit and delete a flight, a hotel and a transfer. The change shows up in
   `/trip/<id>` for the client as well (same rows).
3. Sending, the link's status and approving a member work from the side panel, same as on the send screen.
4. At 1440 there are two columns. At 375 there is one column, with the send panel after the details.
5. A trip member who is not the owner (e.g. the lead client) on `/agency/trips/<id>` does not get
   the screen (AgentRoute), and their `/trip/<id>` has not changed.

Roles: agent (owner), lead client, participant · DB: no (existing tables) · Edge: no · share: no · /privacy: no

## Phase 3: import infrastructure for future connections

**What gets built**
- `src/lib/agency-import/`: one normalized type, `BookingImport` (travellers, flights, stays,
  transfers, a source and an external reference), plus an `ImportSource` interface. The document
  scan that runs today (`ImportBookings` → `insertTripWithDrafts`) becomes the first source,
  `"documents"`, and the only place that writes an imported trip. Pure unit tests (mapping,
  dedup by booking reference).
- Migration `025_trip_source.sql`: `trip_clients.source` (`manual` | `documents`, CHECK, open
  to extension) and `trip_clients.external_ref` (the booking number in the agency's system). It
  sits on `trip_clients` on purpose: that table is owner-only and does not reach the public share
  page. Ends with the check query that returns zero rows.
- Cases in `supabase/tests/`: another agent / a member / the lead client do not see `source` or
  `external_ref`. `get_shared_trip` does not return them.
- `docs/agency-integrations.md`: how a future source is connected (Edge Function + an agency key,
  what it receives, where it writes). A guide only, no code.

**Acceptance criteria (verifier)**
1. A trip created from documents saves `source = documents`, and the trip screen shows "נוצר
   ממסמכים" (created from documents).
2. The agent can type an external booking number. It is saved and shown on the board.
3. `npm run test:db` is green, including the new cases.
4. The share page (`/share/:slug`) for that trip does not include the source or the booking number.

Roles: agent, member, lead client, anonymous (share) · DB: **yes** (025) · Edge: no · share: no
(checked it is not exposed) · /privacy: no (no new third party)

---

## Notes and risks

- **Branch:** `feat/agency-workspace` branched off `feat/lead-client`, because the send screen
  depends on it. If lead-client is merged first, this rebases onto `agent-chat`.
- Phases 1 and 2 touch the same files (layout, routes), so they run one after the other. Phase 3
  (`supabase/` + `src/lib`) can run in parallel with phase 2.
- **Production:** only phase 3 has a manual step, pasting `025_trip_source.sql` into the SQL Editor.
  Roi does it.
- **Market fit:** the workspace serves the "3 taps for the agent" path (documents → review →
  send). The table and two columns are there to make the review faster, not to add an agent CRM.
