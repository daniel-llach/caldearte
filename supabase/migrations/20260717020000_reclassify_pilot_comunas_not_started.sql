-- Status semantics fix: 'excluded' originally meant hard editorial
-- exclusion (OFAC-style — see create_core_schema.sql's own documented
-- intent), not "not yet activated for search". The 331 comunas seeded
-- earlier today (20260717000000_seed_remaining_chile_comunas_excluded)
-- reused 'excluded' purely to keep them out of getUnitsDueForRun's
-- active search loop while still being taggable via matchRegionId — but
-- that conflates "opted out on purpose" with "just hasn't run yet",
-- which the weekly-batch cron rollout needs to tell apart (only the
-- latter should ever get pulled into a batch). The schema already has a
-- distinct status for this exact case: 'not_started' (see the check
-- constraint in create_core_schema.sql). None of the 331 carry a real
-- exclusion_reason (verified before writing this migration), confirming
-- none of them are genuine hard exclusions — safe to reclassify in bulk.
update regions set status = 'not_started'
where status = 'excluded' and exclusion_reason is null;

-- Weekly batch cron rollout (2026-07-17): getUnitsDueForRun now caps
-- each run to this many units, oldest last_run_at first — same
-- "no redeploy to change" pattern as monthly_budget_usd. Seeded at 25
-- for the ramp-up phase (validate data quality on lower-profile comunas
-- before scaling up); raise to 35 once ramp-up looks good — 35/week
-- keeps Tavily usage inside its free 1,000-credit/month tier
-- indefinitely (35 comunas × 6 credits/comuna × ~4.33 weeks/month ≈ 910
-- credits/month), no pay-as-you-go needed. See docs/region-discovery.md
-- for the full cost breakdown this was sized against.
insert into system_config (key, value) values ('weekly_batch_size', '25');
