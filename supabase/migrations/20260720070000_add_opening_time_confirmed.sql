-- Real gap (found 2026-07-20): a source can confirm an inauguración DATE
-- without confirming a specific HOUR (e.g. arteinformado.com's "Sín-tesis"
-- — "Inauguración: 14 jul de 2026", no time at all, a genuine editorial
-- gap on the source's own page). Until now, opening_datetime required a
-- real hour to be set at all (see lib/opening-time.ts's
-- extractOpeningDatetime), so a date-only confirmation was silently
-- dropped — the event only ever showed as an "expo actual", never as an
-- "inauguración", even though the venue explicitly confirmed one.
--
-- Default true preserves the existing invariant for every row already in
-- the table: Haiku's own prompt already requires an explicit hour before
-- it ever sets opening_datetime at all (see discover.ts's buildSystemPrompt
-- — "fecha Y hora exacta... SOLO si la fuente menciona... con hora"), so
-- every pre-existing populated opening_datetime is, by construction,
-- already time-confirmed. Only the deterministic post-curation regex
-- enrichment (lib/opening-time.ts) can ever produce false here going
-- forward, and only for sources whose openingTimeExtractor regex has no
-- captured hour.
alter table events add column opening_time_confirmed boolean not null default true;

-- Appended at the end of the SELECT list, not inserted alongside
-- opening_datetime where it conceptually belongs — `create or replace
-- view` can only add columns at the end, not reorder existing ones.
create or replace view events_public as
select
  id, title, artist, description, freeform_location, place_name,
  region_id, image_url, opening_datetime, run_start_date, run_end_date,
  sensitivity_tags, source_url, opening_time_confirmed
from events
where curation_status = 'approved';
