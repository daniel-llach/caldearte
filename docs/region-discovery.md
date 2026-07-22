# Caldearte — Region Discovery, Event Discovery & Cost Governance

Which units (cities/comunas) get searched, how Event Discovery searches and
curates them, and the cost-governance system that keeps it bounded. This
document is required reading before touching any of it.

## Event Discovery — Tavily + Haiku, events only, no venues

Event Discovery is implemented and in production
(`apps/curator/src/event-discovery/`). It never produces or touches venues
at all — there is no venue entity in the schema. Events have a `location`
(always freeform text); there is no venue-matching, no venue category
gating, nothing.

### Search: Tavily, not Anthropic's web_search tool

**Why the switch:** real side-by-side comparison showed Anthropic's
`web_search` returning mostly title/URL with no real content, and missing
social media coverage entirely — which matters directly since informal/
street events are often *only* announced on Instagram/Facebook. Tavily's
results include substantial page content (sometimes full article text) and
do surface Instagram/Facebook posts directly, with real dates/addresses in
the result content itself.

**Real API-level finding:** the official `@tavily/core` npm SDK (v0.7.6)
silently drops per-result `images` even when `includeImages`/
`includeImageDescriptions` are requested — confirmed by comparing the SDK's
parsed response against a raw REST call to the same endpoint with identical
parameters, which does return them. Per-result images are the whole point
here (see "Images" below), so the design bypasses the SDK and calls the
REST API directly with plain `fetch`.

**Three fixed queries per unit**, in the region's language, with the
current month/year substituted:
- `inauguracion arte <unidad> <mes año>`
- `exposicion arte <unidad> <mes año>`
- `intervencion artistica <unidad> <mes año>`

Tested empirically whether 2 of the 3 would suffice (reusing already-logged
data, no extra Tavily cost): dropping any one query loses 20-32% of unique
results across real test units, including titles that were genuine,
otherwise-approved candidates. All 3 stay.

**Tavily request parameters** (validated real shape):
`search_depth: "advanced"` (tested `"basic"` manually — noticeably worse
results, not worth the cost difference, which turned out to be
negligible anyway), `country: "chile"` (costs 2 credits instead of 1, but
eliminates wrong-country noise — worth it, see "Location" below),
`max_results: 20` (confirmed via Tavily's own docs: a fixed API ceiling,
not plan-dependent — no paid tier removes it), `start_date` (first day of
the target month), `chunks_per_source: 1`, `exclude_domains` (known bright
sources — see below, avoids paying to re-discover what's fetched directly),
`include_images` + `include_image_descriptions` (both real, load-bearing —
see "Images").

**Cost filter, confirmed with real data:** results with Tavily's own
`score < 0.15` are dropped before ever reaching Haiku. Checked directly
against real logged data (180 raw results, 25 below this threshold) — none
of the 25 ever became a candidate Haiku reported, meaning it was already
ignoring this content on its own. Pure token savings, no observed loss.

**Within-run dedup:** by URL across a unit's 3 queries (the same result
often surfaces under more than one query template — wasteful to send twice
with zero new information), and by normalized title (accents/quotes/
title-subtitle-separator punctuation stripped) across *all* of a run's
curate() calls combined (every unit plus the separate bright-sources pass)
— real duplicates found and fixed this way: "Poética de las aguas"
reported once via a unit's own search and once via a bright source, same
event; and (2026-07-18) "Una metáfora verde - arte, activismo y
solidaridad" vs "Una metáfora verde: arte, activismo y solidaridad", same
event, one source used a hyphen and the other a colon as the
title/subtitle separator.

**Cross-run dedup, before inserting into `events`:** three independent
keys, any one is enough to skip a candidate as a duplicate of something
already in the calendar — normalized title, `sourceUrl`, and (added
2026-07-18) a location+date fingerprint (normalized `location` + either
`openingDatetime`, or `runStartDate`+`runEndDate` when there's no opening).
The third key exists because of a real bug: the same San Felipe exhibition,
posted by 3 different accounts (2 Instagram, 1 Facebook), got 3
differently-punctuated titles ("SALa FEM 2026" / "SAlaFEM2026" / "SalaFEM
2026") and 3 different sourceUrls — evading both existing keys — while
sharing the exact same location and opening time, which the new key
catches instead. See `apps/curator/src/event-discovery/run.ts`'s
`loadExistingKeys`/`insertCandidates` for the full reasoning per key.

### Curation: a single non-agentic Haiku call per unit

No `tools`/`web_search` — the concatenated search-results block *is* the
user message; Haiku only curates what's already given, one plain
`messages.create` call per unit (plus one more for the bright-sources
batch, see below). Applies the shared `ART_SCOPE_POLICY` +
`TEXT_CURATION_POLICY` (`apps/curator/src/lib/curation-policy.ts`, kept in
sync with [curation-policy.md](curation-policy.md)), plus:

- **Excludes convocatorias (open calls) and talleres (workshops)
  explicitly** — neither is an event happening, they're invitations to a
  future submission or a participatory class.
- **Location: whitelist, not blocklist, plus a country-name override.**
  Originally a blocklist of foreign countries — too narrow (misses any
  country not explicitly listed, e.g. an event that only says "Lima", never
  "Perú"). Switched to requiring the location text name a recognizable
  Chilean region/city/comuna (a ~100-entry reference list) or the word
  "Chile" itself — since a real event's whole point is telling people where
  to go, this should hold true ~90%+ of the time and doesn't penalize
  genuinely freeform locations (a plaza, a street corner), only ones that
  never identify anywhere checkable. **Real bug found and fixed:**
  "Recoleta" is both a real Santiago comuna and part of "Centro Cultural
  Recoleta, Buenos Aires, Argentina" — a pure whitelist let 3 real Argentine
  candidates through on a substring match. Fixed by checking an explicit
  foreign-country-name blocklist *first*, as an override, before the
  whitelist — belt and suspenders, not either/or. Also a deterministic
  **code-level backstop**, not just a prompt instruction — the prompt alone
  already failed once (same Recoleta case) before this was added.
- **Date rule: month-level, not day-level.** A candidate is discarded only
  if its run has already fully ended (by `runEndDate`, or `runStartDate` if
  no end is given) in a month *before* the target month — never simply
  because a specific date within the target month has already passed
  relative to today, and never because an opening lands in a later month
  (a real future event found incidentally is still valid). Real bug fixed:
  an August exhibition found via a July search was wrongly rejected for
  "falling outside the searched month" before this rule existed.
- **`status` is binary** (`approved`/`rejected`) — no `pending_review`
  escalation tier in this design (a simplification vs. the venue-era
  design's `ESCALATION_SIGNALS`).
- **Year-less dates from social media, real bug found 2026-07-18:** an
  Instagram reel with no year in its caption ("del 1 al 28 de julio") got
  approved as a July 2026 event — the post itself was from 2025-07-26
  (confirmed by decoding the Instagram shortcode's embedded timestamp),
  Tavily's `start_date` filter didn't catch it (unreliable for Instagram
  specifically, whose crawlable pages don't expose a real publish date),
  and Haiku defaulted the year-less date to the current month/year with no
  way to know better. Fixed with an explicit prompt instruction: for
  social-media sources (Instagram/Facebook/TikTok) giving day/month with no
  year, require some other freshness signal in the text (an explicit year,
  "hoy", "recién inaugurada," etc.) before assuming the current year —
  reject on ambiguity instead of defaulting to "now."
- **Explicit year overridden by the current year anyway, real bug found
  2026-07-18:** a culturaviva.cl page for "Roberto Matta: Del Trazo al
  Objeto" stated "13 de junio **2025**" multiple times, gave a schema.org
  `startDate`/`endDate` of 2025-06-13, and even carried the site's own
  "Este evento ha pasado" badge — yet Haiku still wrote `runStartDate:
  "2026-06-13"` and a fabricated `runEndDate` 3 months out, ignoring every
  signal that the year wasn't the current one. Worse than the year-less
  social-media case above: here the year *was* stated explicitly and got
  overridden anyway. Fixed with a hard rule in the prompt: an explicit year
  in the source always wins over the searched month, and an explicit "ya
  pasó"/"evento finalizado" style badge is a hard rejection regardless of
  how current the day/month looks.

**Output shape** (see [data-model.md](data-model.md)): `title`,
`description`, `artist`,
`runStartDate`/`runEndDate` (the exhibition's actual run), `openingDatetime`
(only when a real opening is confirmed), `mediumType`, `sensitivityTags`,
`curationReasoning`, `imageUrl`, `status`, `location` (freeform, always),
`sourceUrl`.

### Images

Tavily's `includeImages`/`includeImageDescriptions` return per-result image
URLs with alt text when available — real find: Instagram's own
auto-generated alt text is often genuinely descriptive ("Photo by Casa
Cultural Yanulaque... May be an illustration of poster and text that says
'CONFLUENCIAS II...'"), letting Haiku correctly distinguish a real flyer
photo from a profile picture or generic site asset. Filtering, in order:
drop obvious junk by filename (`logo`/`icon`/`favicon`/`footer`/`.svg`),
**require a non-null description** (images without alt text were almost
always unusable noise — profile pictures, generic assets — and this alone
cut token volume roughly 60% with no observed quality loss), cap to 4
images per search result (bright sources are exempt from this cap — their
image URLs are cheap, short, first-party paths, unlike long CDN URLs from
social platforms).

**Vision check (Axis 5) exists as reusable code (`lib/vision-check.ts`) but
is NOT wired into production Event Discovery today.** Its only caller
anywhere in the repo is the standalone PoC
(`apps/curator/scripts/poc-tavily-discover.ts`) — `discover.ts`/`sources.ts`/
`run.ts` never call `runVisionCheck`, so no image (Tavily-sourced or
otherwise) currently gets an Axis-5 explicit-content check before
publishing. Wiring it into production is a deliberate, separate editorial/
cost decision (it could newly reject currently-live events), not done yet.

What's validated so far, in the PoC: measured real cost ~$0.0003-0.0011 per
image — negligible, applying it to every event with an image would barely
move the budget. Two real bugs found and fixed in `defaultImageFetcher`
(shared code, not PoC-specific): (1) some servers append parameters to
`Content-Type` (`image/jpeg;charset=UTF-8`, e.g. `artes.uchile.cl`), which
Anthropic's API rejects outright — fixed by stripping everything after the
first `;`; (2) Instagram's CDN sometimes returns 403 on a direct
server-side fetch (hotlink protection) — not fixed (would need a different
fetch strategy/headers), but the PoC's vision step falls back to the next
available candidate image instead of failing the whole run.

### Prompt caching — implemented, currently inactive

`cache_control` is set on the system prompt in every curate() call. Real
measured result: `cache_write`/`cache_read` both come back 0 on every call
— the system prompt (~600-900 tokens) is below Haiku's minimum cacheable
prefix (2048 tokens), so Anthropic silently skips caching, no premium, no
discount, no-op either way. Not worth padding the prompt artificially to
cross that threshold. Would start working automatically, no code change
needed, if the prompt naturally grows past it later (e.g. if a large
location-reference list gets embedded directly in it).

### Real cost, measured

A full test run (3 units + the bright-sources pass) costs roughly
**$0.10-0.15** in Anthropic spend, plus a handful of Tavily credits (well
under its 1,000/month free tier even at the ~100-unit target scale
discussed below, run once a month). Enabling per-result images roughly
doubled token cost in one measured comparison (~$0.10 → ~$0.20 for the same
3 units) before the description-required image filter brought it back down
close to the original baseline. **Budget ceiling relaxed**: the original
$10/month self-imposed ceiling (see "Cost governance" below) is no longer a
hard cap — the user is comfortable spending up to **$50/month** if quality
justifies it, given real per-run costs are far below that even at
meaningfully larger scale.

### Cadence — weekly batch rollout across all 346 comunas (implemented 2026-07-17)

**Supersedes the earlier "~100 hand-curated units, monthly cadence"
plan below.** All 346 official Chilean comunas are seeded as `regions`
rows (346 total: the original 15 as `status='active'`/`'excluded'`,
the other 331 as `status='not_started'` — cross-checked against a
structured dataset rather than typed from memory, see the
`20260717000000_seed_remaining_chile_comunas_excluded` migration).
`status='not_started'` is distinct from `status='excluded'`:
`'excluded'` is a hard, permanent editorial opt-out (OFAC-style);
`'not_started'` just means "not yet in the batch rotation" — both are
filtered out of `getUnitsDueForRun`'s `.neq('status', 'excluded')`
query only for the former, so `'not_started'` comunas are genuinely
eligible to be picked up.

**Why weekly batches, not one run through everything:** the run is a
**sequential** for-loop, no parallelization (~82s/unit measured) — 346
units sequentially ≈ 7.9 hours, over GitHub Actions' 6-hour default job
timeout. `getUnitsDueForRun` caps each run to `weekly_batch_size`
(`system_config`, no redeploy to change), sorted oldest-`last_run_at`-
first (never-run sorts before any real timestamp) — the same "due"
28-day check as before, just capped and prioritized. This rotates
through every comuna once, then cycles forever with no reset logic: a
comuna that just ran becomes the newest, falls out of the due pool for
28 days, and re-enters it once that elapses.

A comuna's first real run also flips its `status` from `'not_started'`
to `'active'` (`run.ts`'s per-unit loop) — restores real meaning to the
column, which was previously written once at seed time and never
touched again.

**Batch size, chosen to stay inside Tavily's free tier indefinitely:**
`weekly_batch_size × 6 Tavily credits/comuna × ~4.33 weeks/month ≤
1,000` (the free monthly credit allotment) → max ~38/week. **Currently
seeded at 25/week** (ramp-up phase, started 2026-07-17 — validate data
quality on lower-profile comunas before scaling up; see
`system_config`/`supabase/migrations/20260717020000_reclassify_pilot_comunas_not_started.sql`'s
own comment). Target steady-state is **35/week** (a small safety margin
under the ~38 ceiling) once ramp-up looks good — that size completes a
full 346-comuna rotation in **~9.9 weeks (~2.3 months)**, entirely inside
Tavily's free tier, no pay-as-you-go needed. At the current 25/week, a
full rotation takes ~13.8 weeks (~3.2 months) instead — still $0 on
Tavily, just slower. A faster rotation (e.g. 80/week, ~1
month) is possible but requires enabling Tavily pay-as-you-go
(≈$8.61/month overage at that size) — not the default, since bright
sources already refresh every 2 weeks independent of the comuna
rotation (a plain HTTP fetch, zero Tavily cost) and most exhibitions
run well over a month anyway. The real trade-off of a slower rotation:
events *outside* official museums/galleries (pop-ups, one-off
interventions, small independent spaces not yet known as a bright
source) are exactly what a comuna's own direct search is needed for,
and a 2+ month cadence risks missing short-lived ones. Revisit once a
few rotations' worth of real coverage data exists.

**No internal spend-gating code** — `isOverBudget()`/`isOverRegionCap()`
(`apps/curator/src/lib/usage-tracking.ts`) exist but aren't wired into
`run.ts`. The real hard control is Anthropic's own prepaid-credit
model (the API stops working once the loaded balance runs out — no
risk of silent overspend) and, if ever enabled, Tavily's own
dashboard-level pay-as-you-go cap. `isOverRegionCap()`'s query does
count only `'active'`/`'saturated'` (not `'not_started'`) — fixed
2026-07-17 alongside the batch rollout, since counting `'not_started'`
too would have tripped the cap immediately with 331 such rows now
seeded.

### The ~100-unit list — superseded by the above

Earlier plan, kept for history: ~50 Chilean cities as single units,
plus Gran Santiago/Valparaíso/Concepción split by comuna (~34+6+11)
where a single city-level query would blur together genuinely distinct
neighborhood art scenes — roughly 100 units total. Never built; the
all-346-comuna weekly-batch rollout above replaced it before it shipped.

## Fuentes brillantes (bright sources)

A "fuente brillante" is a URL that reliably lists several real events in
one place — fetched **directly** (plain `fetch`, not via Tavily search)
when due (see cadence below), and excluded from regular Tavily searches
for that domain (via `exclude_domains`) so the search budget isn't spent
re-discovering what's already covered directly.

**Per-source 2-week fetch cadence, independent per source** — until
2026-07-17, every known+detected source was fetched on every single run
with no gating at all. Same shape as `regions`' own `last_run_at` +
28-day "due" check (`apps/curator/src/event-discovery/run.ts`'s
`isDueForRun`), but a 14-day interval and keyed by the source's own `url`
in a standalone `bright_source_fetch_state` table (not a column on
`regions` or `detected_sources` — `KNOWN_SOURCES` is hand-curated in
code, not a DB row, so `url` is the only identity both hand-curated and
auto-detected sources share). Records an *attempt*, not just a success —
`fetchBrightSources` already swallows a single source's own fetch failure
(network error, 404, etc.) and logs it rather than throwing, so there's
no separate success/failure signal left by the time the cadence gets
recorded; retrying a broken source every run wastes just as much time as
retrying a working one. `excludeDomains` (what regular per-unit Tavily
search won't surface) stays based on *every* known bright source
regardless of due-state — a domain shouldn't resurface via Tavily search
just because we happen to not be re-fetching it directly this particular
run.

**Two different exclusion lists feed `excludeDomains`, for two different
reasons** — bright-source domains (above), and, as of 2026-07-19,
`KNOWN_LOW_QUALITY_SOURCE_DOMAINS` (`apps/curator/src/lib/
known-exclusions.ts`): domains we never want content from at all, because
their per-event extraction is unreliable (real case: infobae.com's weekly
agenda-cultura roundup bundles many events from multiple countries into
one tangled page — see the "Location" bullet above for the analogous
Recoleta/Buenos Aires bug this same domain also produced). Both lists get
merged into the one `excludeDomains` array passed to Tavily, so it ideally
never returns either kind of domain in the first place (saves the
credits/tokens of a result we'd discard anyway). But Tavily's own
`exclude_domains` isn't perfectly reliable, so `filterKnownExclusions`
still filters the same low-quality domains from whatever Tavily actually
returns — belt and suspenders, same reasoning already applied to the
Recoleta/Argentina location filter.

**Pagination via `additionalPages`** — some listing pages are big enough
that page 1 alone misses real, current events. Real find (2026-07-17):
arteinformado.com's Chile listing isn't sorted chronologically or by
"vigencia" — it's sorted by whatever their editors most recently added,
so page 1 alone missed a real exhibition ("Sín-tesis", Galería NAC) that
only showed up on page 2. `KnownSource.additionalPages?: string[]` lists
extra URLs whose content (same `extractor`) gets fetched and appended
into the SAME single `RawResult` as the primary page — one logical
source, not one per page, so `mergeBrightSources`'s per-domain dedup and
the run's overall "one bright-sources curate() call" shape stay intact.
Kept deliberately small (arteinformado.com: 2 pages of ~423 total) — the
site's own sort order means later pages increasingly return events that
have *already ended* (a real check: page 5 already had events that ended
~2 months before the check date), so fetching many pages would mostly
waste Haiku input tokens on content that gets filtered out downstream
anyway. A failure fetching an *additional* page is logged and skipped,
not fatal to the source — only the primary page's own failure still
fails the whole source, unchanged from before `additionalPages` existed.

**`type` decides how a source is fetched** (`apps/curator/src/lib/known-sources.ts`):
- `"html"` (default) — a plain page fetch.
- `"json-api"` — a REST call, no HTML involved.

**`extractor` (optional, config-driven) decides how per-event structure
gets pulled out of what was fetched** — a registry
(`apps/curator/src/event-discovery/extractors.ts`) instead of one hardcoded
parser function per site. Adding a new bright source with known structure
means writing a config entry, not new parsing code. Two shapes exist so
far, matching the two kinds of structure real bright sources have shown:

- `articleList` — an HTML listing page where each event lives in its own
  repeating block. uchile.cl's config: a `blockRegex` matching each
  `<article class="mod-cal-result__item">`, plus regexes for the
  title+link, date range, and place *within* that block. Extracts `<img
  src/alt>` pairs *before* stripping tags (a real bug — the original crude
  tag-strip threw away real per-exhibition thumbnails that were sitting
  right in the HTML, fixed by pulling images out first), resolves relative
  image URLs against the page's own origin, and — critically — keeps each
  event's own image and individual page URL paired with *that* event, not
  pooled with every other event on the page. A real bug this fixed: the
  original whole-page-flatten approach lost that pairing entirely, so
  Haiku had to blind-match N images to N events from one pooled list and
  got some wrong (confirmed: 3 of 15 in a real run against uchile.cl).
- `wordpressRestApi` — a WordPress REST endpoint, fields named per-site
  (dotted paths in the config, e.g. `meta.link_al_evento`) since a site's
  custom meta-field names aren't a WordPress standard. Example: Parque
  Cultural Valparaíso's events widget is JS-rendered (invisible to a plain
  `fetch` — confirmed the raw HTML response never contains the widget's
  real content anywhere, even though the browser's DevTools shows it after
  JavaScript runs), but the widget itself calls a clean WordPress REST
  endpoint (`/wp-json/wp/v2/events_list`) found via the browser's Network
  tab — hitting that directly gives real, structured title/image/
  description/date fields per event, no guessing required. One real find
  worth noting: its `hora_de_inicio`/`hora_de_termino` fields are the
  *venue's* daily opening hours, not the actual inauguración time — the
  real opening time, when there is one, is only in the free-text
  description field, so Haiku still needs to read that rather than trust
  the structured hour fields blindly.

**A source with no `extractor` configured** — every auto-detected source
today, since the `detected_sources` table only stores the simple `type`
enum, not a full parser config — falls back to a generic whole-page
flatten for `"html"` sources (tags stripped, `<img src/alt>` pulled out
first, same as before this registry existed), or a clear log-and-skip for
a `"json-api"` source nobody's written a config for yet. Upgrading an
auto-detected source to real structured extraction is a manual step: a
human notices it during the periodic `lastReviewedAt` review and adds an
`extractor` entry for it in `known-sources.ts`.

**Curated once per run, separately from any single unit's search** — not
attached to each unit's own prompt. Real bug found and fixed: when
attached to every unit's prompt, Haiku inconsistently decided whether to
report the bright source's content at all (sometimes reported it fully,
sometimes not at all, run to run) — running it through its own dedicated
curate() call makes its yield deterministic instead of depending on which
unit's call happened to surface it.

**Auto-promotion, not manual-only:** a domain (never a social platform —
`instagram.com`/`facebook.com`/`tiktok.com`/`twitter.com`/`x.com`, shared
by thousands of unrelated accounts — and not already known) that
contributes **2+ "complete" events** in one run — image + title + a start
date within the current month — gets auto-added to the `detected_sources`
Supabase table, merged with the hand-curated `KNOWN_SOURCES` list at the
start of every run (a table, not a local JSON file — GitHub Actions
runners are ephemeral, nothing on disk survives between monthly runs). No
source file gets rewritten by the script; `known-sources.ts` stays the
manually-reviewed list, detection just grows a separate table alongside
it. **`description` is deliberately not required** for "complete" — a
real test against arteinformado.com (a
genuinely rich source, 10 real Chilean exhibitions, 2 within the current
month, all with real images) showed Haiku correctly leaves `description`
null when a source only lists structured facts with no prose per event;
requiring it would have disqualified a legitimately good source.

**Known, accepted limitation:** JS-rendered pages whose real content only
exists after client-side execution are invisible both to a plain `fetch`
and, apparently, to Tavily's own indexing (a real test: Tavily searching
"Valparaíso" never surfaced Parque Cultural's JS-only listing page at all).
No algorithm currently discovers these — a human has to notice the real
content in a browser and point to the underlying source (as happened here,
via DevTools → Network tab → the actual JSON endpoint). Tested and
rejected as a general fix: inferring a "parent listing" URL by truncating
an individual event's URL path — doesn't work reliably (confirmed on this
exact site: neither the naive parent path nor Tavily's own top-scored
result for this domain matched where the real content actually lived).
What *does* work automatically, confirmed with a real search: Tavily
sometimes independently finds a different, genuinely scrapable listing
page for the same domain (e.g. a WordPress category-archive page,
`/events/categories/exposicion/`, whose snippet already showed 2+ distinct
exhibitions) — when that happens, the existing domain-based auto-detection
above picks it up on its own, no new engineering needed. The expectation
going forward: most useful bright sources will keep surfacing this way,
supplemented by occasional manual additions when a human notices something
the pipeline structurally can't see (JS-only pages).

**Finding the next one, deliberately manual, not automated:** every regular
per-unit search result gets logged to `raw_search_results` (title, url,
domain, score) — a 7-day rolling window, pruned automatically at the start
of every run, not a permanent archive. `events` can't serve this purpose:
a listing/aggregator page can show up in every search and, if Tavily's
snippet of it is too thin, never produce even one candidate — so it would
never appear there, even though the page itself might be genuinely rich
(found this exact way: `mnba.gob.cl/cartelera`, added as a bright source
after showing up repeatedly in Santiago searches with a weak yield). The
review itself is ad-hoc SQL against this table (group by domain, look for
ones that keep showing up) followed by manually fetching the page and
testing a candidate `extractor` config — same process used for every
bright source added so far, not a new capability. Deliberately not
automated: an LLM inline-generating an extraction regex from raw HTML
during curation would be expensive (full HTML pages are token-heavy) and,
worse, would ship unvetted — every extractor config in `known-sources.ts`
so far was hand-tested against real data before being trusted with no
human in the loop after that.

### Post-curation enrichment: image and opening time (`lib/page-fetch.ts`)

Real bug (found 2026-07-19, manual review): arteinformado.com's listing
page (`daysRegex` above) only ever gives a date **range** per event ("15
jul de 2026 - 22 ago de 2026"), never the specific opening date+time — that
only exists on each event's own detail page, in a structured "Inauguración
: 15 jul de 2026 / 19 a 21 h." line. The pipeline never fetched that page,
so all 10 approved arteinformado.com events in production had
`opening_datetime = null` — confirmed systemic across every event from
that source, not a one-off Haiku miss.

**Fix, deterministic, zero extra Anthropic/Tavily cost:** `enrichCandidates`
(`lib/page-fetch.ts`) runs once per run, on every *approved* `EventCandidate`
regardless of source (bright source or regular per-unit search) whose
`sourceUrl` is still missing an image, or whose `openingDatetime` is still
null AND whose source domain has an opt-in `openingTimeExtractor` regex
configured (`KnownSource.openingTimeExtractor`, `lib/known-sources.ts` —
sibling to `extractor`, not nested inside it, since the opening time lives
on a *different* page than the listing markup `extractor` describes).
Regex-only against the fetched page's collapsed-whitespace text (`lib/
opening-time.ts`'s `extractOpeningDatetime`) — never sent to Haiku, so this
adds no Anthropic tokens; the only new cost is the HTTP fetch itself.

**One fetch per candidate, not two:** a candidate needing both an image and
an opening time gets exactly one `fetchDetailHtml` call, with both
extraction goals run against the same already-fetched HTML — confirmed via
a test asserting the stub fetch is called exactly once for such a
candidate. Fetched in chunks of `ENRICHMENT_CONCURRENCY = 4` (chunked
`Promise.all` batching, no new dependency) rather than fully sequential or
fully unbounded — a deliberately conservative constant given unknown
per-request latency to arbitrary third-party sites, politeness toward
those sites, and headroom under the 346-comuna weekly batch's 6-hour
GitHub Actions ceiling; revisit once real timing data exists.

**Chile-timezone correctness:** the extracted wall-clock time (e.g. "19:00"
in "Inauguración... / 19 a 21 h.") is converted to an absolute UTC instant
via a two-pass `Intl.DateTimeFormat` offset-correction (`lib/
opening-time.ts`'s `santiagoWallTimeToUtcIso`) — no hardcoded UTC offset,
since Chile's DST rule has changed more than once in recent years.

**Caveat, don't skip when adding a new source's `openingTimeExtractor`:**
the regex must be hand-verified against that source's real detail-page
HTML, not just a plain-text example of the expected phrasing — the real
arteinformado.com markup has a `</span>` and `<br/>` sitting between the
"Inauguración" label and the date, invisible in a plain-text mockup of the
phrase, only caught by fetching the real page and checking.

**Year inference (added 2026-07-20, for uchile.cl):** not every source
publishes a year at all — uchile.cl's root domain phrases the opening as
an invitation, "Los esperamos este miércoles 01 de julio a las 18.00h.",
with no year anywhere on the page (checked meta tags too), since it's a
rolling near-term agenda where the year is implicit. `extractOpeningDatetime`
now accepts an optional `referenceDate` (defaults to the real clock at the
call site) and only infers a year when the regex's `year` capture group is
absent: current year, unless that would place the date more than 60 days
in the past relative to `referenceDate`, in which case next year (handles
a December-published page meaning next January). Sources that do publish
a year (arteinformado.com) are unaffected — this only activates when the
regex config genuinely has no `(?<year>...)` group.

**Same root-cause bug as arteinformado.com, different domain
(found 2026-07-20):** `uchile.cl`'s ROOT domain (not `artes.uchile.cl`,
which already had a dedicated entry) had no known-source config, so an
event from Facultad de Arquitectura y Urbanismo's Galería Micromedios
(never surfaced by the Artes-only `artes.uchile.cl` feed) came in via
regular per-comuna Tavily search, which drops per-event links from a
listing page — Haiku fell back to citing the listing page itself as
`sourceUrl` instead of the event's own detail page. Same fix as
arteinformado.com: a dedicated `articleList` extractor (identical config
to `artes.uchile.cl`'s — confirmed the two domains share the exact same
underlying CMS/markup) resolves each event's real per-event href.

**Date-only confirmations, `opening_time_confirmed` (added 2026-07-20):**
found via manual review — arteinformado.com's "Sín-tesis" confirms an
inauguración date ("Inauguración: 14 jul de 2026") with no time at all, a
genuine editorial gap on that source's own page. Before this, a missing
hour made `extractOpeningDatetime` return `null` entirely, silently
dropping the confirmed date — the event only ever showed as an "expo
actual," never as an "inauguración," even though the venue explicitly
confirmed one. Now `extractOpeningDatetime` returns `{ iso, timeConfirmed
}`: when the regex's `hour` group is absent, `iso` holds midnight
America/Santiago (a real instant, via the same `santiagoWallTimeToUtcIso`
used for real hours) and `timeConfirmed` is `false`. The new
`events.opening_time_confirmed` column (see data-model.md) persists this;
`apps/web`'s `EventCardBase` reads it to show "consulta la hora con el
lugar" instead of a fabricated hour.

**Update (found and fixed 2026-07-21): Haiku's own curation had the same
bug, worse.** The note above ("Haiku's own initial curation is
unaffected... its prompt already requires an explicit hour before it ever
sets `opening_datetime` at all") described the bug, not a safe design —
requiring date AND hour together meant a confirmed date with no reported
hour was discarded entirely, not downgraded to `opening_time_confirmed:
false`. Found via a user question ("si hay una inauguración por qué el
discovery no puede conseguir la hora?"); confirmed via
`curation_reasoning ILIKE` search in production, not assumed — 7 events
whose own `curationReasoning` explicitly stated the inauguración date was
confirmed (e.g. "Inauguración de ExpoArte.Co confirmada en reel de
Instagram del 15 de julio 2026") still had `opening_datetime: null`,
purely because Haiku's prompt gave it no way to report "date yes, hour
no." Fixed by extending the same convention the regex path already used:
`buildSystemPrompt` now tells Haiku to report `openingDatetime` +
`openingTimeConfirmed` as two separate fields — date+hour confirmed →
both real values and `openingTimeConfirmed: true`; date confirmed but no
hour → the date with a "00:00" placeholder hour and
`openingTimeConfirmed: false` (never null just for a missing hour, since
the confirmed date alone is real, useful information); no confirmed
inauguración at all → both null/false, unchanged. `parseCandidates`
reads Haiku's `openingTimeConfirmed` directly now, defaulting to `true`
only if Haiku's output omits it or sends a non-boolean (malformed-output
fallback, not the normal path). The past-event/mismatched-month
hallucination warnings already in the prompt (see above) are unchanged —
this only affects the missing-hour case, not the "is this actually an
inauguración" judgment call the user also asked about.

**Follow-on regression from the above, found and fixed same day
(2026-07-21):** the deterministic post-curation re-fetch (`lib/page-fetch.ts`'s
`processCandidate`/`enrichCandidates`, for the 2 known sources with a
registered `openingTimeExtractor` — arteinformado.com, uchile.cl) used to
gate on `c.openingDatetime === null`, since before this fix that was the
only way a date-only confirmation from Haiku could arrive. Once Haiku
started reporting date-only confirmations as a real `openingDatetime` +
`openingTimeConfirmed: false` (immediately above), that gate stopped
firing for exactly this case — the one it exists for. Concretely: a known
source's detail page that actually states the real inauguración hour
would previously get it recovered via regex re-fetch; after the
`openingTimeConfirmed` change and before this fix, it silently kept
Haiku's "00:00, unconfirmed" placeholder instead, even though the real
hour was one fetch away. Fixed by gating on `!c.openingTimeConfirmed`
instead — covers both the original no-confirmation-at-all case (still
paired with `openingDatetime: null`) and the date-only case, without
needing to check `openingDatetime` at all.

**Deterministic freshness backstop, `lib/post-freshness.ts` (added
2026-07-21):** the user asked whether a post-curation re-fetch could
verify a candidate is genuinely a valid, current inauguración and not an
old post re-surfacing — same underlying concern as the timezone/hour bugs
above, but about the YEAR being wrong rather than the hour being missing.
Investigated by sampling 15 real production `sourceUrl`s currently sitting
at `openingTimeConfirmed: false` (fetched for real, not assumed) before
building anything, per this doc's own established practice of validating
regexes against real pages first. Found **7 of 15 (47%) had a real publish
date that didn't match the month Haiku searched for** — worse than an
earlier, narrower measurement that only checked for an explicit wrong year
inside Haiku's own `curationReasoning` text and concluded (incorrectly)
that the two 2026-07-18 hallucination-guard prompt fixes had already
closed this gap. Two real examples the narrower measurement missed
entirely: "Río Cochrane" (a prensaeventos.cl news article whose own
JSON-LD `datePublished` is 2023-07-12, over 3 years before the July 2026
run that surfaced it) and "Lafken Püllü" (an Instagram post about an April
30, 2026 opening, curated into a July 2026 run — same year, 3 months off).

Two independent publish-date signals, found via the same sampling: (1)
standard `datePublished` (JSON-LD) / `article:published_time` meta —
common across CMS-driven sites, and (2) Instagram's `og:description`
caption byline (`"<user> on <Month> <DD>, <YYYY>:"`), which Instagram
emits instead of the standard tags above. Facebook was checked and
exposes neither via a plain fetch — not covered. `extractPublishedDate`
tries both, returning `null` (never treated as stale) when neither is
present, which is the common case.

`isStalePublishYear` deliberately compares **only the year**, not the
month — the sample showed real, legitimate same-year gaps (an exhibition
announced weeks ahead of its own opening, or still running weeks after
it), and month-level comparison would risk rejecting those without more
data to tune a threshold safely. Every confirmed-stale case in the sample
had a different year from the target run; every legitimate case shared
the target year. The "Lafken Püllü" case above (same year, wrong month)
is a known, **documented, unhandled gap** — revisit with more real
same-year-mismatch data before tightening this rule.

Wired into `enrichCandidates`: previously a candidate was only re-fetched
if it needed an image or a known-source opening-time extraction; now
**every approved candidate with a `sourceUrl` is fetched**, since a stale
post can arrive with an image and a confirmed hour just as easily as
without — the freshness check has to run independent of what else needs
enriching. A stale match sets `status: "rejected"` directly in code (same
"belt and suspenders" pattern as the Recoleta foreign-country blocklist
override above), so a stale candidate never reaches `insertCandidates`
regardless of how confident Haiku's own `curationReasoning` was.

**Generic hour recovery, `extractGenericInauguracionHour` (added
2026-07-21):** initially deferred (only 3/6 genuinely valid inauguraciones
in the 15-URL sample had an extractable hour, a 50% hit rate) but revisited
same-day after the freshness backstop above shipped — it fetches the real
page for EVERY approved candidate now regardless, so the network cost this
feature would have added no longer exists, and the user considers a
confirmed hour (not just a confirmed date) core to Caldearte's value.
Zero added Anthropic/Tavily cost either way — purely regex over HTML
already in memory, no extra API calls.

Unlike the 2 known-source configs, this pattern isn't tied to any one
domain's markup — matched against any fetched page — so it needs a safety
net a domain-specific pattern doesn't: the page can mention a date/hour
that has nothing to do with THIS event (a venue's regular opening hours,
a different listed event on the same page). The fix: Haiku already told
us the confirmed DAY and MONTH (just not the hour) — `extractGenericInauguracionHour`
returns whatever day/month/hour it found, and `page-fetch.ts` only trusts
the extracted hour if its day AND month match the date Haiku already
confirmed (`utcIsoToSantiagoDateParts`, opening-time.ts's new inverse of
`santiagoWallTimeToUtcIso`). A mismatch leaves the candidate exactly as it
was — placeholder hour, `openingTimeConfirmed: false` — rather than
attaching an unrelated time. Pattern shape, confirmed against the 2 real
examples in the sample: `"Inauguración: [día,] D de MES[,] HH[:MM]
h/hrs/horas"` (Michel Taverne: "Inauguración: 4 de junio, 19 hrs"; Centex:
"Inauguración: sábado 11 de julio, 12:00 horas").

**"de" made optional (found and fixed 2026-07-21, same day):** ran Event
Discovery manually right after shipping this to check all 4 fixes with
real data. 5 approved candidates landed with a confirmed date and
unconfirmed hour, but the generic extractor recovered 0 — traced it to a
real page (Quilpué, Instagram) whose text read "Inauguración 10 julio
12:00 hrs", no "de" between the day and the month, unlike every example in
the original 15-URL sample (which is why it wasn't caught building this).
Fixed by making "de" optional in the pattern. Same run separately
validated the freshness backstop hard: 17 of the 47 candidates Haiku
itself approved got overridden to `rejected` in code for a real publish
date that didn't match July 2026 — including a 2024 Instagram post
("Casa del Arte", Talca) whose caption read as a perfectly current
"jueves 2 de julio... 19:00 hrs" two years early, and a 2019 utalca.cl
listing page.

**Haiku-set `openingDatetime` timezone bug (found and fixed 2026-07-20):**
found via a user report — a card showed "08:30 hr" for an event whose own
source page said "12:30 hrs" (Factoría Franklin), a suspiciously exact
4-hour gap (America/Santiago is UTC-4). Root cause: `buildSystemPrompt`
asked Haiku for "fecha Y hora exacta" with no format/timezone spec, and
`parseCandidates` wrote Haiku's raw string straight to `opening_datetime`
(a `timestamptz`) with zero conversion — unlike the deterministic regex
path (`lib/opening-time.ts`), which has always correctly converted Chile
wall-clock time to UTC via `santiagoWallTimeToUtcIso`. Whatever timezone
convention Haiku happened to use for its raw string (most likely: local
time with a bare "Z"/no-offset suffix, misread as UTC) silently shifted
every Haiku-set opening hour. Fixed by requiring Haiku to report a plain
"YYYY-MM-DDTHH:mm" (explicitly no "Z", no offset) and having
`parseCandidates` convert it via the newly-exported
`parseLocalDatetimeToUtcIso` (same underlying `santiagoWallTimeToUtcIso`),
mirroring the regex path exactly. A malformed/unparseable string now
degrades to `openingDatetime: null` rather than a silently wrong instant.
Production rows written before this fix may still hold the wrong hour — a
backfill was prepared separately (see the user's own record, not tracked
in this repo) since curator has no production write access via its
tooling here.

**Instagram/Facebook no longer hard-skipped (found and fixed 2026-07-20):**
a product-value audit found ~66% of approved events showing the generic
placeholder instead of a real photo, and traced it to Instagram/Facebook
being ~59% of approved events combined with `fetchDetailHtml` hard-skipping
any social-media `sourceUrl` — a design decision made on the assumption
those pages "need JS/login to render for a plain fetch," never actually
verified. Tested against 9 real production URLs (6 Instagram reels/posts, 3
Facebook posts): a plain fetch, no special headers, no crawler-impersonating
user-agent, reliably returned a working `og:image` for every one — that
assumption held for profile/feed pages, not for individual post/reel
permalinks. `fetchDetailHtml` no longer excludes these domains, so
`enrichCandidates` now recovers an image for them the same way it already
does for every other source. `isSocialMediaUrl` stays exported — still used
by `image-rehost.ts` to know when a recovered `imageUrl` is one of these
signed, short-lived CDN links that needs re-hosting before it rots (see
"Post-curation image re-hosting" below). Same ToS-gray-zone caveat as any
scrape of a site with no official API for this use case — could stop
working without notice if Meta changes markup or tightens bot detection;
not a guaranteed-permanent fix, worth re-verifying if image recovery for
these sources silently drops off in a future run.

### Post-curation image re-hosting (`lib/image-rehost.ts`, added 2026-07-20)

An Instagram/Facebook `imageUrl` — whether it came from Tavily directly or
from the `enrichCandidates` recovery above — is always a signed CDN link
(`scontent.cdninstagram.com`/`fbcdn.net`) that rots within hours to days
(confirmed against real samples: one was already dead a few hours after
capture). `apps/web`'s `resolveCardImage` has always distrusted these
entirely for that reason, always showing the branded placeholder instead.
`insertCandidates` (`event-discovery/run.ts`) now downloads the image at
curation time — while the signed link is still valid — and re-uploads it to
a public `event-images` Supabase Storage bucket
(`supabase/migrations/20260720080000_create_event_images_bucket.sql`),
swapping in the new permanent URL before the row is written. Fails closed
to `null` on any error (bad content-type, oversized body, network/upload
failure) rather than storing a link already known to rot. `resolveCardImage`
now trusts a URL on the same host as `NEXT_PUBLIC_SUPABASE_URL` as a real
photo, while still falling back to the placeholder for a raw, untouched
social CDN link.

**Deliberately scoped, not a full fix**: this only covers events that
already have an `imageUrl` captured (whether via Tavily or the
`enrichCandidates` recovery above) — storage cost was checked before
building (real measured sample sizes 25KB-1.9MB, ~9 re-hostable
Instagram/Facebook events/week at the current batch size project to
roughly 4 years before Supabase Storage's 1GB free tier is reached — no
near-term pressure). Not retroactive: events already approved before this
shipped keep showing their placeholder; the effect only applies going
forward.

**Instagram/Facebook image recovery effectively broken since it shipped,
found and fixed 2026-07-22:** manual review of the 2026-07-22 production
run found only 2 of 29 approved candidates had an image at all — looked
like a bot-blocking issue at first (Instagram's CDN is exactly the kind of
host that blocks datacenter fetches) but wasn't. Root cause:
`extractOgImage`/`extractTwitterImage` (`lib/page-fetch.ts`) captured a
`<meta ... content="...">` attribute's raw HTML value with no entity
decoding — Instagram's CDN URLs are always query-string-heavy (signature
params `oh`/`oe` the CDN needs to authorize the request), and HTML encodes
`&` as `&amp;` inside an attribute value, so every recovered URL came
through with the literal text `&amp;` instead of `&`, corrupting the query
string and losing the signature entirely. Confirmed directly: fetching the
corrupted URL 403s regardless of user-agent or referer; fetching the exact
same URL with `&amp;` decoded back to `&` returns a real JPEG. This bug
predates today — it's been silently starving `image-rehost.ts` of anything
to rehost since Instagram/Facebook detail-page fetching shipped
(2026-07-20), not a regression from this session's other fixes. Fixed with
a small `decodeHtmlEntities` step (`&amp;`, `&quot;`, `&#39;`, `&lt;`,
`&gt;` — only what can plausibly appear inside a URL, not a general
decoder) applied to both extractors' captured value.

## Event Discovery quality audit (2026-07-20)

User-requested audit of a real production run (25 comunas + the `uchile.cl`
bright source, 218 candidates, 90 approved). Four real issues found and
fixed same-day; two more identified but deliberately deferred (see below).

**Fixed:**

- **`isChileanLocation` whitelist drift (`lib/locations.ts`)**: `CHILE_MARKERS`
  was a hand-picked ~100-entry subset, curated once for an earlier, smaller
  rollout list, never kept in sync as `regions` grew to 346 comunas. 14 of
  the 25 comunas in the audited run (Colbún among them) weren't in it at
  all — genuinely Chilean, Haiku-approved events in those comunas got
  force-rejected with `[FILTRO DE CÓDIGO: ubicación no reconocida como
  chilena]`. Fixed by regenerating the comuna portion of the list from a
  full snapshot of `regions` (`select name from regions order by name`,
  346 rows as of 2026-07-20) instead of a hand-maintained subset. Also
  added "Coihaique" (official current spelling) alongside the pre-existing
  "coyhaique" (legacy spelling), covering both. This is a snapshot, not a
  live query — see "Structural gaps, not yet fixed" below for why it can
  still drift again.
- **Duplicate-insertion gap (`lib/event-filters.ts`'s new `normalizeLocation`,
  used by `run.ts`'s `locationDateKey`)**: the same festival (ARTEPUERTO
  2026 / Casaplan, Valparaíso) got inserted 3 times in one run — 3
  different social posts reported the location as "Valparaíso, Chile" vs
  "Valparaíso" vs a venue-prefixed variant, each producing a different
  dedup fingerprint even though `normalizeTitle`-style
  accent/case/whitespace normalization was already applied. Fixed by
  extracting only the first comma-segment (the actual comuna/ciudad,
  per `location`'s own documented meaning) before fingerprinting — a
  trailing ", Chile" or region name is noise that varies source-to-source
  for the same real place.
- **`ART_SCOPE_POLICY` referenced a nonexistent status (`lib/curation-policy.ts`)**:
  told Haiku to use `"pending_review"` for ambiguous artistic-intervention-
  vs-conventional-show calls — but Event Discovery's `status` is strictly
  binary (approved/rejected; see overview.md's "Ambiguous cases... not
  built"). That instruction was unsatisfiable, leaving Haiku with no real
  guidance for the ambiguous case. Likely contributed to two real
  scope-creep approvals found in the same audit ("Conversatorio Quebrada
  Honda", "Catastro Arte Público Constitución" — both literally panel
  talks, approved with reasoning stretching them into "intervención
  artística participativa"). Fixed to say "reject" for the ambiguous case
  instead, matching the default-exclude philosophy the four content axes
  already use, and to explicitly name conversatorios/charlas/mesas
  redondas and generic cultural-heritage days as their own out-of-scope
  category (previously only conventional theater/concerts/dance were
  named explicitly).

**Deliberately not fixed (judgment calls, not bugs):**

- **Institutional-scale festivals classified as visual art** (e.g. "Tianfu
  Festival" — a light-sculpture installation festival, correctly in-scope
  by content even though "Festival" in the title looks concert-adjacent at
  a glance). Confirmed correct on inspection, not touched.

**Also fixed (2026-07-20, same day, as follow-ups):**

- A regression guard for the `CHILE_MARKERS` drift —
  `lib/chile-comunas-snapshot.ts` is a versioned, checked-in snapshot of
  every `regions.name` (346 rows, regenerate by re-running `select name
  from regions order by name;` and pasting the result back in whenever a
  migration adds/renames comunas), and `locations.test.ts` asserts
  `isChileanLocation` covers every name in it. This would have caught the
  Colbún-and-13-others bug before a real run did — but note it's a
  **static snapshot test, not a live query**: this repo has **no CI
  workflow that runs `pnpm test` at all** today (only
  `deploy-migrations.yml` and `event-discovery.yml` exist; the green
  checks on a PR are Vercel's `apps/web` deploy, unrelated to
  `apps/curator`'s test suite) — real production bug found while
  investigating this (2026-07-20): so the test only protects whoever
  happens to run the suite locally, and still needs a human to remember to
  regenerate the snapshot after a `regions` migration. Wiring an actual CI
  test workflow (and/or making this check live-query `regions` instead of
  a snapshot, when Supabase credentials are available — same
  optional-skip pattern already used by `usage-tracking integration`) are
  the natural next steps, not done here.
- **Cross-run fuzzy dedup** (`lib/event-filters.ts`'s new
  `isLikelySameTitle`, used by `run.ts`'s `insertCandidates`): the exact
  `locationDateKey` fingerprint only catches duplicates sharing the exact
  same location AND exact same datetime — two sources reporting the same
  real opening with slightly different exact hours ("19:00" vs "19:30")
  still evaded it even after the location-normalization fix. Added a
  fourth, coarser dedup signal: same normalized location + same calendar
  DAY (not exact time) + title word-overlap (Jaccard) >= 0.6 with at least
  2 shared significant words (generic art-event vocabulary like
  "exposición"/"muestra"/"arte" and bare years are excluded from the word
  sets first, so two genuinely different events don't get merged just for
  sharing generic vocabulary and a comuna). Deliberately conservative on
  both axes (day-level, not a wider date-range tolerance; two-part
  threshold, not Jaccard alone) — a false merge silently drops a real,
  distinct event, which is worse than an occasional missed duplicate.
  Verified against the ARTEPUERTO trio itself: title similarity alone does
  NOT flag any pair of those three real titles (they're genuinely too
  different in wording) — confirming that bug was actually the
  location-string-normalization gap fixed separately, not something title
  similarity could or should have caught.
- **Bare-domain-root `sourceUrl` visibility** (`discover.ts`'s new
  `logBareDomainSourceUrls`): the 2 found (`museoregionalaysen.gob.cl`,
  `culturacopiapo.cl`) are now logged (`[event-discovery] sourceUrl is a
  bare domain root...`) in the workflow's own run logs for manual
  spot-checking — same visibility mechanism `page-fetch.ts`'s own recovery
  logs already use. Still deliberately NOT a hard rejection, for the same
  reason noted originally: some small-comuna cultural centers genuinely
  only have a single-page site where the homepage IS the correct and only
  page, and a blanket path-based heuristic risks false-rejecting those the
  same way the `isChileanLocation` whitelist drift did for real comunas.

**Structural gaps, not yet fixed (candidates for future work):**

- No CI workflow runs `apps/curator`'s test suite at all (see above) —
  worth its own fix, out of scope for this audit.
- Fuzzy dedup (above) is still bounded to a single calendar day and a
  single run's `loadExistingKeys()` snapshot — two sources posting the
  same event more than a day apart (rare, but possible for a slow-to-post
  account) would still both get inserted.

## Manual review follow-up (2026-07-20, same day) — fabricated openingDatetime + MAVI UC

A user manual review of 3 live production events found a more serious
issue than the audit above: **Haiku fabricated `openingDatetime` values
that don't appear anywhere in the source**, not just misread ambiguous
ones. Two unrelated events (both sourced from Instagram, unrelated
comunas) got the exact same fabricated timestamp
(`2026-07-22T23:00:00Z` = 19:00 Chile) — real content: one was a
*registro* (recap, past tense) of a different, already-held inauguración;
the other's real dates ("23 de diciembre al 28 de enero") had nothing to
do with July at all. A third event (MAVI UC's "La llegada de lo blanco")
had a *visita mediada* (guided-tour) date stored as if it were an
inauguración — Haiku's own `curationReasoning` admitted "visita mediada
confirmada," but the field still got written to `opening_datetime`.

**Fixed — prompt hardening (`discover.ts`'s `buildSystemPrompt`):**
`openingDatetime`'s field instruction now explicitly forbids inventing or
"reasonably completing" a date, with the two real failure patterns above
named as negative examples (a past-tense recap post; a real-but-unrelated
date). A new general rule was added for all fields: nothing gets
extracted unless it's literally present in the source text — no
inferring from "similar" events in the same batch.

**Fixed — deterministic backstop for MAVI/UC agenda
(`discover.ts`'s `nullifyOpeningDatetimeForKnownSources`):** regardless of
prompt quality, `openingDatetime` is now force-nulled (not the whole
candidate rejected — the exhibition and its run dates are usually real)
for any candidate whose `sourceUrl` is `mavi.uc.cl` or `uc.cl`/`www.uc.cl`
under `/agenda` — confirmed via manual site investigation (below) that
these domains never publish a real inauguración date.

**Built (2026-07-20, follow-up) — MAVI as a real bright source, via a
separate headless-browser job.** `mavi.uc.cl`'s own exhibition listing
(`/exposiciones-actuales/`) is a client-rendered Next.js app whose data
comes from `api.agenda.uc.cl` (a Strapi API) that returns `403 Forbidden`
to a plain `fetch()` — confirmed unfixable with the curator's normal
fetch-only architecture. Rather than scraping the rendered DOM, a real
Chromium session (Playwright) intercepts the actual JSON response the
page itself receives from that API — richer and far more robust than
regex over rendered HTML, and it already includes everything needed:
title, a full prose description with the real exhibition dates, a direct
S3 image URL, and a slug to build the real per-event
`uc.cl/agenda/actividad/<slug>` URL. The API's own `dates`/`datesBuilder`/
`nextDate` fields are the museum's regular visiting hours (open
Tue-Sun, same shape every week) — confirmed via a real probe against the
live API — and are deliberately never surfaced as a candidate field at
all; real exhibition dates come from the prose description, curated by
Haiku exactly like any other source.

Deliberately scoped to MAVI specifically, not a generic "headless bright
source" framework — only one real case exists today (see
`measure_before_building_infra` in the user's own project conventions);
a second real case would justify generalizing `KnownSource`/`BrightSource`
with a `requiresHeadless` flag, not before.

**Architecture, per the user's own proposed mitigation** (isolates the
timing/fragility cost from the main run entirely):
- `apps/curator/src/lib/mavi-headless.ts` — `fetchMaviActivities()`
  launches headless Chromium, navigates to the listing, intercepts the
  `api.agenda.uc.cl/api/activities` response, and returns clean
  `MaviActivity[]` (title/content/detailUrl/imageUrl/placeName). Never
  throws — a broken API shape or a Playwright launch failure degrades to
  an empty list, same defensive posture as `sources.ts`'s
  `fetchBrightSources`.
- `apps/curator/src/headless-discovery/run.ts` — its own orchestrator,
  **reusing** `event-discovery/discover.ts`'s `curate()` (same hardened
  anti-fabrication prompt, same `nullifyOpeningDatetimeForKnownSources`
  safety net — MAVI's `uc.cl/agenda` sourceUrl triggers it automatically
  even though this path shouldn't need it) and `event-discovery/run.ts`'s
  `insertCandidates`/`loadExistingKeys`/`loadAllRegions` (now exported)
  for dedup/insertion — no curation logic is duplicated, only the fetch
  step differs from the main run.
- `apps/curator/src/headless-index.ts` + the `discover-headless-sources`
  npm script — separate entrypoint.
- `.github/workflows/headless-bright-sources.yml` — separate workflow,
  Monday 07:00 UTC (1h after the main run), no `TAVILY_API_KEY` (this
  flow never searches). Installs Chromium only in this job, never the
  main one.
- `lib/notify.ts`'s `HeadlessRunSummary`/`buildHeadlessSubject`/
  `buildHeadlessBody`/`sendHeadlessRunSummaryEmail` — a sibling to
  `RunSummary`'s own functions (same format/recipient/never-throws
  posture), not a forced reuse: this run has no comunas or per-unit
  failures in the same sense, so `RunSummary`'s shape doesn't fit
  cleanly.
- Reuses `bright_source_fetch_state` and its existing 14-day
  `isSourceDue`/`recordBrightSourcesFetched` cadence mechanism — MAVI's
  listing URL is just another row, no new table/migration needed.

Why Haiku is still necessary despite the API already giving clean,
complete data (a real question raised while building this): the API
solves fetching, not curation. Two things still genuinely need it: (1)
content-sensitivity curation — MAVI can, in principle, host an exhibition
that needs one of the four axes' tags or exclusion, and skipping Haiku
would mean MAVI-sourced events bypass that check entirely, a real
editorial gap, not a formality; (2) the real exhibition dates live in
free-form Spanish prose (the `content` field), not a clean structured
start/end field — the same kind of parsing Haiku already does reliably
for every other source. Dedup does NOT need Haiku at all — that's
`insertCandidates`'s deterministic dedup, unchanged and reused as-is.

## Manual review follow-up (2026-07-22) — verbatim-quote grounding for date/location

A second round of manual review (after the 2026-07-20 one above) found
that the "NUNCA inventes... cita la frase exacta" prompt instruction —
already in place since 2026-07-20 — didn't stop the same underlying
problem. The user hand-checked 6 real approved candidates from a manual
Event Discovery run and found Haiku fabricating **whole events**, not
just misreading ambiguous dates: specific dates/hours, venue names, even
descriptions, with zero basis in the real source text, while writing a
confident-sounding `curationReasoning`. Real cases, each confirmed by
fetching the actual source directly:

1. **"Columna de @rtorrescultura"**: real caption was only "Columna de
   @rtorrescultura para ARTEPUERTO. Gracias Rafael..." — no date, hour, or
   description of any kind. Curated as "Exposición visual de arte
   plástico (grabadores y esculturas) con inauguración confirmada en
   fecha y hora específicas" — entirely invented.
2. **"CineForo Mariposas Verdes"**: real post was a generic 2025
   year-in-review from a real museum (Museo Juan del Corral), published 5
   months before the target month. Zero mention of "Mariposas Verdes" or
   cinema. Whole event invented.
3. **"Inauguración de arte visual" (Curacautín)**: real article was about
   an exhibition **closing** July 3 in Rancagua — Haiku invented
   "Inauguración: 09 de julio del 2026 a las 19:00 horas" and assigned it
   to the wrong comuna entirely.
4. **"Archivo... (exposición virtual)"**: real name "Archivo del relato
   persistente," published in March, closed March 21 — 4 months before
   the target month. Haiku invented a July inauguración with a specific
   venue.
5. **"Intervención artística de Víctor García Cuevas"**: real post was
   about an exhibition in Jaén, **Spain** ("el refugio antiaéreo de la
   Guerra Civil de Jaén") — Haiku assigned it a Chilean comuna anyway.

A free-text instruction alone isn't a verifiable guardrail — Haiku can
(and did) ignore it while sounding confident. Fixed by making it
verifiable: `EventCandidate` gained `dateQuote`/`locationQuote` — Haiku
must copy the literal source phrase backing `openingDatetime`/`location`,
and a new deterministic filter, `enforceGroundedQuotes` (discover.ts,
chained into `curate()` alongside `applyLocationFilter` and friends),
checks that quote actually appears in the real `block` text Haiku was
given (whitespace/case-normalized substring match — no new API call).
`location` has no nullable fallback, so an ungrounded location rejects
the whole candidate (same severity as `enforceSourceUrlInvariant`);
`openingDatetime` is nullable, so an ungrounded date only nulls that
field, keeping the rest of the candidate (mirrors
`nullifyOpeningDatetimeForKnownSources`'s existing "strip the unreliable
part" approach).

**Deliberately fails closed for now**: a quote that's missing and a quote
that's present-but-not-found get the exact same treatment — this version
doesn't try to distinguish a genuine paraphrase from a fabrication, since
that needs semantic judgment a substring check can't give. Two follow-up
options were discussed and explicitly deferred pending real data: (a) a
second, narrow Haiku call limited to the ambiguous "quote present but not
verbatim" bucket, to rescue legitimate paraphrases without spending on
every approved candidate; (b) reinstating a `pending_review` human
escalation tier (previously decided against 2026-07-19 on "0 genuine
escalations" evidence that predates this finding). Neither is built —
measure the real false-rejection rate from production runs first, same
principle as everywhere else in this doc: ship the cheap deterministic
version, build the expensive one only if data justifies it.

**Cross-result contamination, found and fixed same day (2026-07-22),
first production run after `enforceGroundedQuotes` shipped:** the initial
version checked a candidate's quote against the WHOLE block sent to
Haiku, not just the section for its own result — a unit's search
routinely returns several results in one block, and Haiku could cite REAL
text from a DIFFERENT result and misattribute it to an unrelated
candidate. Two confirmed cases in the very first run: "Instalación País:
Chile 2026" (a plain photography post, no date or venue mentioned at all)
got approved with a fabricated Cerrillos, Santiago venue and a specific
July 9 date/time — text that was real, but belonged to a different result
in the same batch, not this one. "Expo Noah Bliazi" got approved citing
`"La inauguración será este jueves a las 19:30 horas..."` as its
`dateQuote` — a real quote, but from an unrelated Puente Alto post about
164 free community workshops, nothing to do with "Noah Bliazi." Fixed by
splitting `block` into per-result sections (mirroring `buildBlock`'s own
`### title\nurl\ncontent` format) and checking each candidate's quotes
only against its own `sourceUrl`'s section — falls back to the whole
block only when a candidate's `sourceUrl` doesn't match any section header
exactly (an aggregator/listing URL, or a URL Haiku composed slightly
differently), so a lookup miss degrades to the previous coarser check
rather than over-rejecting.

**`null` location crashing whole units, found 2026-07-22 (predates the
grounding fix above — confirmed present in the run before it too):** 6 of
25 units in a production run failed with `Cannot read properties of null
(reading 'split')`. Root cause: `insertCandidates` (`run.ts`) computes a
dedup key (`locationDateKey`/`normalizeLocation`, `lib/event-filters.ts`)
and a region match (`matchRegionId`, `lib/locations.ts`) for **every**
candidate in the batch, not just approved ones — a *rejected* candidate
can legitimately have a null `location` (Haiku doesn't always bother
filling it in for an event it's discarding), and neither function guarded
against that, unlike `isChileanLocation` in the same file, which already
had this exact fix from an earlier incident (2026-07-17). One bad
candidate crashed the whole unit's try/catch in `run.ts`, same blast
radius as the sourceUrl/date crashes documented elsewhere in this doc.
Fixed by making both functions null-safe (`| null | undefined` in the
signature, empty string / `null` fallback) — same pattern, not a new one.

**Day-level freshness + date-completeness backstops, added 2026-07-22:**
the user manually audited all 24 candidates approved in the clean-slate
run above and found two more systemic gaps, unrelated to grounding:

1. **`isCurrentOrUpcoming` was month-level, not day-level** (see its own
   doc comment) — an event whose run ended 11+ days ago still passed
   because the search month itself hadn't changed yet. Real examples: an
   exhibition closed January 12, another closed February 6, a "José
   Venturelli" inauguración whose exhibition closed July 11 (11 days
   stale relative to the July 22 run) — all still shown as current.
   Tightened to compare calendar day against `now`, not month. Real
   month-level behavior it does NOT change: an event opening next month,
   found incidentally, still counts as valid — only the "already fully
   over" case got stricter.
2. **New `enforceDateCompleteness` filter**: an approved candidate with
   no confirmed `openingDatetime` AND no complete `runStartDate`+
   `runEndDate` pair has nothing to place it on a calendar. Real case:
   "Salón de Julio 2026," approved with `curationReasoning` itself
   admitting "sin fecha específica confirmada de apertura" and no run
   dates either — a genuinely empty date picture that still got shown.
   An inauguración only needs a confirmed date (the hour can stay
   unconfirmed, per the 2026-07-21 `openingTimeConfirmed` work above);
   an expo with no inauguración needs both ends of its run, not just one.

Both are pure code, no prompt change, chained into `curate()` alongside
the other backstops.

**Known, not fixed here — flagged as a separate, later task:** the same
audit found several approved candidates violating scope rules the prompt
*already* states explicitly (a call-for-submissions/convocatoria, a
non-art "Lego"-style winter activity, a municipal workshops post, a
school "semana de las artes" activity) — a prompt-adherence gap, not a
grounding or date-completeness gap. Revisit with concrete negative
examples from these real cases, same technique as the grounding section
above, once there's a next round scheduled for it.

**Scope-classification prompt tuning, added 2026-07-22 (same-day
follow-up to the note above):** this can't be fixed with a deterministic
code backstop the way grounding/freshness/completeness were — there's no
verifiable fact to check, it's a judgment call about what kind of
activity a post describes. Fixed the only way available: added the 4 real
cases as concrete negative examples directly in `buildSystemPrompt`'s
existing "Excluye también, explícitamente" section (`discover.ts`), next
to where the convocatorias/talleres exclusions they violate already
lived — same technique as every other "found a real case, cite it in the
prompt" fix in this doc.

- Convocatorias: "¡Últimos días para postular a Confluencias!...
  completa el formulario, envía tu portafolio..." got approved as a
  current exhibition despite being a literal call for submissions, even
  though its own title said "exposición colectiva."
- Talleres: a post about "164 talleres gratuitos" from a municipality got
  approved as a specific exhibition's inauguración — the real content
  never described any exhibition at all.
- New category, not previously covered: recreational/commercial
  activities using art-adjacent language that aren't visual art — "Brick
  Fest 2026" (a Lego-brick building activity for winter vacation) got
  approved as a visual-art exhibition.
- School/institutional activities with an art-themed name that aren't
  themselves a specific exhibition/intervention — a school's "semana de
  las artes" got approved as an inauguración; it's a themed week of
  activities, the same class of mistake `ART_SCOPE_POLICY`'s existing
  "generic cultural/heritage days" clause already covers for
  municipal-level events, just not yet illustrated for a school context.

Deliberately did NOT touch `ART_SCOPE_POLICY`/`lib/curation-policy.ts` —
those mirror `docs/overview.md` verbatim (per their own doc comments),
and the convocatorias/talleres exclusions these new examples reinforce
already live directly in `discover.ts`'s own prompt text, not in the
shared policy constants — same split as before this change, not a new
one. Left this PR unmerged for review (same as the grounding PR, #100)
since it changes the curation prompt, even though it doesn't touch
`docs/curation-policy.md` itself.

**Prompt-only fix proved unreliable, escalated to a deterministic filter
the same day (2026-07-22):** re-ran Event Discovery on a clean slate with
the scope-classification examples above already merged. "CONFLUENCIAS
II" — the exact same Instagram post used as the convocatoria negative
example — was approved again, on the very next run, with the real
"¡Últimos días para postular... completa el formulario, envía tu
portafolio" text still sitting right there in its own section of the
block Haiku received. A free-text example is a suggestion Haiku can
still ignore, same lesson as "NUNCA inventes" alone not stopping
fabrication. Escalated with `rejectConvocatorias`/`looksLikeConvocatoria`
(`discover.ts`) — a deterministic keyword check, same "belt and
suspenders" pattern as the Recoleta location override: requires a call-
to-action phrase (`postular`/`postulaciones`/`convocatoria abierta`/
`llamado a artistas`) together with a companion term
(`formulario`/`portafolio`/`bases de la convocatoria`/`plazo... postula`)
in the SAME phrase's vicinity — deliberately not just "postular" alone,
to avoid false-rejecting a real exhibition that merely mentions having
come out of a past convocatoria retrospectively (e.g. "obra seleccionada
en la convocatoria 2025, ahora en exhibición"). Checked against each
candidate's own result section only (reuses `enforceGroundedQuotes`'s
`splitBlockByUrl`), same cross-contamination guard. Self-mergeable — pure
code, no prompt change, same category as the grounding/freshness/
completeness backstops (#101-103), not the prompt-text PRs (#100, #104).

The original design below — a precalculated global population/distance
ranking with automatic expansion on saturation — predates the decision to
use a fixed, hand-curated ~100-unit list (see above) and simplified
monthly-only cadence. It is **not in active use** and won't be built out;
kept here only so the reasoning (particularly the big-city bias problem)
isn't lost if a future automatic-expansion need re-emerges at a much larger
scale than currently planned.

The core problem it solved: a naive `population / distance^k` ranking lets
a big, distant city permanently "jump the queue" ahead of a small town,
which — left uncorrected — would have produced exactly the outcome the
curation policy argues against (implying "art only happens in big cities").
The fix, if ever revived, was a log-compressed score
(`log(population) / distance^k`) plus a diversity quota guaranteeing every
Nth expansion pulls from a low-population queue regardless of raw score.

North Korea remains excluded outright regardless of any ranking (OFAC
sanctions; all of the project's infrastructure — GitHub, Vercel, Supabase,
Anthropic — is US-based). Russia and China have no such sanctions issue but
are expected to perform poorly under Tavily too (weak coverage of Russian/
Chinese-language sources, national firewalls) — not a decision that needs
making until they'd actually come up in a real expansion, which isn't
planned right now anyway.

## Event Crawler (retired)

An earlier pipeline walked a known `venues` table with Claude Haiku, looking
for new opening announcements at each venue's page. It's been fully removed
from the code and schema — Event Discovery (above) is the only
event-sourcing pipeline now, and it never produces or matches venues. See
git history (`apps/curator/src/event-crawler/`, deleted) for the retired
implementation if it's ever needed for reference.

### No email approval flow yet (not worth building on current evidence)

**Decided:** ambiguous events would land with `events.curation_status =
'pending_review'` and no email — resolved manually in Supabase. The original
design called for an email with two approve/reject buttons (Supabase Edge
Function + one-time token). The original blocker (Resend's paid plan needed
to add `caldearte.com` as a sending domain) is gone — `caldearte.com` is
verified in Resend as of the production launch (2026-07-17/18), used by the
`/contacto` form. But that no longer matters in practice: Event Discovery's
curation call is binary (`approved`/`rejected` only, see
curation-policy.md#human-escalation-not-currently-implemented) — nothing in
production sets `pending_review` today, and real data (271 events as of
2026-07-18, 0 genuine escalations) shows Haiku's binary call isn't leaving
anything genuinely ambiguous. Parked, not an active line item — see
[roadmap.md](roadmap.md)'s Phase 1a.

### Run-summary email (built, 2026-07-19 — separate from the parked flow above)

Not to be confused with the still-parked approve/reject flow above: after
every run, `apps/curator/src/lib/notify.ts`'s `sendRunSummaryEmail` sends a
plain-text report to the project owner — comunas consultadas (including any
that failed and stay due for retry), fuentes brillantes fetched, candidate
counts (approved/rejected by Haiku's curation call, vs. actually inserted —
kept as separate numbers since a candidate can be approved by curation but
still filtered out as stale or a cross-run duplicate before insert), a
`mediumType` breakdown, and an estimated cost for the run. Reuses the
`caldearte.com` domain already verified for `/contacto`, and a separate
`RESEND_API_KEY` GitHub Actions secret (not the same store as `apps/web`'s
Vercel env var of the same name).

**Adds no measurable cost:** every figure comes from data the run already
computes — the `usage` object each `curate()` call already returns (cost,
via `estimateCostUsd`, re-run locally with no new API call) and the
`credits` each `searchUnitFn` call already returns (Tavily spend estimate,
at the pay-as-you-go rate of $0.008/credit). The only new cost is one
Resend send per weekly run — negligible against its 100/day free tier.
Ancillary by design (wrapped so a failure building or sending it can never
fail an otherwise-successful run, same posture as `pruneOldRawSearchResults`/
`persistNewBrightSources`) — and it no-ops with a warning, not an error, if
`RESEND_API_KEY` isn't set.

---

## Cost governance

A self-tracked ledger keeps both processes bounded, without depending on
Anthropic's billing API.

### The self-tracked ledger

- **`system_config`** table — plain key/value config, editable directly (no
  redeploy needed): `monthly_budget_usd`, `max_total_regions = 200`.
  **Ceiling relaxed:** the original $10/month figure is no longer a hard
  cap — up to **$50/month** is acceptable if real event quality/coverage
  justifies it, confirmed against real measured Event Discovery costs (see
  above) that stay far under that even at meaningfully larger scale.
- **`api_usage_log`** table — one row per paid Anthropic call: model,
  purpose, token counts (including cache read/write), estimated cost from a
  hardcoded per-model $/Mtok table (`apps/curator/src/lib/pricing.ts`).
  **Tavily spend is not tracked here** — it's a separate provider/billing
  relationship, tracked on Tavily's own dashboard instead of force-fit into
  a schema built around Anthropic's pricing shape.
- `apps/curator/src/lib/usage-tracking.ts` exposes `recordUsage()`,
  `getCurrentMonthSpend()`, `getConfigNumber()`, `isOverBudget()`, and
  `isOverRegionCap()` — any future code touching Anthropic spend should
  route through these.

### What happens when the ceiling is hit

Hitting `monthly_budget_usd` blocks **new region activation only** — under
the simplified, fixed ~100-unit design above, this specific mechanism is
less relevant (there's no automatic expansion to block), but the ledger and
ceiling still apply generally as a spend guardrail. Raising the ceiling is a
one-line SQL update, no redeploy required.
`apps/curator/src/lib/notify.ts` opens a GitHub issue (labeled
`budget-alert`, deduplicated) the moment the ceiling is hit.

### Cost-reduction techniques

- **Tavily's own `score < 0.15` filter** — dropped before reaching Haiku,
  confirmed zero observed event loss against real logged data.
- **Image filtering** (require alt text, cap per result, drop obvious
  chrome) — cut token volume roughly 60% in a real before/after comparison
  with no observed quality loss.
- **Bright sources curated once per run, not once per unit** — avoids
  paying to re-curate the same aggregator's content N times, one per unit,
  which was the original (wasteful, and inconsistent — see above) design.
- **Prompt caching** — implemented on Event Discovery's system prompt via
  `cache_control`, currently a no-op (prompt is under Haiku's 2048-token
  minimum cacheable prefix — see above). Not worth padding the prompt
  artificially just to cross that threshold.

**Deferred: the Batch API** (50% discount on tokens only — doesn't apply to
Tavily's separate billing, and adds real complexity, submit-then-poll
instead of a single synchronous call). Worth revisiting only once real
volume at the ~100-unit scale justifies it.

### Real cost, measured (Event Discovery, current Tavily+Haiku design)

A full PoC run (3 test units + the bright-sources pass): **~$0.10-0.15** in
Anthropic spend per run, plus Tavily credits comfortably inside its free
1,000/month tier even projected out to ~100 units run once a month. See
"Real cost, measured" under Event Discovery above for the fuller breakdown,
including the image-token-cost tradeoff and why prompt caching doesn't
apply yet.

