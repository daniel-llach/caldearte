# Caldearte — Roadmap

## Current status: Phase 1a substantially done — live in production

Done: pnpm workspace, core schema deployed to production
(`regions`/`events`), auto-deploy pipeline for migrations
(`deploy-migrations.yml`), all 346 Chilean comunas seeded, cost-governance
system shipped (`system_config`/`api_usage_log`, budget ceiling, region cap,
change-detection foundation).

Event Discovery (Tavily + Haiku, fuentes brillantes, see
[region-discovery.md](region-discovery.md)) is implemented and in production
(`apps/curator/src/event-discovery/`) — it's the only event-sourcing
pipeline. It writes every event's location as freeform text; there is no
venue entity. The earlier venue-based design (a separate "Event Crawler"
that revisited known venues, plus the `venues` table itself) has been
retired — it was left disconnected after the pivot (nothing fed it new
venues) and has been fully removed from the code and schema, not just
deprecated.

**Frontend (`apps/web`) is built and live** at `caldearte.com` (Vercel
Hobby, launched 2026-07-17/18) — the design decisions this section used to
describe as blocking are resolved and shipped: the full calendar view,
región-grouped city picker, family-mode content filtering (defaults ON for
first-time visitors), a real contact form, and standard SEO/analytics
basics. See [architecture.md](architecture.md) for the shipped city-picker
and geo-detection design, and `apps/web/src/components/` for the actual
component tree.

## Phase 0 — Definition (complete)

Closed out the initial project brief, moved into a dedicated repo.

## Phase 1a — Core loop (no inbound-mail flows yet)

- Event Discovery covers all 346 official Chilean comunas via a weekly
  rotating batch (`weekly_batch_size` comunas/run, oldest-`last_run_at`-
  first, cycling forever — **implemented 2026-07-17**), replacing the
  earlier "~100 hand-curated units, monthly cadence" plan before it
  shipped. Currently ramping up at 25/week, target steady-state 35/week
  (stays inside Tavily's free tier indefinitely) — see
  [region-discovery.md](region-discovery.md) for the batch sizing and cost
  breakdown.
- Search via Tavily (not Anthropic's `web_search`), curated by Claude
  Haiku 4.5 — no venue matching, every event has a freeform `location`.
  Includes a "fuentes brillantes" mechanism (known-rich sources fetched
  directly, auto-detected + manually grown) — see region-discovery.md.
- Claude Haiku 4.5 evaluates each candidate event against the five curation
  axes, picks the featured image, and runs the Axis 5 vision check (explicit
  aggression) plus `sensitivity_tags` tagging.
- Ambiguous cases → originally designed as an email with two buttons
  (include/don't include) via a Supabase Edge Function with a one-time-use
  token, landing ambiguous events as `pending_review` in the meantime.
  **Neither half is built**: Event Discovery's curation call is binary
  (`approved`/`rejected` only, no `pending_review` output today) and the
  email flow itself was deferred on cost. See
  [region-discovery.md](region-discovery.md#no-email-approval-flow-yet-cost-driven-not-a-design-gap).
- Writes land in Supabase (Postgres).
- **Decided:** the calendar shows an exhibition for its full run (start to
  end), not just an opening night — opening nights remain the most
  highlighted moment when confirmed, but their absence is no longer a
  reason to exclude an otherwise-real, currently-running exhibition (see
  [overview.md](overview.md)). Retention: **~1 year** past an exhibition's
  end date (revised from an original 1-month-past-opening figure). Schema
  migration for this, and the cleanup cron itself, are **not yet built** —
  planned for when Event Discovery's new design gets wired into production.
- **Shipped**: Next.js frontend (`apps/web`) showing the calendar, deployed
  on Vercel (Hobby) at `caldearte.com`, with a región-grouped city picker,
  and family-mode content filtering (defaults ON for first-time visitors,
  toggle to see everything) for `sensitivity_tags` content. Also shipped as
  part of the production-launch pass: a real contact form (Resend), a
  `/privacidad` page, RLS tightened to column-restricted views
  (`events_public`/`regions_public`), and IP-geolocation-based default city
  detection (own comuna → same región → Santiago if outside Chile).
- Still open within Phase 1a: the ~1-year retention/cleanup cron (schema
  migration + cron itself, not yet built — see below), and running a real
  manual audit of the curation policy against the production data that's
  now accumulated (flagged in [risks.md](risks.md)).

## Phase 1b — Inbound-mail flows

- Flow 1 (automatic opening-date inquiry) and Flow 2 (public mailbox for
  submitting openings), both over Resend inbound + webhook + Edge Function.
- Split from 1a because it adds real complexity (correlating replies by
  token, webhook signature verification, `ngrok` tunneling to test locally)
  that shouldn't block getting the core loop working and demonstrable first.

## Phase 1c — Expanding beyond Chile (superseded design, see below)

- **Superseded:** originally planned as automatic global expansion via a
  precalculated population/distance ranking, growing a venue list in the
  background. There is no venue list anymore, and the
  ranking/automatic-expansion machinery isn't in active use — see
  [region-discovery.md](region-discovery.md#ranking--expansion-superseded-kept-for-historical-reference).
  Expanding beyond Chile's 346-comuna weekly-batch rollout is planned as a
  manual, deliberate step once that rollout is validated at full scale,
  not an automatic background process — no rebuilt design exists yet for
  what comes after Chile.

## Phase 2 — Geo/temporal personalization

- Geocoding mechanism **not yet designed**: the original plan cached
  lat/lng once per venue on the (now-retired) `venues` table; with location
  as freeform text per event, there's no venue entity to cache coordinates
  against, and this needs a rethink before Phase 2 starts.
- PostGIS in Supabase to rank events by distance + days-until-event combined,
  based on the user's city.
- User city detection: **implemented and live** (2026-07-17) — see
  [architecture.md](architecture.md#user-city-detection).

## Phase 3 — Image pipeline, hardening

- Download and re-host images in Supabase Storage (don't depend on external
  URLs that break).
- General vision-based quality control on the chosen image before saving —
  beyond the Axis 5 explicit-aggression check (brought forward to Phase 1),
  this adds general validation that "this is actually the artwork/flyer, not
  a banner or logo."

## Phase 4 — Social distribution (Instagram / TikTok)

- Needs a new piece: flyer-style image generation (card with image + title +
  date + artist) per event.
- Instagram: Business/Creator account + Facebook Page + Meta developer app +
  `instagram_business_content_publish` permission via app review (2–4
  weeks).
- TikTok: Content Posting API, manual app review (2–6 weeks), posts stay
  private until passing audit, requires a demo video and privacy policy.
- Recommendation: submit for review only once the calendar already has real
  events running (better demo, better approval odds).

## Phase 5 — Parked / optional, doesn't block anything above

- Adopting Nx as a deliberate monorepo-tooling exercise, once the core is
  stable (retrofit with `npx nx init` over the pnpm workspace — no need to
  decide this now).
- Exploring monetization, only if there's organic traction.
