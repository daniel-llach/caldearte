# Caldearte — Architecture

## Stack

- **Monorepo:** lightweight pnpm workspace (`apps/web`, `apps/curator`,
  `packages/shared-types`, `packages/curation-policy`). Nx is deferred to
  Phase 5 as a deliberate later exercise, not needed now.
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
  [region-discovery.md](region-discovery.md). Claude Fable is a candidate for
  editorial copy (descriptions, captions) if a more literary voice is wanted
  later — not decided yet.
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
- **Geocoding:** Nominatim (OpenStreetMap), free, 1 req/sec, cached per venue.
- **Design:** two distinct tools, not one — see "Figma Make vs. the Figma
  MCP" below.

## Free-tier posture: upgrade reactively, not preemptively

Standing policy for all third-party services (Supabase, Vercel, Resend): stay
on the free tier by default, and upgrade only once an actual limit is hit in
production — not ahead of time based on projected growth.

This is deliberate, not neglect. On Vercel Hobby specifically, exceeding a
quota (e.g. image transformations) doesn't bill anything — it just degrades
that one feature gracefully until the next cycle, so there's no financial
risk in waiting for the real signal. Supabase's free tier auto-pauses a
project after 7 days with zero activity — worth watching for once Proceso
A/B are live and generating regular traffic, since that keeps the project
awake on its own.

If a real limit is hit: Vercel Pro is $20/month per seat and, at this
project's expected volume, its included usage credit alone covers roughly
50–80x the Hobby image-transformation cap before any additional overage — so
crossing into Pro, if it ever happens, is a small and predictable cost, not
an open-ended one.

The same "build visibility, don't pay ahead of need" philosophy governs
Anthropic API spend specifically — see
[region-discovery.md](region-discovery.md#cost-governance) for the
self-tracked $10/month ceiling.

## Figma Make vs. the Figma MCP — not the same tool

Two distinct products, worth not conflating before starting interface design:

- **Figma Make** (`figma.com/make`) takes a natural-language prompt and
  generates a full interactive interface (layout, components,
  interactions), editable and backed by real code. It's the right tool for
  quickly exploring 2–3 "cool" visual directions before committing to one —
  used directly in the browser, not through Claude Code.
- **The Figma MCP** connects Claude Code to actual Figma design files: either
  reading design context to generate code (`figma-design-to-code`), or
  writing native content to a Figma canvas from code/prompt using real
  design-system tokens and components (`figma-generate-design`). It is not
  "driving Figma Make from Claude Code" — these are separate workflows.

**Recommended workflow:** explore 2–3 directions in Figma Make directly
(fast, visual, no commitment to code), pick the preferred one, and bring it
into Claude Code with the `figma-design-to-code` skill to implement it as the
real Next.js app wired to Supabase data — rather than treating the Figma Make
output as the final product. The bridge between the two tools is manual: you
iterate in Figma Make yourself (Claude Code cannot operate Figma Make),
then hand the resulting Figma link to Claude Code.

**Fidelity isn't 1:1.** `get_design_context` reads static visual structure
well (layout, components, styles), but interactions/animations are a separate
layer that needs a distinct call (`get_motion_context`) and the
`figma-implement-motion` skill — it doesn't come across automatically, it has
to be requested explicitly per interactive element. Without that step, the
translation to code is visually faithful but "frozen." The interactivity
that matters most in Caldearte (family-mode toggle, city-based ranking,
conditional blur) is application logic against Supabase data, not Figma
animation — Claude Code builds that straight from the data model, regardless
of what Figma Make produces. What can get lost is visual choreography
(transitions, micro-interactions), not the product's functional behavior.

## Interaction ambition: 3D, not just polished transitions

The real target is 3D and higher-tier interaction, not just clean
transitions. Given that ambition: Figma and Figma Make are 2D canvas tools —
they aren't built for designing real WebGL/3D scenes, so their output
shouldn't be expected to deliver that layer. The direct path is for Claude
Code to build it straight in code:

- **3D:** `react-three-fiber` (Three.js for React) + `drei` (helpers), as an
  `apps/web` dependency — the standard choice for this in a Next.js stack.
- **Transitions/choreography:** Motion (formerly Framer Motion) for most
  interactions; GSAP if something needs more complex timeline choreography.
- **Figma Make's role here:** optional, useful only for resolving the 2D
  information architecture (what goes where in the general layout) before
  coding — not for the 3D or high-tier interactions, which are requested
  directly from Claude Code by description.

**Honest tension worth naming, not ignoring:** a well-built 3D interface is
substantially more engineering work than a flat calendar — mobile
performance, WebGL fallback, load time, accessibility. This is somewhat in
tension with the "runs itself with minimal maintenance" success criterion
from [overview.md](overview.md). That's not a reason to skip it — this is a
learning project and this falls squarely in that category — but it's worth
deciding deliberately, not by default. Concrete approach to avoid losing the
calendar's core usability (people scanning "what's opening near me today"):
concentrate the 3D/dramatic treatment in 1–2 high-weight moments (e.g. the
homepage hero, or the transition into an event's detail view), and keep the
actual scan/filter flow of the calendar fast and legible — not every
individual card is a 3D scene.

**Decided: mobile-first, not a desktop design adapted down.** Concrete
implications given everything above:

- 3D scenes must be lightweight (low poly count, no heavy post-processing)
  and code-split — the `react-three-fiber`/Three.js bundle shouldn't weigh
  down the calendar itself, which needs to render fast and be usable even
  before the 3D layer finishes loading (progressive enhancement, not a
  blocking dependency).
- Design interactions touch-first, not hover-first — there's no hover on
  mobile. The sensitivity-content blur-to-reveal (Layer 1) already fits this
  naturally: on mobile it was always going to be tap-to-reveal, no redesign
  needed.
- The family-mode toggle needs to be easy to find on mobile, not buried in a
  menu — worth reinforcing given the real use case (handing the phone to a
  family member) is literally a mobile scenario, not desktop.
- Mobile-optimized images: `next/image` with responsive sizes, WebP/AVIF —
  the product is inherently visual, so this isn't optional.
- Tailwind (already chosen for the stack) is mobile-first by design —
  unprefixed classes target mobile, breakpoints (`sm:`, `md:`, `lg:`) scale
  up from there. No extra friction from having picked Tailwind before this
  decision — it was already aligned.

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
