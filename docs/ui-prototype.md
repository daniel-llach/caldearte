# Caldearte — Interface Prototype Description

> Context document for `caldearte-mockup.jsx`, an interactive prototype
> (React + Tailwind) explored in Cowork before real construction started.

**Historical — the shipped app (`apps/web`, live at caldearte.com since
2026-07-17/18) has diverged from several specifics described below.** Read
this for the design-exploration history and the parts that DID ship
(the `ResizeObserver`-based responsive approach, family-mode filtering),
not as documentation of current behavior. Concrete divergences:
- No today/week/month/year tabs — the shipped app only ever shows "today,"
  split into two fixed sections (Inauguraciones / Exposiciones Actuales).
- Column count is 1 (mobile) / 2 (desktop), not 1/2/3 — no 3-column tier
  was built.
- Cards show title/venue/period text under the image, not "image only" as
  originally decided here.
- No slide-in/side-panel detail view — cards link out externally to the
  source URL instead.
- The mobile menu's Curatoria entry links to `/privacidad` directly, not
  an in-drawer curation view.
See `apps/web/src/components/CalendarView.tsx`, `CityPickerPanel.tsx`, and
`EventCardBase.tsx` for what actually shipped.

## What it is and isn't

It's a **behavior and interaction** prototype, not the final component. It
validates layout, navigation, and state decisions before the real Next.js app
gets written. Several things are deliberately simplified because this is a
mockup, not the product:

- Artwork images are flat color blocks, not real photos.
- The data (`CITIES`) is hardcoded in the component, not sourced from
  Supabase.
- "Family mode" and the chosen city don't persist in a cookie — they reset
  on reload.
- No real geolocation or PostGIS — the proximity/time ranking defined in
  [architecture.md](architecture.md#user-city-detection) and
  [roadmap.md](roadmap.md#phase-2--geotemporal-personalization) isn't
  implemented here yet; this is just the list grouped by date.

## Interface structure

**Header:** "CALDEARTE" logo in uppercase, high-contrast serif typography.
Hamburger menu icon on the right, opens the drawer.

**City selector:** pin + city name + chevron (`lucide-react` icons, not
emoji). Tapping it drops a panel down from the top (`fixed`, not
`absolute` — important, see the technical note below) with the list of
available cities.

**Time filters:** four tabs — today, this week, this month, this year. The
first three group events by exact day (date + weekday as the header). The
"this year" tab groups by month instead of by day — it bundles all of a
given month's thumbnails under a single header ("July 2026"), without
subdividing by date.

**Day/month grid:** responsive by column count — 1 column on mobile, 2 on
tablet, 3 on desktop. The column breakpoint is computed by measuring the
container's actual width with `ResizeObserver`, instead of relying on
Tailwind breakpoints (`sm:`/`md:`/`lg:`), because those breakpoints react to
the browser viewport's width, not the width of the container the component
actually lives in — in a layout with panels/columns that produces incorrect
results. Recommendation for future work: keep this container-measuring
approach if the real layout can also live at different column widths — don't
assume Tailwind breakpoints alone are enough.

**Thumbnails:** image only, no overlaid title or description — an explicit
design decision. The one exception is the "sensitive" label in the corner,
for events with `sensitivity_tags`, because that's safety information, not
decoration.

**Detail view:** tapping a thumbnail — on mobile/tablet, replaces the full
screen with a slide-in transition from the right and a back arrow; on
desktop (3-column layout), shows as a fixed side panel, always visible, no
transition or overlay. This is the only moment with an agreed "premium"
interaction treatment — the rest of the flow stays fast and frictionless.

**Menu drawer (from the right):** two views — the menu itself, with a link
to "Curation" (copy already drafted, see
[figma-make-brief.md](figma-make-brief.md)) and the "family mode" switch;
and the curation view itself, with a back arrow to the menu.

**Empty states, cascading logic:** if the selected period (today/week/month/
year) has no events, the next future event in that city's full dataset is
looked up:
- If one exists: "No openings [period] in [city]. The next one is on
  [date] — [title]" + a button to jump to that date.
- If none exists at all (a city with no events yet, e.g. a region just added
  by Venue Discovery with no results yet): "We don't have any openings for [city]
  yet. Know one we should add?" + a contact button — this should connect to
  the public mailbox (Flow 2) on the backend.

## Technical notes for future implementation

- Overlapping panels (city selector, menu drawer) use `position: fixed`, not
  `absolute` — with `absolute` they ended up constrained to the height of
  the card's content instead of covering the full viewport. If this pattern
  gets carried into production, confirm the real Next.js layout doesn't have
  another overflow container that would constrain the `fixed` positioning
  again.
- In the Cowork artifacts sandbox, arbitrary Tailwind colors (`bg-[#FBFAF6]`)
  don't work because there's no Tailwind compiler there, only predefined
  classes — that's why the mockup uses `bg-stone-50` instead of a custom
  hex. **This is a sandbox-specific limitation, not a real Next.js + compiled
  Tailwind constraint** — in the real app, if an exact tone outside the
  default palette is preferred, it can be defined as a custom color in the
  Tailwind config with no issue. No need to carry this restriction into the
  real app.
- Icons: `lucide-react` (location pin, chevron). The mockup's other icons
  (☰, ←, ✕) are still plain text — worth unifying everything to
  `lucide-react` in the real implementation for visual consistency.

## Palette and typography used in the mockup

- Primary background: `stone-50` (warm white, not pure white, not black) —
  aligned with the "white cube" gallery reference discussed in
  [architecture.md](architecture.md).
- Text: `stone-400` to `stone-900` grayscale.
- "Artwork" placeholder blocks: flat colors from Tailwind's core palette
  (`orange-200`, `purple-200`, `green-200`, etc.) — replace with real images
  re-hosted in Supabase Storage (see
  [roadmap.md](roadmap.md#phase-3--image-pipeline-hardening)).
- Logo: `font-serif font-bold`, uppercase, wide tracking — a modern-art-museum
  identity direction, already discussed in [architecture.md](architecture.md).
