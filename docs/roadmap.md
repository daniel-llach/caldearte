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
  **Neither half is built**, and real production data (2026-07-18: 271
  total events, 163 approved, 106 rejected, 2 `pending_review` — those 2
  are stale rows from 2026-07-16, before the binary-only design, not live
  escalations) shows Haiku's binary approve/reject call isn't leaving
  anything genuinely stuck in the middle. **Likely not worth building** —
  keep as a parked idea, not an active line item, unless real ambiguous
  cases start showing up as the comuna rollout scales past its current
  ramp-up. See
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

Two distinct flows, both needing Resend's *inbound* email (someone emails
*us* and our backend reacts), not just outbound sending like the
`/contacto` form already ships:

- **Flow 1 — automatic opening-date inquiry**: when Event Discovery finds
  an event with no confirmed date/time, auto-email the source (venue,
  gallery) asking them to confirm it, then parse their reply and update
  the row. Needs a unique token per outbound email so an inbound reply can
  be matched back to the right event, a webhook endpoint to receive
  Resend's "new email arrived" callback, and signature verification on
  that webhook (so a spoofed request can't get treated as a real reply).
- **Flow 2 — public submission mailbox**: a dedicated email address
  anyone can write to about an event we're missing, parsed and turned into
  a real `pending_review`-ish row automatically. **Partly superseded
  already**: the `/contacto` form shipped 2026-07-17/18 covers the same
  underlying need (a visitor telling us about something) with a much
  simpler outbound-only relay — no inbound parsing, no reply-correlation.
  Worth deciding whether Flow 2 specifically is still needed, or whether
  `/contacto` is "good enough" and only Flow 1 remains a real gap.
- Both were split from 1a specifically because of that inbound-email
  complexity (token correlation, webhook signature verification, `ngrok`
  to receive real webhook calls during local dev) — none of that was
  worth blocking the simpler core loop (scrape → curate → display) on.

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

## Phase 2 — Geo/temporal personalization (low priority, pending real signal)

- User city detection: **implemented and live** (2026-07-17) — comuna
  selection (manual + auto-detected) already covers most of the practical
  need this phase was meant to solve.
- PostGIS-based distance ranking on top of that would be a marginal
  refinement, not a missing essential — deprioritized until there's a real
  usage signal it's actually needed (e.g. users in a large región
  complaining events far within their own comuna's región feel
  undifferentiated).
- Geocoding mechanism also **not yet designed**: the original plan cached
  lat/lng once per venue on the (now-retired) `venues` table; with location
  as freeform text per event, there's no venue entity to cache coordinates
  against, and this needs a rethink if this phase is ever picked back up.

## Phase 3 — Image pipeline, hardening

- Download and re-host images in Supabase Storage (don't depend on external
  URLs that break). **Still worth doing, lower urgency than originally
  framed**: the ~1-year retention policy and "stop showing past-date
  events" behavior shrink the exposure window, but don't eliminate the
  underlying risk — a source image can still change or break while an
  exhibition is actively showing (weeks to months, not just a single day),
  and there's a separate reliability/security angle (hotlinking external
  URLs with no control over what they later serve) already flagged in
  [risks.md](risks.md), independent of how long we retain the row.
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

- Exploring monetization, only if there's organic traction.
