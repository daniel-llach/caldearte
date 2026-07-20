// Shared verbatim policy text, used by event-discovery/discover.ts
// (search-based discovery, full curation applied at find-time). Single
// source so it doesn't drift out of sync with docs/curation-policy.md
// and docs/overview.md.

// Mirrors docs/overview.md's "What counts as art" section, ported
// verbatim — this is the scope filter, applied BEFORE the exclusion axes
// below. First version only excluded "conventional concerts/shows" and
// still let theater plays through (a real pilot run captured 4 of them at
// Matucana 100) — rewritten after user clarification to explicitly exclude
// theater/concerts/gigs and to actually recognize a genuine artistic
// intervention, not just "not a concert."
// Real bug (found 2026-07-20, via a user-requested Event Discovery audit):
// this used to tell Haiku to use "pending_review" for ambiguous
// scope calls — but Event Discovery's status is strictly binary
// (approved/rejected; see docs/overview.md's "Ambiguous cases... not
// built"). "pending_review" was never a real option in the actual JSON
// schema (discover.ts's buildSystemPrompt), so that instruction was
// unsatisfiable — Haiku had to pick approved or rejected anyway with no
// real guidance for the ambiguous case, which likely contributed to real
// scope-creep approvals found in the same audit: "Conversatorio Quebrada
// Honda" and "Catastro Arte Público Constitución" (both literally panel
// talks/"conversatorios," approved with reasoning stretching them into
// "intervención artística participativa"). Fixed to explicitly say
// "reject" for the ambiguous case, consistent with the default-exclude
// philosophy the four content axes already use ("no middle ground"), and
// to name "conversatorios"/generic cultural-day activities as their own
// explicit exclusion — the same class of mistake, but not really an
// "ambiguous artistic intervention" call at all: a panel discussion is
// just not a visual-art exhibition or a performance staged as an artistic
// gesture, regardless of how it's framed.
export const ART_SCOPE_POLICY = `Before applying the exclusion axes below, first confirm this event is actually in scope for an art-opening calendar. Included — visual/plastic art exhibitions: painting, drawing, sculpture, printmaking, installations (sound, tactile, or otherwise), and similar visual-art media shown as an exhibition. Included — genuine artistic interventions: a performance or happening staged specifically as an artistic gesture, not as a conventional show — for example a street performance blending dance and theater as a single artistic intervention, an artist inhabiting a public installation, a mass nude-portrait photography event, or a nude-body walk as performance art. Explicitly excluded, regardless of venue prestige or setting: conventional theater plays (in their usual theater format), concerts, gigs ("tocatas"), and dance performances in their traditional format/venue — even at a legitimate cultural center that also hosts real exhibitions. Also explicitly excluded: conversatorios, charlas, mesas redondas, or presentaciones de libros (a discussion or talk is not a visual-art exhibition or a performance staged as an artistic gesture, even when it's about art, has musical accompaniment, or is framed as "participatory"), and generic cultural/heritage days or community festivals ("Día de los Patrimonios," "Fiesta a la Chilena," and similar) unless the specific activity being reported is itself a visual-art exhibition or genuine artistic intervention, not just one activity among many at a broader cultural event. The test is the format, not the medium or the venue: is this a genuine artistic intervention or a visual-art exhibition, or is it a conventional performing-arts show, talk, or generic cultural gathering being staged as usual? The latter is out of scope even when it shares elements (body, music, dance, "art") with what is accepted. If it's ambiguous whether something is a genuine artistic intervention or essentially a themed concert/show/talk with visual elements, reject it — status is strictly binary (approved/rejected), there is no intermediate review tier, so treat scope ambiguity the same default-exclude way the content axes below already do: no middle ground. If it's clearly a conventional theater play, concert, gig, talk, or show with no artistic-intervention framing, use "rejected" — out of scope, not merely low-priority.`;

// Mirrors docs/curation-policy.md's "Operational instruction for Claude
// Haiku's system prompt" block, ported verbatim — kept in sync with that
// doc, not re-derived independently. Axes 1-4 only; axis 5 is separate
// (see VISION_AXIS5_POLICY) because it needs the actual image, not text.
export const TEXT_CURATION_POLICY = `Apply a default-exclusion policy across four axes: (1) religion — explicit religious imagery or themes, especially Christian or Jewish; Buddhism is evaluated case by case with a more permissive standard, but isn't automatically included; (2) war or extreme violence; (3) far right or authoritarian ideologies; (4) pseudoscience and superstition (tarot, esotericism, energy healing, and similar). For any of these four axes, the default decision is EXCLUDE. The only exception is when the event declares an explicit and unambiguous critical stance against that specific institution, ideology, or conflict — for example, an installation that explicitly denounces the Church's economic power, or an exhibit with an explicit curatorial statement denouncing an occupation or a dictatorship. "Exploring," "reflecting on," "contextualizing," "documenting," or showing ambiguous aesthetic/curatorial distance isn't enough — without an explicit, declared rejection stance, the event is excluded. There's no middle ground: either the event explicitly criticizes the institution/ideology/conflict, or it's excluded, regardless of artistic quality or the venue's prestige.`;

export const VISION_AXIS5_POLICY = `Apply a fifth axis, independent of the four above: exclude any event whose image shows physical or sexual aggression explicitly (graphic violence, sexual assault, gore), regardless of whether the event has denunciation intent — denunciation only enables inclusion when expressed textually, thematically, or symbolically, not through explicit imagery. This axis is about explicit aggression/violence, not sexuality or nudity in general: artistic nudity, eroticism, or non-violent sexuality aren't excluded by this criterion. If the image is not graphic/explicit under this definition, respond with exactly APPROVE. If it is, respond with exactly REJECT.`;

// Institutional exclusion, independent of the axes above. Previously
// enforced via a separate per-venue classification step (the Event
// Crawler's venue filter, now retired along with the venues table) — Event
// Discovery has no venue entity, so this is judged directly from the
// source text during curation instead.
export const INSTITUTIONAL_EXCLUSION_POLICY = `Independent of and prior to the axes above: if the event's venue/location is explicitly identifiable as a church, temple, or house of worship of any religious cult, or the headquarters of a right-wing or far-right political party, reject it regardless of the event's own content or any critical stance it claims — the calendar's purpose isn't to drive visits to those institutions. This only applies when the institutional nature is explicit and unambiguous (the venue's own name or the source text states it plainly) — don't infer it from indirect signals, and don't let it override an otherwise-clear approval when the institutional nature is merely ambiguous.`;
