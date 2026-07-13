-- Real production bug (first live Event Discovery run, "Piedras Raras"):
-- a candidate with only run_end_date set (a source that states when a
-- show closes but never states when it opened) passed the app-level
-- isCurrentOrUpcoming check — which treats run_end_date as a valid date on
-- its own, matching the "full exhibition run" policy (docs/overview.md) —
-- but failed events_has_some_date, which only recognized
-- opening_datetime/run_start_date. Widen the constraint to match the
-- app's actual definition of "has a usable date" instead of narrowing the
-- app check, since a real, currently-running exhibition we only know the
-- closing date for is still a legitimate event to show.
alter table events drop constraint events_has_some_date;
alter table events add constraint events_has_some_date
  check (opening_datetime is not null or run_start_date is not null or run_end_date is not null);
