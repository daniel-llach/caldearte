-- Retire venues + the Event Crawler: since the Tavily+Haiku pivot
-- (migrations 20260712020000 onward), Event Discovery no longer produces
-- venues and never reads from the venues table — it writes freeform_location
-- directly. The Event Crawler (the only remaining consumer of venues) has
-- been deleted from the codebase; nothing produces new venues rows anymore.
-- "Fuentes brillantes" (detected_sources) replace what venues used to do,
-- with a different, venue-less mechanism.
--
-- Data check before dropping: of 35 production events, 2 relied solely on
-- venue_id for location (freeform_location was null) — backfilled below
-- from the venue's name + region so no location data is lost. The other 33
-- already had freeform_location populated. api_usage_log has zero rows with
-- purpose = 'event_crawl' or a non-null venue_id — safe to narrow/drop
-- without data loss there.

-- Backfill freeform_location for the two events that only had a venue_id,
-- using the same "Venue, Region" format Event Discovery already writes.
update events e
set freeform_location = v.name || ', ' || r.name
from venues v
join regions r on r.id = v.region_id
where e.venue_id = v.id
  and e.freeform_location is null;

drop index events_venue_id_idx;
alter table events drop constraint events_has_location;
alter table events drop column venue_id;
alter table events alter column freeform_location set not null;

alter table api_usage_log drop column venue_id;

alter table api_usage_log drop constraint api_usage_log_purpose_check;
alter table api_usage_log
  add constraint api_usage_log_purpose_check
  check (purpose in ('event_discovery'));

drop table venues;
