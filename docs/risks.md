# Caldearte — Risks & Assumptions to Validate Before Writing Code

1. **Not every source will have an RSS feed or public calendar** — some
   require direct scraping, with the ToS risk that implies (particular care
   needed with social media). This risk is sharper because the scope
   deliberately includes community centers, neighborhood associations, and
   street interventions: it's unlikely they'll have their own website or
   RSS, and very likely their only distribution channel is a Facebook/
   Instagram account or a WhatsApp group — this needs mapping in Phase 1,
   not assuming the museum/gallery flow (which has institutional websites)
   represents the rest of the sources.
2. **Vercel Hobby prohibits commercial use** — if monetization is ever
   decided on, the plan needs to change first, not after. See
   [architecture.md](architecture.md#free-tier-posture-upgrade-reactively-not-preemptively).
3. **Phase 4 (social media) depends on having real content running first** —
   there's no point submitting for app review with an empty demo.
4. **The curation policy is defined with examples and an operational prompt,
   but hasn't been tested against real cases yet** — worth running a manual
   test batch before trusting the automatic classification.
