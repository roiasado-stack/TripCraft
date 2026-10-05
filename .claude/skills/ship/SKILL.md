---
name: ship
description: TripCraft's engineering workflow end to end — route the request, plan with Roi, build each phase, review + verify + gate it, final review, PR with evidence, retro. Use when Roi asks to build, fix or change something in the app ("תבנה", "תתקן", "תוסיף", "/ship"), unless he asks for a quick direct edit.
---

# /ship — the TripCraft engineering flow

You (the main session) are the **orchestrator**. Sub-agents can't start other agents, so you run every
step and call the engineering agents yourself: `eng-implementer`, `eng-reviewer`, `eng-security`,
`eng-verifier`. Roi steps in only at the ◆ points, or when a question, a change of decision, or an
escalation comes up.

## 1. Route
Pick one and tell Roi in one line which and why (he can override):

| Route | When | Goes to |
|---|---|---|
| **Blueprint** | new subsystem, new table family, new third-party service | Plan with a design section (data model, RLS, who sees what) ◆ |
| **Brief** | the goal is clear but the shape isn't ("משהו לכשרות") | 3–5 questions + 2 options with trade-offs ◆, then Plan |
| **Straight** | direction set, more than a few lines | Plan |
| **Debug** | something is broken | reproduce → root cause with evidence → *then* plan the fix. Write the failing test first. |
| **Direct edit** | copy change, one-line fix, obvious | edit → gates (step 4) → done. No plan, no agents. |

## 2. Plan ◆
Write `docs/plans/YYYY-MM-DD-<slug>.md`: goal, non-goals, phases (each independently shippable), and for
each phase its **acceptance criteria** written as things a verifier can check, which roles it touches,
and whether it changes the DB / Edge Functions / the public share page / `/privacy`.
Challenge the request where it fights CLAUDE.md or the market position (Hebrew, kosher/Shabbat, groups —
not AI itineraries). Then **stop and get Roi's approval.** Don't start building on a guess.

## 3. Per phase: build → review + verify → loop
Before the first phase, create or switch to a feature branch (`feat/…` / `fix/…`) — never work on
`agent-chat`. Commit only this work's files (`git add <paths>`, never `-A` or `.`): Roi often has
unrelated edits in the tree, and they must not end up in a phase commit.

For each phase, in order. Phases with no shared files may run in parallel: commit first (a worktree
starts from HEAD), then start each `eng-implementer` with `isolation: "worktree"`. **Never run two
phases that touch `supabase/` in parallel** — there is one local database, so they would test against
each other's schema and both grab the same migration number.

1. **Build**: do it yourself, or start `eng-implementer` with the plan path + phase number. It loops on
   `npm run check` until green.
2. **In parallel**, start:
   - `eng-reviewer` with the phase goal and the diff command
   - `eng-verifier` with the phase's acceptance criteria and the roles to test as (skip it only if
     the phase has nothing observable in the app — say so)
   - `eng-security` too if the phase touches `supabase/`, Edge Functions, sharing, members, documents,
     the demo, or AI spend
3. **Any FAIL** → fix (or send the findings back to the implementer) → re-run only the agents that
   failed. Repeat until all pass. Add the missing test SQL that `eng-security` wrote to `supabase/tests/`.
4. **Escalate to Roi** instead of looping when: a fix needs a decision the plan didn't make, the same
   failure survives three rounds, or a finding questions the plan itself.

## 4. Gates (every phase, and Direct edit)
```
npm run check      # typecheck · lint · repo rules · unit tests · build
npm run test:db    # only if supabase/ changed — local Docker DB
```
Both green, or the phase isn't done. Never weaken a rule, a test or the ALLOW list to pass.

## 5. Final review (whole branch)
In parallel: `eng-reviewer` on `git diff agent-chat...HEAD`, `eng-security` on the same, `eng-verifier`
on every acceptance criterion of every phase, and suggest Roi run `/code-review` (or
`/code-review ultra` for a big branch). Fix what's real, re-run the gates.

## 6. PR ◆
Commit on a feature branch (never on `agent-chat`), push, open the PR against `agent-chat`. The PR body has a
table: **requirement → evidence** (test name, verifier PASS line, screenshot). List anything that must be
done by hand in production, in order: migrations to paste into the SQL Editor, Edge Functions to deploy,
secrets. Roi applies production changes and merges — never you.

## 7. Retro ◆
Three short lines to Roi: what went wrong or was caught late, the check that would have caught it earlier
(a new test, a new rule in `scripts/check-rules.mjs`, or a line in CLAUDE.md), and whether to add it.
On his yes, add it. That is how a bug caught late becomes a check that runs early.
