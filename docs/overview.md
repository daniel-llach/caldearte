# Caldearte — Overview

## Vision

Caldearte is a free, publicly accessible calendar of art opening nights —
galleries, museums, cultural centers, community spaces, and street
interventions. It is maintained through automation (GitHub Actions + the
Claude API + Supabase) to minimize the ongoing manual-operation cost that
caused an earlier version of this project to be abandoned after 10+ years.

**Primary goal:** a technical learning project (monorepo tooling, LLM agents,
geospatial ranking, publishing APIs) that incidentally delivers real value
(making opening nights discoverable). The project is free by design.
Monetization is left open as a future option, not a starting objective — this
avoids repeating the earlier version's failure mode (it was abandoned for
lack of maintenance time, not lack of monetization).

**Explicit scope constraint:** growth-for-monetization is not a priority.
Success is defined as: the system runs itself with minimal maintenance, *and*
there is real learning along the way.

## What counts as a valid event

### The full exhibition run, with openings as the star (revised — was "openings only")

**Decision, superseding the original "opening nights only" design**: Caldearte
is a calendar of art, not exclusively of opening nights. An exhibition is
shown for its **entire run** — from the day it starts to the day it ends —
not discarded just because its opening has already passed. Opening nights
remain the most valuable, most highlighted moment when one is known (that's
still what makes an event "a star" in the UI), but their absence or passing
is no longer a reason to exclude an otherwise-real, currently-running
exhibition. This directly reverses the original policy below, after the
project's real search data (Tavily + Haiku, see
[region-discovery.md](region-discovery.md)) showed the majority of real,
legitimate exhibitions found don't have an explicit, confirmed opening-night
date/time at all — only a run's start and end dates. Discarding those would
have discarded most of what's actually out there.

- A candidate is discarded only if its run has **already fully ended**
  before the current month (see the region-discovery.md date rule) — not
  merely because its opening, if any, already passed.
- **Retention: ~1 year**, not 1 month (revised from the original 1-month
  figure, itself a revision from an initial 7-day figure). Storage cost for
  this is negligible at this project's scale (a few hundred bytes of text
  per event) — the real reason for the earlier short retention wasn't
  storage, it was "the calendar should feel alive," which no longer applies
  once the calendar is showing full runs rather than only fresh openings.
  - Architectural implication: a cleanup cron (still not built) should
    delete `events` rows roughly a year past their run's end, not their
    opening date.
- Schema implication: an event needs its run's start and end dates as two
  separate fields (`runStartDate`/`runEndDate` in the current design,
  distinct from the exhibition's overall duration), plus a separate,
  independently-nullable `openingDatetime` (date **and** time) that's only
  populated when a source explicitly confirms a real opening night — no
  longer a "confidence" flag on a single overloaded date field
  (`opening_date_confidence`, the original approach), since the run's own
  start/end dates now carry that information directly instead of being
  inferred as a low-confidence proxy for an opening.

### What counts as art

**Included — visual/plastic art exhibitions:** painting, drawing, sculpture,
printmaking, installations (sound, tactile, or otherwise), and similar
visual-art media, shown as an exhibition. Captured as **openings**
(`opening_datetime` = the exhibition's inauguration).

**Included — genuine artistic interventions:** a performance or happening
staged specifically as an artistic gesture, not as a conventional show —
e.g. a street performance blending dance and theater as a single artistic
intervention, an artist inhabiting a public installation (a glass box on a
rooftop), a mass nude-portrait photography event, a nude-body walk as
performance art. Captured as **presentations** (still populate
`opening_datetime`, framed as the intervention's first/only appearance
rather than an "opening night" in the exhibition sense).

**Explicitly excluded, regardless of venue prestige or setting**:
conventional theater plays (in their usual theater format), concerts, gigs
("tocatas"), and dance performances in their traditional format/venue —
even at a legitimate cultural center that also hosts real exhibitions. The
test is the format, not the medium or the venue: is this a genuine artistic
intervention or a visual-art exhibition, or is it a conventional
performing-arts show being staged as usual? The latter is out of scope even
when it shares elements (body, music, dance) with what *is* accepted.

Ambiguous cases (is this a genuine artistic intervention, or essentially a
themed concert/show with visual elements?) escalate to human review — this
isn't a distinction worth forcing automatically without clear evidence.

## Content sensitivity (distinct from curation)

This is separate from the curation filter (which decides what enters the
calendar at all): it's an exposure control for site visitors, for content
that *did* pass curation but may not be suitable for every viewer/age —
nudity/eroticism, war/violence (including legitimate denunciation, which is
included in the calendar but still warrants a visual notice),
memory/dictatorship themes.

**Layer 1 — blur by default (baseline behavior, no configuration needed).**
Events tagged with a sensitivity flag show with the image blurred and an
overlay ("Sensitive content: nudity/eroticism" / "Memory and dictatorship");
anyone who wants to see it clicks to reveal. It's opt-in to view, not opt-out
to hide — the minimal friction already filters accidental clicks. Applies to
every new visitor with zero configuration required.

**Layer 2 — "family mode" (explicit toggle).** Instead of blurring, this
hides sensitivity-tagged events entirely from the grid — zero exposure, no
overlay. Stored in a cookie (same mechanism as the city preference), so it
applies from the very first server render, with no flash of content before
client JS loads.

**Honest limitation:** this is a per-device preference/parental control, not
real age verification — there are no accounts or login in the MVP, so there's
no way to actually "know" who's looking. It's a cookie, not a guarantee.

**Implementation cost: marginal, not a new call.** Sensitivity tagging
(`sensitivity_tags`) is added as extra output on the same Haiku call that
already evaluates the five curation axes, and on the vision call already
planned for Axis 5 (explicit aggression) — no separate pipeline pass is
needed.

Schema implication: `events.sensitivity_tags` (array:
`desnudo_erotismo` | `guerra_violencia` | `memoria_dictadura`, can hold more
than one). Added in Phase 1 alongside the rest of the curation tagging, given
the marginal cost — no reason to defer it if the call is already being paid
for.
