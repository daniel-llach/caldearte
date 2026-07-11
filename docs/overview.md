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

### Opening nights only, not exhibitions already running

The calendar exists to capture the one moment where artist, work, and
audience intersect — the opening night, not the exhibition run as a whole.

- If the opening date has already passed by scrape time, the candidate is
  discarded outright — it is never added.
- An added event stays visible until 7 days after its opening date, then it
  is deleted from the database — not archived. The calendar should always
  feel alive and in motion, not like a historical record.
  - Architectural implication: a second daily cron job (separate from the
    scraping cron) deletes `events` rows more than 7 days past
    `opening_datetime`. It's a single lightweight `DELETE` query.
- Schema implication: the date field is explicitly named `opening_datetime`
  (date **and** time of the opening), not a generic `event_date` — many
  sources only give an exhibition date range ("July 10 – August 30") without
  distinguishing the opening night. When a source gives an explicit opening
  time, that's used with high confidence (`opening_date_confidence = 'alta'`);
  when only a range is given, the start date is used as a proxy with low
  confidence (`'baja'`) — a candidate for escalation when there's no
  certainty the range's start date is actually the opening night.

### What counts as art

**Included — traditional media:** drawing, painting, sculpture, printmaking,
and other traditional visual-art media.

**Included — non-traditional artistic interventions:** performance,
happening, graffiti, and interventions that use dance, the body, or musical
instruments **as part of an artistic intervention/happening** — not as a
conventional format.

**Explicitly excluded**, even when using the same elements: dance in its
traditional format/venue (a dance performance in a theater or dance hall),
and conventional concerts/shows. The distinguishing test isn't the medium
(dance, music) — it's the format: is this an artistic
intervention/happening, or a conventional performance/show in its usual
circuit? The former is in scope, the latter isn't, even when they share
elements (body, instruments) with what *is* accepted.

Ambiguous cases (is this performance art, or essentially a concert with
visual elements?) escalate to human review — this isn't a distinction worth
forcing automatically without clear evidence.

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
