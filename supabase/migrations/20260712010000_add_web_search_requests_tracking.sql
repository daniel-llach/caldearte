-- Web search is billed separately from tokens ($10 per 1,000 searches) and
-- was never tracked here — meaning isOverBudget() was blind to roughly half
-- of real Venue Discovery spend (measured: $1.36 real vs $0.62 tracked on
-- the first production run). This column lets the ledger record it.
alter table api_usage_log
  add column web_search_requests integer not null default 0;
