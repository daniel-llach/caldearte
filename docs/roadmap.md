# Caldearte — Roadmap

## Current status: Phase 1a, in progress

Done: pnpm workspace, core schema deployed to production
(`regions`/`events`), auto-deploy pipeline for migrations
(`deploy-migrations.yml`), Chile's initial regions seeded, cost-governance
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
deprecated. Frontend (`apps/web`) hasn't been started.

## Phase 0 — Definition (complete)

Closed out the initial project brief, moved into a dedicated repo.

## Phase 1a — Core loop (no inbound-mail flows yet)

- Event Discovery scoped to a fixed, hand-curated list of Chilean units
  (~50 cities plus Gran Santiago/Valparaíso/Concepción split by comuna,
  ~100 total) on a simple fixed monthly cadence — **decided, list not yet
  built**, deferred until the mechanisms below are fully wired into
  production (see [region-discovery.md](region-discovery.md)). This
  replaces the original weekly/saturation/automatic-expansion design,
  which is no longer planned.
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
- **★ Everything above can be built and tested with zero product/design
  decisions resolved** — verified by looking directly at the Supabase table
  (Studio or a query), no interface needed to confirm the scraper, curation,
  and cleanup work correctly. Product/interface design doesn't block any of
  this.
- **This part is blocking: product/interface design**, resolved before
  `apps/web` gets written — without it, any frontend code written is
  throwaway, not a real starting point. See
  [architecture.md](architecture.md#figma-make-vs-the-figma-mcp--not-the-same-tool)
  and [ui-prototype.md](ui-prototype.md) for the design workflow and the
  interactive prototype already explored.
- Next.js frontend showing the calendar per the resolved design, deployed on
  Vercel (Hobby), with blur-by-default + "family mode" toggle for
  `sensitivity_tags` content.

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
  Expanding beyond Chile's ~100-unit list is planned as a manual, deliberate
  step once that list is live and validated, not an automatic background
  process — no rebuilt design exists yet for what comes after Chile.

## Phase 2 — Geo/temporal personalization

- Geocoding mechanism **not yet designed**: the original plan cached
  lat/lng once per venue on the (now-retired) `venues` table; with location
  as freeform text per event, there's no venue entity to cache coordinates
  against, and this needs a rethink before Phase 2 starts.
- PostGIS in Supabase to rank events by distance + days-until-event combined,
  based on the user's city.
- User city detection: **decided** — see
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
