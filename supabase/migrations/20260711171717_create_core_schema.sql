-- Fase 1a core schema: regions, venues, events.
-- See docs/project-brief.md ("Modelo de datos (borrador)") for the full rationale.
-- (Touched to trigger the first run of deploy-migrations.yml — see PR #7.)

create table regions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country text not null,
  language text not null,
  lat double precision,
  lng double precision,
  population bigint,
  expansion_rank integer,
  status text not null default 'not_started'
    check (status in ('not_started', 'active', 'saturated', 'excluded')),
  exclusion_reason text,
  search_frequency text
    check (search_frequency in ('weekly', 'monthly')),
  consecutive_zero_yield_runs integer not null default 0,
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);

create index regions_status_idx on regions (status);

create table venues (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references regions (id) on delete restrict,
  name text not null,
  address text,
  lat double precision,
  lng double precision,
  geocoded_at timestamptz,
  source_domain text,
  contact_email text,
  category text not null default 'needs_review'
    check (category in ('art_space', 'hard_excluded', 'needs_review')),
  created_at timestamptz not null default now()
);

create index venues_region_id_idx on venues (region_id);
create index venues_category_idx on venues (category);

create table events (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid references venues (id) on delete set null,
  freeform_location text,
  title text not null,
  description text,
  artist text,
  opening_datetime timestamptz not null,
  opening_date_confidence text not null default 'alta'
    check (opening_date_confidence in ('alta', 'baja')),
  medium_type text
    check (medium_type in ('tradicional', 'intervencion_no_tradicional')),
  sensitivity_tags text[] not null default '{}'
    check (sensitivity_tags <@ array['desnudo_erotismo', 'guerra_violencia', 'memoria_dictadura']),
  source text not null
    check (source in ('scraped', 'submitted', 'discovered')),
  image_storage_path text,
  source_url text,
  curation_status text not null default 'pending_review'
    check (curation_status in ('approved', 'rejected', 'pending_review')),
  curation_reasoning text,
  public_explanation text,
  created_at timestamptz not null default now(),
  constraint events_has_location check (venue_id is not null or freeform_location is not null)
);

create index events_opening_datetime_idx on events (opening_datetime);
create index events_curation_status_idx on events (curation_status);
create index events_venue_id_idx on events (venue_id);

-- RLS: only approved events (and their venues) are readable via the anon key.
-- Regions are internal (discovery/crawl bookkeeping), no public policy — locked to service_role.
-- RLS policies only gate rows once a role already has the underlying GRANT, so both are needed.
alter table regions enable row level security;

alter table venues enable row level security;
create policy "Public can read venues" on venues for select using (true);
grant select on venues to anon, authenticated;

alter table events enable row level security;
create policy "Public can read approved events" on events for select using (curation_status = 'approved');
grant select on events to anon, authenticated;
