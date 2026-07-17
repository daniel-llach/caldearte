# Caldearte — Data Model

This reflects the schema as actually deployed to production
(`supabase/migrations/`), not just the original draft — keep it in sync when
migrations change.

## Tables

```
regions
  id, name, country, language, lat, lng, population,
  admin_region_name, admin_region_order (Chilean administrative
    macro-region — e.g. "Región Metropolitana de Santiago" — and its
    geographic north-to-south rank; both nullable so a future country's
    comunas can be seeded before this data exists for them. Backfilled for
    all 346 Chile rows in
    20260717030000_add_admin_region_to_regions.sql. Used by the frontend
    city picker to group comunas as país -> región -> comuna — see
    apps/web/src/lib/cities.ts's groupCitiesByRegion),
  expansion_rank (position in the precalculated global population/distance
    ranking — see region-discovery.md for the log-compressed formula),
  status (not_started | active | saturated | excluded),
  exclusion_reason (nullable; e.g. "OFAC sanctions" for North Korea),
  search_frequency (weekly | monthly),
  consecutive_zero_yield_runs (int, drives the adaptive-cadence logic),
  last_run_at, created_at
  -- PLANNED simplification, not yet applied: the saturation/expansion
  -- columns above (status, search_frequency, consecutive_zero_yield_runs,
  -- expansion_rank) are being replaced in application logic by a fixed,
  -- hand-maintained list of ~100 units (cities + comunas for the largest
  -- metro areas) on a simple fixed monthly cadence — no automatic
  -- expansion, no saturation state machine. Columns stay in the table
  -- (no migration needed to stop using them, they just go unread) until
  -- the real integration happens — see region-discovery.md.

events
  id, freeform_location (text, required — the only location concept; there
    is no venue entity),
  title, description, artist,
  run_start_date, run_end_date (the exhibition's actual run, shown for its
    full duration — see overview.md's "full exhibition run" policy; both
    nullable),
  opening_datetime (date AND time, only when a source explicitly confirms a
    real opening night — null otherwise),
  opening_date_confidence (alta | baja) — legacy column from before
    run_start_date/run_end_date existed; Event Discovery doesn't set it,
  medium_type (tradicional | intervencion_no_tradicional),
  sensitivity_tags (array: desnudo_erotismo | guerra_violencia |
    memoria_dictadura),
  source (scraped | submitted | discovered — "discovered" is Event
    Discovery's search-based pass; "scraped"/"submitted" are for pipelines
    that don't exist yet in production),
  image_storage_path (reserved for a re-hosted copy, Phase 3 — not written
    yet), image_url (the raw external image URL, so it isn't silently
    dropped in the meantime), source_url,
  curation_status (approved | rejected | pending_review — Event Discovery
    itself only ever writes approved/rejected, see curation-policy.md),
  curation_reasoning (internal, technical, for the curators),
  public_explanation (nullable; only set on automatic rejection of a
    "submitted" event, goes in the reply email),
  created_at
  -- PLANNED: auto-deleted ~1 year past run_end_date — see overview.md's
  -- "full exhibition run" policy. Daily cleanup cron still not built.

system_config
  key (primary key), value, updated_at
  -- editable directly, no redeploy needed. Seeded:
  --   monthly_budget_usd = '10'
  --   max_total_regions = '200'

api_usage_log
  id, created_at,
  purpose (event_discovery),
  model, region_id (fk, nullable),
  input_tokens, output_tokens, cache_creation_input_tokens,
  cache_read_input_tokens, web_search_requests, estimated_cost_usd
  -- self-tracked spend ledger, see region-discovery.md#cost-governance.
  -- web_search_requests was added after the first real run: web search is
  -- billed separately from tokens ($10/1,000 searches) and wasn't tracked
  -- at all before, so isOverBudget() was blind to roughly half of real spend.

curation_policy (versioned in the repo, not in the DB)
```

Field types and constraints (exact `CHECK`s, defaults, nullability) live in
the migration files themselves — this document describes intent and
relationships, not a 1:1 mirror of the SQL.

## Row-level security

All four tables have RLS enabled. Public read access is intentionally narrow:

- `events`: `SELECT` granted to `anon`/`authenticated`, but the policy only
  exposes rows where `curation_status = 'approved'` — pending/rejected
  events are never visible publicly.
- `regions`, `system_config`, `api_usage_log`: no public policy at all —
  internal bookkeeping, accessible only to `service_role`.

All four tables also `GRANT ALL ... TO service_role` explicitly. This was a
real bug found while building the curator: PostgREST's `service_role`
Postgres role gets **no implicit access** — it needs the same explicit
`GRANT`s as any other role. The original schema migration only granted
`anon`/`authenticated` `SELECT` on `venues`/`events` (both existed at the
time) and nothing to `service_role` at all, which would have silently
blocked every read/write the moment real code tried to use `supabase-js`.
Fixed in the cost-governance migration for all tables that existed then.

## Secrets / credentials

| Secret | Lives in | Note |
|---|---|---|
| `ANTHROPIC_API_KEY` | GitHub Actions secret | never in code, never in the frontend |
| `SUPABASE_SERVICE_ROLE_KEY` | GitHub Actions secret | only the curator uses it; never expose to the browser |
| `SUPABASE_ANON_KEY` | Next.js public env var | the only key that goes to the frontend |
| `SUPABASE_ACCESS_TOKEN` | GitHub Actions secret | already in use — authenticates the Supabase CLI in `deploy-migrations.yml` |
| `SUPABASE_DB_PASSWORD` | GitHub Actions secret | already in use — lets `deploy-migrations.yml` run `supabase db push` against production |
| `RESEND_API_KEY` | Supabase Edge Function secret | triggers approval emails |
| `APPROVAL_TOKEN_SECRET` | GitHub Actions / Edge Function secret | signs the one-time links behind the email approval buttons |
| `RESEND_WEBHOOK_SECRET` | Supabase Edge Function secret | verifies inbound-email webhooks (date inquiry, public mailbox) really come from Resend |
| `META_APP_ID` / `META_APP_SECRET` | Phase 4, GitHub Actions secret | not needed until Phase 4 |
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` | Phase 4, GitHub Actions secret | not needed until Phase 4 |

Security note already discussed: in public repos, Actions secrets are not
exposed to workflows triggered by fork PRs (unless `pull_request_target` is
used — avoid it).
