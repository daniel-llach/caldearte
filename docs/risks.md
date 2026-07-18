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
2. **Vercel Hobby prohibits commercial use** — sharper as of the
   production-launch pass (2026-07-17): the project is now confirmed
   commercial (built under Probable SPA). **Explicit, deliberate call, not
   an oversight**: staying on Hobby anyway for now, specifically because
   the public site itself shows no Probable SPA branding/name while
   pre-revenue and "en modo prueba." Revisit the moment monetization is
   defined or the company connection becomes visible on the site — not a
   decision to make silently again later. See
   [architecture.md](architecture.md#free-tier-posture-upgrade-reactively-not-preemptively).
3. **Phase 4 (social media) depends on having real content running first** —
   there's no point submitting for app review with an empty demo.
4. **The curation policy is defined with examples and an operational prompt,
   but hasn't been tested against real cases yet** — worth running a manual
   test batch before trusting the automatic classification. More relevant
   now than when this was first written: real production data has been
   running since the weekly-batch rollout (2026-07-17), so a real batch to
   audit against actually exists now, not just the original hypothetical
   examples.
5. **Curated event images are hotlinked from arbitrary external domains,
   with no re-hosting or CSP** (`apps/web/next.config.ts`'s
   `images.unoptimized: true`, re-hosting is Phase 3, see
   [roadmap.md](roadmap.md)) — a source could change or replace an image
   after curation with no automated re-check. Accepted as-is for this
   launch, not blocking, but worth remembering it's an open gap rather
   than a solved one.
6. **RLS column-level exposure — closed 2026-07-17**: `events`/`regions`
   used to grant `select` on every column to the (necessarily public) anon
   key, including internal pipeline bookkeeping (`curation_reasoning`,
   `regions.status`/`exclusion_reason`/etc.) that was never meant to be
   queryable directly via the Supabase REST API. Fixed via
   `events_public`/`regions_public` views — see
   `supabase/migrations/20260717050000_restrict_public_columns_via_views.sql`.
7. **Family mode defaulted OFF for first-time visitors — closed
   2026-07-17**: sensitivity-tagged event titles/descriptions were never
   hidden by default, only the thumbnail was blurred. Now defaults ON;
   explicitly turning it off is the only way to see everything.
