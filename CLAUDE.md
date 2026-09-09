# TripCraft

Hebrew-first, RTL, mobile-first trip companion. React 18 + Vite + TS + Tailwind v4,
Supabase for auth/DB/storage. Setup steps live in README.md — don't duplicate them here.

## Commands

```
npm run dev        # Vite on :5173 (preview via .claude/launch.json, name "tripcraft")
npm run typecheck  # tsc -b --noEmit — the only check that exists; run it after edits
npm run build      # tsc -b && vite build
```

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
- Trip-wide state comes from `useTrip()` (`@/routes/trip/TripLayout`): `trip`, `participants`,
  `reloadParticipants()`, `openShare()`. After a write, call the reload function rather than
  mutating local state.
- Feedback on writes goes through `useToast()` — Hebrew message on both success and failure.

## Supabase schema

- `supabase/schema.sql` is the full, idempotent schema; incremental changes go in a new numbered
  file under `supabase/migrations/`. Both are applied by pasting into the SQL Editor — there is
  no CLI migration flow here.
- **Every table needs RLS.** Owner access via `public.owns_trip(trip_id)`; public read for shared
  trips via `public.trip_is_shared(trip_id)` granted to `anon`. Copy the pattern in the `DO $$` loop
  in `schema.sql` when adding a child table, and index `trip_id`.
- Roles live in `user_roles`, never on `profiles`.
- Documents go in the private `trip-docs` bucket, keyed `<auth.uid()>/…` — the storage policies
  depend on that first path segment.

## Two audiences, two paths

`/share/:slug` (`SharePage`) is read-only and served to **anonymous** visitors. Anything new that
should appear there needs an `anon` SELECT grant plus a `shared read` policy, and the page must
never assume a logged-in user. Everything else sits behind `ProtectedRoute`.

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

There is no offline support.
