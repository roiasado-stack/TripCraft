# Public landing page at `/` (Google OAuth branding verification, 2026-11-20)

Route: **Straight**. Google's branding review rejected the homepage `https://tripcraft.co.il`
because a signed-out visitor is sent straight to the login form (`TravelerRoute` → `/auth`).
The homepage on the consent screen must be a public page that explains the app and links to the
privacy policy and terms.

## State found
- `/terms`, `/privacy`, `/accessibility`, `/credits` are already outside every route guard (public).
- `public/google0f4e09f7d1800fe0.html` is on `agent-chat` (4b1d304) but **not** on `production`:
  live `tripcraft.co.il/google0f4e09f7d1800fe0.html` returns the SPA's index.html. The release below
  carries it.
- `production` = `agent-chat` minus that one file, so the release is a clean fast merge.

## Goal
A signed-out visitor on `/` sees a Hebrew landing page: what TripCraft is, its main features, a
"כניסה / הרשמה" button to `/auth`, how Google sign-in data is used, and a footer with visible links to
`/privacy` and `/terms` (plus accessibility, credits, contact email).

## Non-goals
- No change for signed-in users: `/` stays the trip list (agents still go to `/agency`).
- No new data flow, no DB / Edge Function change, no `/privacy` text change.
- No English version (the `?lang=en` exception is for the share page only).

## Phase 1 (only phase)
- `src/routes/LandingPage.tsx` (new, in the main bundle — it's first paint for new visitors).
- `TravelerRoute` gets an optional `guest` element shown instead of redirecting to `/auth`; only `/`
  uses it. An installed PWA (standalone) still goes straight to `/auth` — no marketing page on launch.
- `/auth` gets a link back to `/` ("מה זה TripCraft?").
- `index.html` gets a `<noscript>` description with the privacy/terms links, for non-JS checkers.

Touches: anonymous visitors only. DB / Edge Functions / share page / `/privacy`: no.

### Acceptance criteria
1. Signed out, `/` shows the landing page (title, description, features, sign-in button) — no login form.
2. The sign-in button opens `/auth`; signing in there lands on the trip list.
3. The footer shows working links to `/privacy` and `/terms`; both pages load signed out.
4. Signed in as a traveller, `/` is the trip list; as an agent, `/` goes to `/agency`.
5. Google sign-in returning to `/` lands on the trip list (no landing-page flash once the session is read).
6. Phone width (375px) and desktop: no horizontal scroll, RTL correct, light + dark mode readable.
7. `npm run check` green.

## Release (Roi approves, production)
PR → `agent-chat`, then release PR `agent-chat` → `production`, `vercel deploy --prod`, tag
`prod-2026-11-20`. Then check signed out (incognito): `/`, `/privacy`, `/terms`,
`/google0f4e09f7d1800fe0.html` (must return the one-line verification text, not the app).
Then Google Cloud Console → Branding verification issues → "I have fixed the issues" → Proceed.
