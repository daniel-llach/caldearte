# Caldearte

Before making any change, read:
- [docs/overview.md](docs/overview.md) — vision, scope, what counts as a valid event
- [docs/roadmap.md](docs/roadmap.md) — phases and current status
- [docs/curation-policy.md](docs/curation-policy.md) — required before touching Proceso A/B or any curation logic
- [docs/region-discovery.md](docs/region-discovery.md) — required before touching Proceso A/B: discovery, ranking, crawling, cost governance
- `docs/` also has `architecture.md`, `data-model.md`, `testing-strategy.md`, `risks.md`, `ui-prototype.md`, `figma-make-brief.md`, and `setup-checklist.md` — read the relevant one for the area you're touching

We're in Phase 1a: the core loop (scraper, curation, Supabase, calendar) — inbound-mail flows aren't built yet.

## Working mode — what to do solo vs. what to pause for

Do this without asking, start to finish:
- Write code, refactor, install dependencies, run tests.
- Local commits.
- Database migrations against LOCAL Supabase (`supabase start`), not production.
- Run the scraper/curator against test data or the local database.
- Iterate on the frontend, fix bugs you find yourself by running the app.
- Open pull requests (if the GitHub MCP is connected).
- Merge your own PR to `main`, as long as CI passes and it doesn't touch `supabase/migrations/`, `.github/workflows/`, or the curation policy (`docs/curation-policy.md`, or `packages/curation-policy` once it exists as code) — for code, frontend, tests, or docs, I don't need to review before merging.

Pause and ask me before:
- Pushing directly to `main` without going through a PR — that skips CI and this entire list of exceptions.
- Merging a PR that touches `supabase/migrations/`. **Pay special attention here:** there's a workflow (`.github/workflows/deploy-migrations.yml`) that runs `supabase db push` against production on every push to `main` that touches `supabase/migrations/` — the merge *is* the deploy, there's no separate step after. Review it with the same care you'd apply to running it by hand (does it delete or transform existing data? is it reversible?).
- Merging a PR that touches `.github/workflows/` — it changes the CI/CD pipeline, including whatever triggers deploys or crons.
- Merging a PR that touches the curation policy — those rules are our editorial decision, not something to "improve" on your own.
- Deploying to production on Vercel (preview deploys are fine, prod isn't).
- Anything that touches real secrets — don't even display them, tell me what needs to be loaded and I'll do it in the UI.
- Any spend — moving from a free tier to a paid one, buying anything.
- Submitting the app for Meta/TikTok review (Phase 4).

## Sensitive-data check — this repo is public

Before any commit or push (even the ones you make without asking permission above), check that none of the following slips in:
- Real secrets: API keys, tokens, passwords, connection strings — neither in file content nor in file names.
- Personal data, mine or anyone else's: full name, personal email, phone, address — neither in doc/code content nor in commit messages.
- If any of this is about to go in, stop and tell me instead of committing/pushing anyway — don't resolve it yourself (e.g. by rewriting history) unless I explicitly ask you to.

Note: on 2026-07-11 we audited the full git history and confirmed the docs' content is clean. The real name and personal Gmail address are exposed in several commits' author metadata (git/GitHub's default) — a conscious decision to leave as-is, not something to "fix" again on your own.
