-- Structured location: place_name + region_id, additive only — nothing
-- dropped or transformed, freeform_location stays as-is and NOT NULL.
--
-- Why: the frontend was deriving city from freeform_location's trailing
-- comma-segment (a heuristic, apps/web/src/lib/cities.ts's deriveCityId)
-- because there was no structured field to read instead. Production data
-- showed freeform_location itself is low quality too — of the 20 most
-- recent events, zero had a recognizable venue name, only bare city or
-- city+neighborhood. place_name gives Event Discovery somewhere to put a
-- real venue/institution/landmark name when the source states one (e.g.
-- "GAM", "Parque Cultural Valparaíso"); region_id gives it a real,
-- filterable link to the regions this project already searches, resolved
-- deterministically in code (apps/curator/src/event-discovery/run.ts),
-- the same matching technique deriveCityId already used client-side —
-- just moved to write-time instead of read-time.

alter table events add column place_name text;
alter table events add column region_id uuid references regions (id) on delete set null;

create index events_region_id_idx on events (region_id);

-- regions was service_role-only (internal discovery/crawl bookkeeping) —
-- the frontend needs to resolve region_id to a name/city for display and
-- filtering. Public data (name/population/lat/lng), no reason to keep it
-- locked down once something outside the curator needs to read it.
create policy "Public can read regions" on regions for select using (true);
grant select on regions to anon, authenticated;
