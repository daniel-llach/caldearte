-- Retention policy revision: once "Expos anteriores"
-- (apps/web/src/app/expos-anteriores/[year]/[month]) shipped, every
-- approved event eventually lands on exactly one canonical, statically
-- generated archive month page — so pruning must stop deleting approved
-- rows. Rejected/pending_review rows (Event Discovery false positives,
-- never publicly linked) should still be cleaned up on the existing
-- ~1-year-past-run cadence; only the approved carve-out is new here.
create or replace function prune_expired_events(cutoff_date date)
returns void
language sql
security definer
set search_path = public
as $$
  delete from events
  where coalesce(run_end_date, run_start_date, opening_datetime::date) < cutoff_date
    and curation_status <> 'approved';
$$;
