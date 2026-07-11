# Caldearte — Roadmap

## Current status: Phase 1a, in progress

Done: pnpm workspace, core schema deployed to production
(`regions`/`venues`/`events`), auto-deploy pipeline for migrations
(`deploy-migrations.yml`), Chile's initial regions seeded, cost-governance
system shipped (`system_config`/`api_usage_log`, budget ceiling, region cap,
change-detection foundation).

Not yet built: Proceso A (discovery) and Proceso B (crawl) business logic
itself — see [region-discovery.md](region-discovery.md) for the design both
will implement against. Frontend (`apps/web`) hasn't been started.

## Phase 0 — Definition (complete)

Closed out the initial project brief, moved into a dedicated repo.

## Phase 1a — Core loop (no inbound-mail flows yet)

- First Proceso A run scoped to **all of Chile** (several active regions,
  weekly from day one) instead of hand-seeding venues — see
  [region-discovery.md](region-discovery.md) for the full expansion-ranking
  and saturation logic.
- Daily GitHub Actions cron walks the already-discovered venues (Proceso B /
  "crawl").
- A deterministic scraper extracts HTML + image candidates
  (`<img src/alt/dimensions>`).
- Claude Haiku 4.5 evaluates each candidate event against the five curation
  axes + venue filter (text), picks the featured image, and runs the Axis 5
  vision check (explicit aggression) plus `sensitivity_tags` tagging.
- Ambiguous cases → an email with two buttons (include/don't include) via a
  Supabase Edge Function with a one-time-use token.
- Writes land in Supabase (Postgres).
- An additional daily cleanup cron deletes events more than 7 days past
  `opening_datetime`.
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

## Phase 1c — Proceso A, venue discovery at scale

- Not blocking for 1a/1b — grows the venue list in the background, at a
  lower frequency than the daily crawl. This is where the full global
  population/distance ranking (beyond Chile's initial bootstrap) gets
  built out — see [region-discovery.md](region-discovery.md).

## Phase 2 — Geo/temporal personalization

- `venues` table with geocoded lat/lng (Nominatim, once per venue).
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
