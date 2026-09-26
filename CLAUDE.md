# TripCraft

Hebrew-first, RTL, mobile-first trip companion. React 18 + Vite + TS + Tailwind v4,
Supabase for auth/DB/storage. Setup steps live in README.md — don't duplicate them here.

## Commands

```
npm run dev        # Vite on :5173 (preview via .claude/launch.json, name "tripcraft")
npm run typecheck  # tsc -b --noEmit — the only check that exists; run it after edits
npm run build      # tsc -b && vite build
```

Local Supabase (Docker Desktop) for anything touching RLS or Edge Functions:
`npx supabase start`, then apply `supabase/schema.sql` and every `supabase/migrations/0NN_*.sql`
in order with `docker exec -i supabase_db_tripcraft psql -U postgres -d postgres < file` (the CLI's own
migration runner is off in `supabase/config.toml` on purpose). `.claude/launch.json` → "tripcraft-local"
runs Vite on :5174 against it via `.env.localstack`. Test accounts belong there, never in production.

There are no tests, no linter, and no formatter. Don't add them unless asked.

## Language and layout

- All user-facing strings are **Hebrew**, written inline in the JSX. No i18n layer — don't add one.
- `index.html` sets `lang="he" dir="rtl"` globally. For layout use logical Tailwind utilities
  (`ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`), not `ml-`/`mr-`/`left-`/`right-`. A few physical
  ones remain for purely decorative absolute positioning (blur blobs) — that case is fine.
- Comments and identifiers are English. Only the strings are Hebrew.
- Fonts: `font-display` (Rubik) for headings, `font-sans` (Heebo) for body.

## UI

- Primitives live in `src/components/ui.tsx` (Button, Card, Input, Field, Modal, Segmented,
  Chip, Badge, EmptyState, Spinner…). Reuse them; don't pull in a component library.
- Colors come from the CSS variables in `src/styles.css` — use the semantic Tailwind names
  (`bg-primary`, `text-muted-foreground`, `bg-sun`, `border-border`). Never hardcode a hex.
- Icons: `lucide-react` only. Merge classes with `cn()` from `@/lib/utils`.
- Screens are phone-width: `mx-auto max-w-lg` inside `TripLayout`.

## Data

- One client: `supabase` from `@/lib/supabase`. It's **untyped on purpose** — assert row shapes
  at the call site with the interfaces in `@/lib/types` (`data as Trip[]`). Don't generate types.
- Components query Supabase directly inside `useEffect`/handlers. There's no data layer,
  no react-query, no global store — keep it that way.
- Trip-wide state comes from `useTrip()` (`@/routes/trip/TripLayout`): `trip`, `role`, `participants`,
  `reloadParticipants()`, `openShare()`. After a write, call the reload function rather than
  mutating local state.
- A trip can be opened by its owner or by a member (viewer / participant / editor — migration 015).
  Gate every edit control with `can(role, "manage" | "edit" | "participate")` from `@/lib/permissions`;
  it mirrors the RLS policies, which are the real authority. Never filter trips by `user_id` to
  mean "can see it" — RLS already returns exactly what the caller may read.
- Feedback on writes goes through `useToast()` — Hebrew message on both success and failure.

## Supabase schema

- `supabase/schema.sql` is the full, idempotent schema; incremental changes go in a new numbered
  file under `supabase/migrations/`. Both are applied by pasting into the SQL Editor — there is
  no CLI migration flow here.
- **Every table needs RLS.** Trip child tables use the role helpers from migration 015:
  `can_view_trip(trip_id)` for SELECT, and `can_edit_trip` / `can_participate_trip` for writes
  (copy the `DO $$` loop there). Index `trip_id`. Owner-only things (invites, members, sharing)
  use `owns_trip`. **No table gets an `anon` grant or a "shared read" policy** — that let anyone
  list every shared trip without the slug (closed in 013). Each migration ends with the check
  query that must return zero rows.
- Rows a member creates carry their author (`created_by` / `uploaded_by` / `user_id`, defaulting to
  `auth.uid()`); strip that column when copying rows, or RLS rejects the insert.
- Roles live in `user_roles`, never on `profiles`.
- Documents go in the private `trip-docs` bucket, keyed `<auth.uid()>/…` — the storage policies
  depend on that first path segment.

## Who sees a trip

- **Public brochure** — `/share/:slug` (`SharePage`) is read-only and served to **anonymous**
  visitors. It reads everything through one RPC, `get_shared_trip(slug)` (latest definition in
  016), which returns only the fields the page renders. Anything new that should appear there goes
  into that function (new migration) and `SharedTripPayload` in `@/lib/types` — never booking refs,
  participants, documents or notes. The page must never assume a logged-in user.
- **Members** — invited by a per-role link (`/join/:token`, `JoinPage`), joined through
  `accept_trip_invite`, approved by the owner in `TripMembers`. They see the full trip under their
  own login, limited by role.
- **Demo visitors** — "try it yourself" on a showcase trip signs them in anonymously and clones the
  trip (`clone_showcase_trip`). `useAuth().isAnonymous` is true; they can't share, invite or
  upload, get a tiny AI allowance, and are deleted after 7 days by `pg_cron`.

Everything else sits behind `ProtectedRoute`, except the public legal pages (`/terms`, `/privacy`,
`/credits`, `/accessibility` in `LegalPages.tsx`; business details in `@/lib/legal`). A new data
flow to a third party, or a change in who can see what, means updating `/privacy`.

## AI and Google login are live

Both are deployed and enabled in production (as of 2026-09-09) — don't describe them as
placeholder or disabled.
- AI generation (`src/lib/ai.ts` → `supabase/functions/generate`) and the conversational agent
  (`supabase/functions/ask`) both need `ANTHROPIC_API_KEY` set as a Supabase secret to work; a
  missing/misconfigured secret is the actual failure mode to check for, not "not built yet."
  `generateContent` still returns `{ ok: false, error: "not_deployed" }` if the function itself
  is ever missing — keep handling that case rather than assuming it's always up.
- Google login is enabled in Supabase Auth (Providers → Google), with its own OAuth client in
  the "Travel App" Google Cloud project.
- `generate` also auto-attaches a cover photo (Wikipedia, `kind: "photo"`) and coordinates
  (Nominatim, `kind: "geocode"`) to suggestions/itinerary items — manual add/edit and AI
  generation both go through this, no user-typed URL/coordinates anywhere. Photos are the page
  image of the exact English Wikipedia article for that place (AI items carry `wikipedia_title`;
  `kind: "photo"` asks Claude for the title or NONE). No key, and no search fallback on purpose —
  a miss stays null and shows MediaCard's fallback. Hits are cached in the service-role-only
  `photo_cache` (`wiki:` keys). `UNSPLASH_ACCESS_KEY` is no longer used. Geocoding translates
  Hebrew queries to English first (`translateHebrewQuery`) since Nominatim searches Hebrew badly.
  Wikimedia images carry CC licenses (e.g. CC BY-SA): each image shows an ⓘ link to its file page
  (author + license) via `wikimediaFilePage` in `MediaCard`, plus the `/credits` page.
- Repeated AI presses don't duplicate: `generate` lists the trip's existing suggestions/itinerary
  in the prompt and drops items whose normalized title (`normalizeTitle`) already exists.

There is no offline support.
