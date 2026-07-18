-- Pre-launch security tightening: `events`/`regions` currently grant
-- `select` on EVERY column to anon/authenticated — the row-level policy on
-- `events` (curation_status = 'approved') only restricts which ROWS are
-- visible, not which COLUMNS. That means, querying the Supabase REST API
-- directly (not through the frontend, which already only reads the
-- columns it needs — see apps/web/src/lib/events.ts's toEventRecord),
-- anyone with the anon key (necessarily public — it ships in every
-- browser bundle) can read:
--   - events.curation_reasoning: Haiku's internal reasoning about why an
--     event passed/failed the five curation axes, including explicit
--     religion/violence/far-right/pseudoscience judgments about specific
--     real events — never meant to be public-facing.
--   - events.image_storage_path, public_explanation, medium_type,
--     opening_date_confidence, source, created_at, curation_status: all
--     internal pipeline bookkeeping, not content.
--   - regions.status, exclusion_reason, search_frequency,
--     consecutive_zero_yield_runs, last_run_at, expansion_rank, language,
--     created_at: internal scraper/crawl bookkeeping (which comunas are
--     excluded and why, crawl cadence, last-run timestamps) — operational
--     detail about the pipeline, not public data.
--
-- Fixed via column-restricted views rather than narrowing the base grant
-- directly, so the `service_role`-only curator (apps/curator, which
-- bypasses RLS/grants entirely and needs every column) is completely
-- unaffected — only anon/authenticated's access moves from the base
-- tables to these views.

create view events_public as
select
  id, title, artist, description, freeform_location, place_name,
  region_id, image_url, opening_datetime, run_start_date, run_end_date,
  sensitivity_tags, source_url
from events
where curation_status = 'approved';

create view regions_public as
select
  id, name, country, lat, lng, population,
  admin_region_name, admin_region_order, admin_region_numeral
from regions;

revoke select on events from anon, authenticated;
revoke select on regions from anon, authenticated;

grant select on events_public to anon, authenticated;
grant select on regions_public to anon, authenticated;
