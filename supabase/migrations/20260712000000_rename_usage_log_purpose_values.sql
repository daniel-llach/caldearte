-- "Proceso A"/"Proceso B" were cryptic internal names — renamed to semantic
-- ones everywhere (code, docs, this enum). Safe to just change the
-- constraint: api_usage_log has zero rows in production, no data to migrate.
alter table api_usage_log drop constraint api_usage_log_purpose_check;
alter table api_usage_log
  add constraint api_usage_log_purpose_check
  check (purpose in ('venue_discovery', 'event_crawl'));
