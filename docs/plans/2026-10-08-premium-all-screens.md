---
title: Premium design on every remaining screen
date: 2026-10-08
route: Straight (/ship)
status: approved by Roi 2026-10-08 ("תתחיל בכל המסכים")
---

# Premium design on every remaining screen

## Goal

Bring every screen that still has the old layout to the Apple-style design already live on the
trips list, trip home and suggestions (PRs #6, #8): grouped lists instead of stacks of cards, one
primary action per row, secondary actions behind "⋯", one "+" for adding, type scale and
translucent chrome, correct Hebrew counts, and every rule the break-ui pass taught (long and
English titles, 320px, 150% text, local dates).

## Non-goals

- Legal pages and the admin monitoring page (text pages; they already have the palette).
- New features or data. Each screen keeps exactly what it does today, for the same roles.
- Database / Edge Function changes — unless a phase finds a real bug, which then gets its own
  test and is called out in the PR.

## How every phase is verified (unchanged)

break-ui fixtures (Demo / Worst case / Empty / One / Huge) at 375 and 320, light + dark, 150%
text; `npm run check` (incl. the contrast and local-date rules); `eng-reviewer` per phase (and
`eng-security` where members, sharing or documents are touched); Roi checks on his phone via
`tripcraft-phone` (check `preview_list` + curl first). Fixtures get whatever data a screen needs
(itinerary days, transfers, documents, checklist items, members).

## Phases (in order of how often travellers open them)

1. **Itinerary** (`ItineraryTab`) — days as sections with a sticky day header, items as grouped
   rows (time · title · place), add/edit behind "+" and "⋯", Shabbat/holiday notes kept.
2. **Flights & stays** (`TransportTab`) — flights, stays and transfers as grouped lists with the
   flight route row from the home screen; boarding details in the row's sheet.
3. **People & sharing** (`PeopleTab`, `TripMembers`, `ShareSheet`) — participants and members as
   grouped lists, invite/share flows as clean sheets. Security review (members, invites).
4. **Documents & checklist** (`DocumentsTab`, `ChecklistTab`) — documents grouped by category,
   checklist as iOS-style rows with a progress header. Security review (private documents).
5. **The agent** (`AskTab`) — chat bubbles, composer on a translucent bar, suggested questions as
   chips.
6. **Public pages** (`SharePage` rest, `JoinPage`) — the brochure clients see: grouped sections
   matching the app. Security review (anonymous).
7. **Create & account** (`WizardPage`, `SettingsPage`, `AuthPage`) — the wizard's steps as calm
   full-width sections; settings as an iOS settings list.

**PRs:** one after phases 1–2, one after 3–4, one after 5–7 — each with evidence, each checked on
Roi's phone before he deploys.

## Changes outside the app
None planned (site deploys only). Any exception is listed in its PR.
