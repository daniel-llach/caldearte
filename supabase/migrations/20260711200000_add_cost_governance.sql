-- Fase 1a cost governance: self-tracked spend ledger + config table, so
-- Proceso A/B can enforce a monthly budget ceiling before making paid
-- Claude API calls, without needing a code deploy to adjust the ceiling.

create table system_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into system_config (key, value) values
  ('monthly_budget_usd', '10'),
  ('max_total_regions', '200');

-- Hitting monthly_budget_usd blocks new region activation only (Proceso A) —
-- the daily crawl of already-known venues (Proceso B) keeps running so the
-- calendar doesn't go stale. max_total_regions is a secondary sanity check,
-- not the primary control.
create table api_usage_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  purpose text not null check (purpose in ('proceso_a_discovery', 'proceso_b_crawl')),
  model text not null,
  region_id uuid references regions (id) on delete set null,
  venue_id uuid references venues (id) on delete set null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_creation_input_tokens integer not null default 0,
  cache_read_input_tokens integer not null default 0,
  estimated_cost_usd numeric(10, 6) not null
);

create index api_usage_log_created_at_idx on api_usage_log (created_at);

-- content_hash/last_checked_at power change-detection: skip the Haiku call
-- entirely when a venue's page hasn't changed since the last check.
-- check_frequency_days defaults to 3, not daily — inauguraciones are
-- normally announced with more than a few days' notice.
alter table venues
  add column content_hash text,
  add column last_checked_at timestamptz,
  add column check_frequency_days integer not null default 3,
  add column consecutive_zero_yield_checks integer not null default 0;

-- Internal bookkeeping, same pattern as `regions`: no public policy, locked to service_role.
alter table system_config enable row level security;
alter table api_usage_log enable row level security;

-- Bug fix surfaced while building the curator: PostgREST's service_role
-- Postgres role gets no implicit table access — it needs the same explicit
-- GRANTs as anon/authenticated. The original schema never granted anything
-- to service_role (only anon/authenticated SELECT on venues/events), so
-- Proceso A/B would have failed the moment they tried to read regions or
-- write venues/events through supabase-js. Fixing it here for all five
-- tables, not just the two new ones.
grant all on regions, venues, events, system_config, api_usage_log to service_role;
