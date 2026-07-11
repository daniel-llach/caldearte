# Caldearte — Data Model

This reflects the schema as actually deployed to production
(`supabase/migrations/`), not just the original draft — keep it in sync when
migrations change.

## Tables

```
regions
  id, name, country, language, lat, lng, population,
  expansion_rank (position in the precalculated global population/distance
    ranking — see region-discovery.md for the log-compressed formula),
  status (not_started | active | saturated | excluded),
  exclusion_reason (nullable; e.g. "OFAC sanctions" for North Korea),
  search_frequency (weekly | monthly),
  consecutive_zero_yield_runs (int, drives the adaptive-cadence logic),
  last_run_at, created_at

venues
  id, region_id (fk, restrict delete), name, address, lat, lng, geocoded_at,
  source_domain,
  contact_email (for the opening-date inquiry flow, Phase 1b; nullable — not
    every venue will have one),
  category (art_space | hard_excluded | needs_review) — resolved once per
    venue, not per event,
  content_hash, last_checked_at, check_frequency_days (default 3, not daily —
    see region-discovery.md#cost-governance),
  consecutive_zero_yield_checks,
  created_at

events
  id, venue_id (fk, nullable — null when the event has no recurring venue),
  freeform_location (text + one-off geocoding; used when venue_id is null),
  title, description, artist,
  opening_datetime (opening date and time, not the exhibition run),
  opening_date_confidence (alta | baja — baja when the source only gives a
    date range, not an explicit opening time),
  medium_type (tradicional | intervencion_no_tradicional),
  sensitivity_tags (array: desnudo_erotismo | guerra_violencia |
    memoria_dictadura),
  source (scraped | submitted | discovered — "discovered" is what Proceso A
    finds directly, with no venue),
  image_storage_path, source_url,
  curation_status (approved | rejected | pending_review),
  curation_reasoning (internal, technical, for the curators),
  public_explanation (nullable; only set on automatic rejection of a
    "submitted" event, goes in the reply email),
  created_at
  -- auto-deleted 7 days after opening_datetime (daily cleanup cron — not
  -- yet built)

system_config
  key (primary key), value, updated_at
  -- editable directly, no redeploy needed. Seeded:
  --   monthly_budget_usd = '10'
  --   max_total_regions = '200'

api_usage_log
  id, created_at,
  purpose (proceso_a_discovery | proceso_b_crawl),
  model, region_id (fk, nullable), venue_id (fk, nullable),
  input_tokens, output_tokens, cache_creation_input_tokens,
  cache_read_input_tokens, estimated_cost_usd
  -- self-tracked spend ledger, see region-discovery.md#cost-governance

curation_policy (versioned in the repo, not in the DB)
```

Field types and constraints (exact `CHECK`s, defaults, nullability) live in
the migration files themselves — this document describes intent and
relationships, not a 1:1 mirror of the SQL.

## Row-level security

All five tables have RLS enabled. Public read access is intentionally narrow:

- `venues`: `SELECT` granted to `anon`/`authenticated` (policy: `using
  (true)`) — venue info is public.
- `events`: `SELECT` granted to `anon`/`authenticated`, but the policy only
  exposes rows where `curation_status = 'approved'` — pending/rejected
  events are never visible publicly.
- `regions`, `system_config`, `api_usage_log`: no public policy at all —
  internal bookkeeping, accessible only to `service_role`.

All five tables also `GRANT ALL ... TO service_role` explicitly. This was a
real bug found while building the curator: PostgREST's `service_role`
Postgres role gets **no implicit access** — it needs the same explicit
`GRANT`s as any other role. The original schema migration only granted
`anon`/`authenticated` `SELECT` on `venues`/`events` and nothing to
`service_role` at all, which would have silently blocked every future
Proceso A/B read/write the moment real code tried to use `supabase-js`.
Fixed in the cost-governance migration for all five tables.

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
