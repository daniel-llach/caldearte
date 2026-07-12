-- Venue Discovery is moving from "find venues, guess their homepage lists
-- exhibitions" to "search exhibitions/interventions directly, derive the
-- listing page from where one was found." listing_url lets the Event
-- Crawler fetch that specific page instead of guessing the domain root.
alter table venues
  add column listing_url text;

-- The chosen event image was picked (Axis 5 vision check) but never
-- persisted anywhere - image_storage_path is reserved for a future
-- re-hosted copy (Phase 3). This holds the raw external URL in the
-- meantime, so it isn't silently dropped.
alter table events
  add column image_url text;
