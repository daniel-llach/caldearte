# Caldearte — Architecture

## Stack

- **Monorepo:** lightweight pnpm workspace (`apps/web`, `apps/curator`,
  `packages/shared-types`, `packages/curation-policy`).
- **Frontend:** Next.js on Vercel Hobby (free; non-commercial use only — see
  "Free-tier posture" below).
- **Backend/data:** Supabase (Postgres + PostGIS + Storage + Edge Functions),
  free tier while volume stays low.
- **Automation:** GitHub Actions (public repo, standard runners are free and
  unlimited) for the curator's cron jobs.
- **AI:** Claude Haiku 4.5 via the Anthropic API for all curation — text
  axes, image selection, and the Axis 5 vision check — across both Event
  Discovery and the Event Crawler. Originally Sonnet was used for Event
  Discovery on the assumption bigger-model judgment was needed there; real
  side-by-side testing showed Haiku reaching identical classification
  decisions at roughly a quarter of the cost — see
  [region-discovery.md](region-discovery.md).
- **Search:** Tavily (a separate, LLM-oriented search API), not Anthropic's
  own `web_search` tool — a deliberate reversal of the original "no separate
  search service like SerpAPI" stance below. Real comparison showed
  Anthropic's `web_search` returning mostly title/URL with no real content
  and missing social-media coverage entirely, both of which matter directly
  for finding informal/street art events — see
  [region-discovery.md](region-discovery.md) for the full comparison and
  cost data.
- **Email:** Resend (free tier, 3,000/month) for approval and inbound-mail
  flows (Phase 1b).
- **Geocoding:** Nominatim (OpenStreetMap), free, 1 req/sec. Caching
  mechanism not yet designed — see [roadmap.md](roadmap.md#phase-2--geotemporal-personalization).

## Free-tier posture: upgrade reactively, not preemptively

Standing policy for all third-party services (Supabase, Vercel, Resend): stay
on the free tier by default, and upgrade only once an actual limit is hit in
production — not ahead of time based on projected growth.

If a real limit is hit: Vercel Pro is $20/month per seat and, at this
project's expected volume, its included usage credit alone covers roughly
50–80x the Hobby image-transformation cap before any additional overage — so
crossing into Pro, if it ever happens, is a small and predictable cost, not
an open-ended one.

The same "build visibility, don't pay ahead of need" philosophy governs
Anthropic API spend specifically — see
[region-discovery.md](region-discovery.md#cost-governance) for the
self-tracked $10/month ceiling.

## User city detection

**Chosen approach: Vercel's native IP geolocation as a silent default (SSR) +
a manual city selector as a cookie-persisted override. The Browser
Geolocation API is an optional enhancement, not the default.**

Key finding: Vercel injects IP-geolocation headers (`x-vercel-ip-city`,
country, region, approximate lat/lng) on every request to Vercel
Functions/Edge Middleware, for free, with no external service call, available
in SSR — the `@vercel/functions` package exposes them via
`geolocation(request)`. This makes contracting a third-party IP-geolocation
service unnecessary: the ones evaluated (ipapi.co, ipinfo.io) are either not
production-viable on their free tier, or their free tier only gives
country-level precision, not city. Limitation to keep in mind: doesn't work
on `localhost` in development.

Proposed flow:

1. Next.js middleware reads the IP-based city on every request; if there's
   no `caldearte_city` cookie yet, it sets one with that value — this allows
   ordering events by distance+time from the very first render, with no JS
   and no permission prompt.
2. A manual city selector, always visible in the header, overwrites the
   cookie and takes precedence over IP on future visits — covers the cases
   where IP fails (VPN, mobile network, local dev) and gives the user
   control.
3. Browser Geolocation API as an optional action ("Use my exact location"),
   not automatic — asking for permission on the first visit is unjustified
   friction for an art calendar, and a good share of users would decline it.
4. Fallback with no cookie/header/choice: a reasonable default city (e.g.
   Santiago) or an unordered list with a banner inviting the user to pick a
   city.
5. One line in the privacy policy explaining IP-based city inference,
   without tying it to an account or storing it beyond the preference
   cookie.

Sources: [Vercel — geolocation IP headers](https://vercel.com/kb/guide/geo-ip-headers-geolocation-vercel-functions), [ipapi.co pricing](https://ipapi.co/pricing/), [IPinfo pricing](https://ipinfo.io/pricing), [IPinfo Lite](https://ipinfo.io/lite).
