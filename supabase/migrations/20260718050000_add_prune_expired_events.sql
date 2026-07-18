-- overview.md's retention policy: delete events roughly a year past their
-- run's end, not their opening date. "End" here mirrors date.ts's
-- activeRange (run_end_date, else run_start_date, else opening_datetime's
-- date) so an event with only a confirmed opening and no run dates is
-- still retained relative to that date.
--
-- A plain client-side `.lt()` can't express "coalesce these three columns"
-- in one PostgREST call, so this ships as a SECURITY DEFINER function the
-- curator (service_role) calls via rpc() from its own weekly run — same
-- posture as the existing raw_search_results pruning, piggybacked on
-- Event Discovery's cadence rather than a separate cron.
create function prune_expired_events(cutoff_date date)
returns void
language sql
security definer
set search_path = public
as $$
  delete from events
  where coalesce(run_end_date, run_start_date, opening_datetime::date) < cutoff_date;
$$;

revoke all on function prune_expired_events(date) from public;
grant execute on function prune_expired_events(date) to service_role;
