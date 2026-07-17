-- Per-source independent fetch cadence for bright sources — until now,
-- fetchBrightSources fetched EVERY known+detected source on EVERY run with
-- no gating at all (unlike regions, which have last_run_at + a 28-day
-- "due" check). The user asked directly for this: each bright source
-- should track its own last-fetched time and only be re-fetched once 2
-- weeks have passed since that source's own last fetch — independent per
-- source, not a single shared clock.
--
-- A standalone table, not a column on `regions` or `detected_sources`:
-- KNOWN_SOURCES (apps/curator/src/lib/known-sources.ts) is hand-curated
-- IN CODE, not a DB row, so there's nowhere on an existing table to attach
-- this state to for those sources. Keying purely by `url` (the same field
-- BrightSource.url/mergeBrightSources already treat as the source's
-- identity) lets this table track BOTH hand-curated and auto-detected
-- sources uniformly, without caring which list a source came from.
create table bright_source_fetch_state (
  url text primary key,
  last_fetched_at timestamptz not null
);

-- Internal bookkeeping, same posture as detected_sources: RLS on, no
-- public policy, explicit service_role grant (PostgREST's service_role
-- gets no implicit access — see docs/data-model.md).
alter table bright_source_fetch_state enable row level security;
grant all on bright_source_fetch_state to service_role;
