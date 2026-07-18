# Caldearte — Testing Strategy (E2E)

**Status: plan, not yet built.** None of this exists in the repo today —
no `e2e/` package, no `playwright.config.ts`, no `.github/workflows/e2e.yml`,
no `playwright` dependency anywhere. Actual current testing in `apps/web`
is exclusively lib-level unit tests via Node's built-in test runner
(`apps/web/package.json`'s `"test": "node --import tsx --test
src/**/*.test.ts"` — covers `events.ts`, `date.ts`, `cities.ts`,
`comuna.ts`, `es-CL.ts`, `image-source.ts`; no component/DOM testing, no
jsdom, no browser automation). This doc is kept as the plan for when E2E
coverage is actually built, not a description of current practice — worth
revisiting the "what to test first" list below against the app as it
actually shipped (see the note on item 2) before building any of this.

Two distinct uses of Playwright in the same repo — worth not conflating: as
a curator dependency (Phase 1a, headless browser for JS-rendered sources a
plain `fetch` can't handle) and as the frontend's testing tool. They live in
separate workspace packages.

## Where it lives

`e2e/` at the workspace root, with its own `playwright.config.ts`. The config
uses `webServer` to boot `apps/web` automatically before running tests — no
need to start it by hand.

## Test data

Doesn't run against production Supabase or real scraped data (it changes
daily, would be flaky). Seeds a local instance (`supabase start` + a seed
script) with fixed fixtures — the same dataset already used in the
interactive prototype (see [ui-prototype.md](ui-prototype.md)): one city with
varied events, one empty city, one event flagged sensitive. Reusing those
fixtures directly saves inventing new ones.

## Local

`npx playwright test` from the repo root, with local Supabase running and
the seed applied.

## CI/CD

A workflow **separate** from the curator's cron —
`.github/workflows/e2e.yml`, not the same file as the daily cron. Triggers on
every pull request, not on a schedule. Boots local Supabase, runs the seed,
builds + starts the frontend, runs Playwright, uploads the HTML report as an
artifact on failure. This is exactly the objective gate `CLAUDE.md` already
defines: Claude Code opens PRs but doesn't merge them alone — this workflow
is the check before review, not a replacement for it.

## What to test first, not everything at once

1. The calendar loads and shows "today's" events for the default city.
2. ~~Switching between tabs (today/week/month/year) changes what's shown.~~
   Doesn't apply to what shipped — the app only ever shows "today," split
   into two fixed sections (Inauguraciones / Exposiciones Actuales). No
   time-filter tabs exist. Test the city picker instead (search, región
   grouping, keyboard nav — see `apps/web/src/components/CityPickerPanel.tsx`).
3. A city with no events shows the empty-state message + "tell us about one"
   CTA.
4. The "family mode" toggle hides events with `sensitivity_tags`; a
   first-time visitor (no cookie) should default to it being ON.
5. Column count responds to the actual viewport width — **1 column mobile,
   2 desktop** (not 1/2/3 as originally planned; `CalendarView.tsx` has no
   3-column tier), tested across different Playwright viewport sizes. The
   highest-value one to start with: the layout uses `ResizeObserver`
   instead of standard Tailwind breakpoints — easy to break unintentionally
   in a refactor and hard to notice just by looking.

Expands in later phases — Phase 1b adds a test for the email-approval flow
(visiting the signed "include" button URL and confirming the state changes
in the database).
