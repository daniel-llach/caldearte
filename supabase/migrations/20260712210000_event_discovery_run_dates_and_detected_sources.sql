-- Event Discovery's Tavily-based redesign (docs/region-discovery.md):
-- the calendar now shows an exhibition's full run, with opening nights as
-- the highlighted moment *when confirmed* — no longer inferred as a
-- low-confidence proxy from a date range (docs/overview.md).
--
-- Additive + one dropped NOT NULL. No rows are deleted or transformed;
-- every existing row remains valid (they all have opening_datetime, so the
-- new has-some-date check passes).

-- The exhibition's actual run. Nullable: a one-day intervention may only
-- have opening_datetime, a long-running show may have no confirmed end.
alter table events add column run_start_date date;
alter table events add column run_end_date date;

-- opening_datetime becomes "only when a source explicitly confirms a real
-- opening night" — most real exhibitions found via search don't have one.
-- The Event Crawler's flow still always provides it; Event Discovery
-- often won't. opening_date_confidence stays for the crawler's rows but is
-- meaningless when opening_datetime is null.
alter table events alter column opening_datetime drop not null;

-- An event with no date at all is useless for a calendar — require at
-- least one of the two date concepts.
alter table events add constraint events_has_some_date
  check (opening_datetime is not null or run_start_date is not null);

create index events_run_end_date_idx on events (run_end_date);

-- Bright sources ("fuentes brillantes") auto-detected at run time: a
-- non-social domain contributing 2+ complete events (image+title+date this
-- month) in one run. Persisted here — GitHub Actions runners are ephemeral,
-- a local JSON file wouldn't survive between monthly runs. The hand-curated
-- seed list stays in code (apps/curator/src/lib/known-sources.ts); this
-- table only holds what detection adds on top, merged (deduped by domain,
-- code list wins) at the start of every run.
create table detected_sources (
  id uuid primary key default gen_random_uuid(),
  url text not null unique,
  note text not null,
  source_type text not null default 'html'
    check (source_type in ('html', 'json-api')),
  last_reviewed_at date,
  created_at timestamptz not null default now()
);

-- Internal bookkeeping, same posture as regions/system_config/api_usage_log:
-- RLS on, no public policy, explicit service_role grant (PostgREST's
-- service_role gets no implicit access — a real bug found earlier, see
-- docs/data-model.md).
alter table detected_sources enable row level security;
grant all on detected_sources to service_role;

-- The ledger's purpose label had become a misnomer ("venue_discovery"
-- produces events, not venues, since the pivot). Renaming was deferred to
-- avoid a label-only migration — but this migration ships anyway, so do it
-- now: existing rows get relabeled (an UPDATE on the ledger's own metadata
-- column, no cost data touched), and the honest label is used going forward.
alter table api_usage_log drop constraint api_usage_log_purpose_check;
update api_usage_log set purpose = 'event_discovery' where purpose = 'venue_discovery';
alter table api_usage_log
  add constraint api_usage_log_purpose_check
  check (purpose in ('event_discovery', 'event_crawl'));
