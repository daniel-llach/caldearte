# Caldearte — Setup Checklist

Tracks what's actually configured today vs. what's still pending, so nobody
(human or Claude Code) has to guess. Update this when a pending item gets
done — it should always reflect reality, not the original plan.

## Done

- **Domain** — bought on GoDaddy (`caldearte.com`). DNS not configured yet —
  waiting on Vercel/Resend to hand over the exact records to load.
- **GitHub** — `caldearte/caldearte` repo created, public, first commit in.
- **Supabase account** — project `caldearte` created, region `us-west-2`
  (Oregon). Deliberate choice: proximity to South America wasn't prioritized
  — the project is expected to expand to more countries (see
  [region-discovery.md](region-discovery.md)), so optimizing latency for a
  single entry region didn't make sense.
- **Anthropic API key** — generated at console.anthropic.com, saved in a
  password manager, and loaded into `.env.local` and GitHub secrets — Event
  Discovery's code calls the API (see `apps/curator/src/event-discovery/`).
- **Resend account** — created.
- **Vercel account** — created. Repo not imported yet — happens once
  `apps/web` has a first commit.
- **Local tooling:** Node LTS + pnpm, Docker Desktop, Supabase CLI
  (`brew install supabase/tap/supabase`), GitHub CLI (`gh`, authenticated).
- **MCPs connected in Claude Code:** Supabase, GitHub.
- **Core schema deployed to production** — `regions`/`events`
  plus the cost-governance tables (`system_config`/`api_usage_log`), via
  `.github/workflows/deploy-migrations.yml` (auto-deploys on merge to
  `main` when `supabase/migrations/` changes). `venues` existed early on but
  has since been retired along with the Event Crawler.
- **Chile's initial regions seeded** — Santiago, Valparaíso, Concepción,
  Antofagasta, Arica, currently `active`/monthly (reset from weekly). This
  5-region bootstrap is expected to be replaced by a fixed ~100-unit list
  (cities + comuna-split metro areas) once the newer Tavily-based Event
  Discovery design is wired into production — see
  [region-discovery.md](region-discovery.md).
- **Tavily API key** — generated, loaded as a GitHub Actions secret
  (`TAVILY_API_KEY`) as of the Event Discovery production port.
- **GitHub secrets loaded:** `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`
  — used by `deploy-migrations.yml`. `ANTHROPIC_API_KEY`, `TAVILY_API_KEY`,
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — used by
  `.github/workflows/event-discovery.yml` (manual trigger only for now).
- **Event Discovery** — implemented in `apps/curator/src/event-discovery/`
  (Tavily + Haiku, fuentes brillantes), wired into the cost-governance
  ledger, in production. Runs automatically every Monday 06:00 UTC via
  `.github/workflows/event-discovery.yml`'s `schedule:` trigger (added
  2026-07-17, covers all 346 comunas on a rotating weekly batch — see
  [region-discovery.md](region-discovery.md)); `workflow_dispatch` still
  available for a manual run, or locally with `pnpm --filter
  @caldearte/curator run discover-events`. This is the only event-sourcing
  pipeline; the earlier Venue Discovery + Event Crawler design (and the
  `venues` table) has been fully retired.
- **Frontend (`apps/web`)** — built and working locally (Next.js on
  Vercel's target stack); not yet deployed to Vercel — see Pending below.
  Anon-key reads go through `events_public`/`regions_public` views, not the
  base tables (see `supabase/migrations/20260717050000_restrict_public_columns_via_views.sql`)
  — internal pipeline columns (`curation_reasoning`, `regions.status`,
  etc.) are no longer readable via the public anon key at all.

## Pending

- **Deploy `apps/web` to Vercel** (launch prep, 2026-07-17) — import the
  GitHub repo, root directory `apps/web`, stays on the free **Hobby** plan
  for now (see [risks.md](risks.md) for the commercial-use ToS caveat —
  deliberately not resolved yet, revisit once monetization or Probable SPA
  branding actually goes on the site). Needs these Vercel project env vars:
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (copy from
  local `apps/web/.env.local`), and `RESEND_API_KEY` (server-only, for the
  `/contacto` form's outbound email — see the Resend cost caveat below,
  the existing account's key works without any new domain verification).
- **Add `caldearte.com` as the Vercel project's custom domain** — Vercel
  will provide the exact DNS records; add them at the registrar. SSL
  auto-provisions once DNS resolves.
- **Vercel CLI** — not installed locally yet; only needed once `apps/web`
  has a first deploy.
- **`act`** (optional, run GitHub Actions locally in Docker) — not
  installed.
- **`ngrok`** (test Resend's inbound webhooks locally) — not installed; not
  urgent until Phase 1b.
- **Playwright** — not yet a project dependency; added once `e2e/` exists
  (see [testing-strategy.md](testing-strategy.md)).
- **Figma MCP in Claude Code** — a separate connection from whatever was
  used in a Cowork session; connect it here too if continuing design
  iteration from Claude Code.
- **Remaining GitHub/Vercel secrets:**
  - `RESEND_API_KEY` — needed now (Vercel env var, not a GitHub secret —
    the `/contacto` form's `apps/web/src/app/api/contact/route.ts` reads
    it at request time). The key itself works today with **zero new
    cost**, sending from Resend's shared `onboarding@resend.dev` domain —
    the route already defaults to that. Verifying `caldearte.com` as its
    own sending domain (for real `@caldearte.com` deliverability) is
    still the part blocked on cost: it needs a second verified domain,
    which needs Resend's paid plan (~$20/month), since the free-tier
    domain slot is already used by another project. Not needed for
    launch — revisit only if `onboarding@resend.dev` deliverability
    becomes a real problem.
  - `RESEND_WEBHOOK_SECRET` — still Phase 1b only (inbound mail flows),
    unrelated to the outbound-only contact form above.
  - `APPROVAL_TOKEN_SECRET` — a random string, would be generated if/when
    the email-approval flow gets built (Phase 1a's ambiguous-case emails,
    deferred for the same reason — ambiguous events land as `pending_review`
    without it instead).
- **Verify `caldearte.com` in Resend** — blocked on cost, see above; not
  needed for launch.
- **Enable PostGIS in Supabase** — Phase 2 (geo/temporal ranking), from the
  Supabase dashboard (Database → Extensions).
- **Meta/TikTok app review** — Phase 4 only, once there's real content
  running in the calendar.
