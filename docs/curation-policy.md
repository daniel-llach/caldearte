# Caldearte — Curation Policy (operational v2)

> **This file is the protected one.** Per `CLAUDE.md`, changes to this
> document need your review before merging — these are editorial decisions
> made by the two curators, not something to "improve" unilaterally.

Explicit, non-neutral editorial curation, defined by two people (the two
curators): default-exclude across five axes (religion, war/violence, far
right, pseudoscience/superstition, explicit physical/sexual aggression) plus
a venue filter, with an exception only for explicit critical stance. When the
model is unsure, it doesn't decide alone — it triggers the human-approval
email flow.

Product decision: this specific curatorial stance **is the value
proposition**, not something to hide. It's worth making explicit on the site
itself (e.g. an "About the curation" section) — see the live copy in
[figma-make-brief.md](figma-make-brief.md).

## Core rule: default-exclude, no middle ground

It doesn't matter whether the treatment has critical distance from an
aesthetic or "documentary/neutral" standpoint. Aesthetics are a product of
ethics — if the content doesn't convey values aligned with the curation, it's
excluded, no middle ground. The rule is **default-exclude**: any content with
religious, war-related, or far-right imagery or themes is excluded unless the
event takes an **explicit and unambiguous** critical stance against that
specific institution/ideology/conflict. "Half measures" (neutral
documentation, "exploring," "reflecting on," with no clear stance) don't
qualify — they're excluded just like affirmative content.

A fourth axis is added: **pseudoscience and superstition** (tarot, esotericism,
energy healing, and similar), also default-excluded. Buddhism is evaluated
case by case, with a more permissive standard than Christianity/Judaism, but
it's not automatically included.

## Classification examples by axis

| Event title | Short description | Axis | Decision | Why |
|---|---|---|---|---|
| "The Annunciation in Colonial-Era Painting" | A museum exhibit on Marian iconography in colonial painting, focused on technique and historical context. | Religion | **EXCLUDE** | Explicit Christian imagery. Historical/art-critical treatment doesn't qualify — it isn't criticism of the Church as an institution. |
| "A Night of Worship and Art for Christ" | A church hosts an evening of live painting, testimonials, and communal prayer. | Religion | **EXCLUDE** | Explicit evangelizing gathering. |
| "Church Inc.: A Critical Installation on Ecclesiastical Power and Money" | An installation denouncing the financial management of religious institutions, with an explicitly critical curatorial stance. | Religion | **INCLUDE** | Explicit stance against the Church as an institution, not a display of faith or its imagery. |
| "Eyes in the Trench: War Photojournalism 1936–1945" | A retrospective of war photographers, historical memory, and documentary archive, with no stated stance. | War/violence | **EXCLUDE** | "Neutral" documentation/memory doesn't qualify — missing an explicit critical stance against the war or period. |
| "After the Occupation: Art and Memory in Palestine" | An exhibit with an explicit curatorial statement denouncing the occupation and its consequences. | War/violence | **INCLUDE** | Explicit stance of denunciation/criticism, not neutral documentation. |
| "Tribute to Victory: The Heroic Feat" | An exhibit celebrating military glories of one side in a conflict, with a commemorative/exalting tone. | War/violence | **EXCLUDE** | Explicit glorification. |
| "Aesthetics of Fascism: Art, Propaganda, and Warning" | An exhibit displaying authoritarian-regime symbolism with "contextualizing" text, with no declared rejection. | Far right | **EXCLUDE** | Without an unambiguous, declared anti-fascist stance, it's excluded — "contextualizing" or "analyzing" without explicit rejection doesn't qualify. |
| "Gathering of National Identity Art" | An exhibit with the aesthetic of a recognized far-right movement, with no critical distance, calling to "reclaim values." | Far right | **EXCLUDE** | Promotes the ideology with no critical framing. |
| "Stations of the Cross: A Retrospective of [Religious Painter]" | A retrospective of an established artist, including religious Christian-themed work from one period of their career. | Religion | **EXCLUDE** | Explicit religious imagery, even in a recognized retrospective — excluded regardless. |
| "Vigil and Blessing of Images Ahead of the Pilgrimage" | A parish hosts a display of religious imagery as part of a devotional ritual. | Religion | **EXCLUDE** | An act of worship. |
| "Tarot, Cards, and Energy Healing: Exhibitor Fair" | A fair of tarot, energy reading, and esoteric-practice exhibitors. | Pseudoscience/superstition | **EXCLUDE** | Esoteric/pseudoscientific content with no critical framing. |

## Venue-type filter (independent of content)

Automatically excludes any event whose venue is: a church, temple, or seat of
any religious cult; the headquarters of a right-wing or far-right political
party; or, more generally, any establishment whose institutional profile
doesn't align with the curation's values. This filter is independent of the
content filter and **takes priority over it**: even if the event itself had
an explicit critical stance (e.g. the "Church Inc." example above), if the
venue where it opens is literally a temple or a party headquarters, it's
excluded anyway — the calendar's purpose isn't to drive visits to those
institutions.

The first two categories (temples, party headquarters) are enumerable and
can be auto-excluded with high confidence from the venue's name/address. The
third ("doesn't align with our values") isn't enumerable in advance, so the
model isn't asked to decide it alone: if the venue isn't recognizable as a
legitimate art/community space and doesn't clearly fit either hard-exclusion
category, the case escalates to human review instead of being auto-included
or auto-excluded.

**`art_space` explicitly, and enthusiastically, includes more than
traditional museums and galleries:** interventions/art in urban and street
spaces, cultural centers, community centers, and neighborhood associations.
A mural or a street intervention is exactly as valid as an opening at an
established gallery — the venue filter exists to exclude institutions
aligned with what the content policy rejects (temples, party headquarters),
not to restrict coverage to formal art circuits.

Data implication: `venues` carries a classification field
(`art_space` / `hard_excluded` / `needs_review`) resolved once per venue —
same as geocoding — not per event.

## Axis 5: explicit physical and sexual aggression (different from the other four)

Excludes any event whose visual content shows physical or sexual aggression
in an **explicit** way (graphic images of violence, sexual assault, gore) —
unlike the other four axes, here **denunciation intent does not enable
inclusion if the image is explicit**. Denunciation is included when handled
textually, thematically, or symbolically, without explicit imagery (e.g. an
exhibit on gender violence using non-graphic documentary photography,
testimonials, or symbolic work).

Important scope clarification, to avoid over-excluding: this axis is about
**aggression/violence**, not sexuality or nudity in general. Artistic nudity,
eroticism, or non-violent sexuality don't fall under this axis — they're a
normal part of the visual-art repertoire and aren't excluded by this
criterion. Worth stating explicitly in the prompt so the model doesn't
confuse "sexual content" in general with "explicit sexual aggression."

Architectural implication: this axis is the clearest use case for the vision
call already planned as optional Phase 3 hardening — that's where it's
actually possible to evaluate whether the chosen image is graphic, not just
whether "this is real art." Worth bringing that check forward to Phase 1 for
this specific axis (not for general image quality control), because here the
cost of a false negative — showing an explicit image on the calendar — is
higher than on the other axes, which are text-only.

## Operational instruction for Claude Haiku's system prompt

> Apply a default-exclusion policy across four axes: (1) religion — explicit
> religious imagery or themes, especially Christian or Jewish; Buddhism is
> evaluated case by case with a more permissive standard, but isn't
> automatically included; (2) war or extreme violence; (3) far right or
> authoritarian ideologies; (4) pseudoscience and superstition (tarot,
> esotericism, energy healing, and similar). For any of these four axes, the
> default decision is **EXCLUDE**. The only exception is when the event
> declares an **explicit and unambiguous** critical stance against that
> specific institution, ideology, or conflict — for example, an installation
> that explicitly denounces the Church's economic power, or an exhibit with
> an explicit curatorial statement denouncing an occupation or a
> dictatorship. "Exploring," "reflecting on," "contextualizing,"
> "documenting," or showing ambiguous aesthetic/curatorial distance isn't
> enough — without an explicit, declared rejection stance, the event is
> excluded. There's no middle ground: either the event explicitly criticizes
> the institution/ideology/conflict, or it's excluded, regardless of
> artistic quality or the venue's prestige.
>
> Also apply a fifth axis, independent of the logic above: exclude any event
> whose image shows physical or sexual aggression explicitly (graphic
> violence, sexual assault, gore), regardless of whether the event has
> denunciation intent — denunciation only enables inclusion when expressed
> textually, thematically, or symbolically, not through explicit imagery.
> This axis is about explicit aggression/violence, not sexuality or nudity in
> general: artistic nudity, eroticism, or non-violent sexuality aren't
> excluded by this criterion.

*Implementation note: this system prompt is presented here in English for
documentation consistency, but the actual code (once Proceso A/B are built)
can implement it in either English or Spanish — Claude handles both equally
well when evaluating Spanish-language event descriptions. That's an
implementation detail to decide when the curator code is written, not a
constraint set by this document.*

## Signals that trigger mandatory human escalation

- The event appears to meet the exception (explicit critical stance) but the
  text isn't clear enough to confirm the rejection is unambiguous and not
  just "contextualization" or aesthetic distance.
- Insufficient context: a very short description, no image, or curatorial
  text that doesn't allow determining whether there's an explicit stance.
- The event mixes axes (e.g. explicit criticism of a dictatorship that also
  uses religious symbolism) and it isn't obvious how to weigh each one.
- Cases involving Buddhism or other non-Christian/non-Jewish traditions,
  where it's unclear whether the more permissive standard applies.
- A venue that isn't recognizable as an established art space and doesn't
  clearly fit the hard-exclusion categories (temple, party headquarters) —
  not auto-decided, escalated.
- It's unclear whether an image is "explicit" or is non-graphic artistic
  treatment of a violence/aggression theme — escalate rather than decide with
  low confidence, given the high cost of a false negative on this axis.
- Any case where the model itself detects low confidence in its
  classification — it should escalate rather than force a binary decision.
