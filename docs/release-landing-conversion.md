# Release checklist: landing conversion (steps 1-7)

Everything below is for production (`TripCraft`, ref `fclfhzuqlvdelcsrroql`). Nothing here has been run
against it. Dev (`TripCraft-dev`, ref `xneydbffncoqowtgkhxv`) already has migration 031 and the
`demo-request` function, and the form was tested end to end there (both emails arrived).

## What ships

- Landing page rewrite, traveller/agent switch, `/agents`, live example, `/sample-trip`.
- Agent demo form on `/agents#demo` -> Edge Function `demo-request` -> table `demo_requests` + 2 emails (Resend).
- First-trip success screen (`/trip/:id/created`), GA4 + Meta Pixel (only if the env vars are set), `/privacy` updated.
- `index.html` SEO/OG tags, `public/og-rome.jpg`, `vercel.json` CSP for Google/Meta.
- Migration `031_demo_requests.sql` (new table, RLS on, no client grants) + `supabase/tests/17_demo_requests.sql`.

## Order (do not skip or reorder)

1. **Branch.** Commit the worktree, open a PR into `agent-chat`, review, merge. Then merge `agent-chat` into `production`.
2. **SQL, production SQL Editor.** Paste `supabase/migrations/031_demo_requests.sql`. Its last query must return **zero rows**.
   Production already has 029 and 030; 031 depends on neither.
3. **Secrets, production project** (Supabase dashboard -> TripCraft (not -dev) -> Edge Functions -> Secrets):
   - `RESEND_API_KEY` (a key made for production; a different one from dev is fine)
   - `MAIL_FROM` = `TripCraft <hello@tripcraft.co.il>`
   - `DEMO_VIDEO_URL` = `https://youtu.be/ttd5gtI_jbU`
   - `DEMO_NOTIFY_EMAIL` = `Tripcraft26@gmail.com`
   - `DEMO_REPLY_TO` = `Tripcraft26@gmail.com` (until `hello@` receives mail; then remove it)
   - No `DEMO_BOOKING_URL` (calls are booked by hand).
4. **Function.** `npx.cmd supabase functions deploy demo-request --project-ref fclfhzuqlvdelcsrroql`
   (the CLI may need `npx.cmd supabase login` first). Default JWT verification stays on.
5. **Site.** From the `production` branch: `npx.cmd vercel build --prod`, then `npx.cmd vercel deploy --prebuilt --prod`.
   Optional env vars in Vercel before the build: `VITE_GA_ID`, `VITE_META_PIXEL_ID` (unset = no tracking and `/privacy` says nothing about it).
6. **Smoke test on the live site** (phone width):
   - `/` hero, CTA -> login -> `/new`; toggle to "אני סוכן נסיעות"; `/agents`; `/sample-trip`.
   - Fill the demo form with your own address: success text appears, the agent email and the team email arrive, the row is in `demo_requests`.
   - Paste the site URL into WhatsApp: the preview shows the new title and `og-rome.jpg`.
   - A `/share/<slug>` link still looks unbranded (share OG injection).
7. **Tag** the new freeze: `prod-YYYY-MM-DD`.

## Known gaps (not blockers)

- `LEGAL.contactEmail` stays on Gmail until `hello@tripcraft.co.il` receives mail (ImprovMX DNS check pending).
  When it does: set it in `src/lib/legal.ts`, run `npm run check`.
- Hero video file, real stats and testimonials are empty on purpose (sections hide themselves).
- Feature screenshots in `public/features/*.webp` are not wired into the feature cards yet.
- Mobile LCP about 3.3s on simulated slow 4G (main bundle 612 kB); a separate performance task.
- Rolling back: the function and table are additive. To switch the form off, remove the `RESEND_API_KEY` secret
  (leads are still saved, no email goes out); to remove the page, redeploy the previous tag.
