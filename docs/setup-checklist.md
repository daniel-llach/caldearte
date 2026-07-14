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
  ledger, in production. Triggered manually via
  `.github/workflows/event-discovery.yml` (`workflow_dispatch`) or locally
  with `pnpm --filter @caldearte/curator run discover-events` — no automatic
  schedule yet, see [region-discovery.md](region-discovery.md). This is the
  only event-sourcing pipeline; the earlier Venue Discovery + Event Crawler
  design (and the `venues` table) has been fully retired.

## Pending

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
- **Remaining GitHub secrets:**
  - `RESEND_API_KEY` / `RESEND_WEBHOOK_SECRET` — Phase 1b, **and now also
    blocked on cost, not just sequencing**: adding `caldearte.com` as a
    second verified domain needs Resend's paid plan (~$20/month), since the
    user's free-tier domain slot is already used by another project.
    Revisit once genuinely mandatory.
  - `APPROVAL_TOKEN_SECRET` — a random string, would be generated if/when
    the email-approval flow gets built (Phase 1a's ambiguous-case emails,
    deferred for the same reason — ambiguous events land as `pending_review`
    without it instead).
- **Connect the domain to Vercel** — once there's a first frontend deploy,
  add `caldearte.com` as a custom domain in the Vercel project; Vercel then
  provides the exact DNS record to load in GoDaddy.
- **Verify the domain in Resend** — Phase 1b, when building the mail flows;
  Resend will ask for DKIM/SPF (and MX, if receiving mail there) records in
  GoDaddy.
- **Enable PostGIS in Supabase** — Phase 2 (geo/temporal ranking), from the
  Supabase dashboard (Database → Extensions).
- **Meta/TikTok app review** — Phase 4 only, once there's real content
  running in the calendar.
