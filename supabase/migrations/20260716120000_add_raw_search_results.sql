-- Logs raw Tavily search results (pre-curation, before Haiku ever sees
-- them) for a short rolling window — not a permanent archive. Purpose:
-- support on-demand review of which domains keep showing up in searches
-- but never became bright sources, so a human can spot a candidate like
-- mnba.gob.cl (found by manually reviewing search output, then curl'ing
-- the page to check its structure) faster than stumbling into it.
-- `events` doesn't serve this purpose: it only holds candidates Haiku
-- actually turned into a distinct event, so a weak-snippet aggregator
-- page that never produces one never shows up there.
--
-- Deliberately NOT a permanent archive — apps/curator/src/event-discovery
-- /run.ts prunes rows older than 7 days on every run, piggybacked on the
-- existing manually-triggered cadence, no separate cleanup job.
create table raw_search_results (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  unit_name text not null,
  domain text not null,
  url text not null,
  title text not null,
  score numeric not null
);

create index raw_search_results_created_at_idx on raw_search_results (created_at);
create index raw_search_results_domain_idx on raw_search_results (domain);

-- Internal bookkeeping, same posture as detected_sources/system_config/
-- api_usage_log: RLS on, no public policy, explicit service_role grant
-- (PostgREST's service_role gets no implicit access — see docs/data-model.md).
alter table raw_search_results enable row level security;
grant all on raw_search_results to service_role;
