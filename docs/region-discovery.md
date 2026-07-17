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
with zero new information), and by normalized title (accents/quotes
stripped) across *all* of a run's curate() calls combined (every unit plus
the separate bright-sources pass) — real duplicate found and fixed this
way: "Poética de las aguas" reported once via a unit's own search and once
via a bright source, same event.

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

### Cadence — simplified, not yet implemented in production code

**Decided:** a fixed monthly search per unit, no adaptive weekly cadence,
no saturation state machine, no automatic region expansion. The existing
production `run.ts` still has all of that machinery (`status`:
`active`/`saturated`/`excluded`, `search_frequency`, `consecutive_zero_yield_runs`,
and a real, still-unfixed bug where `maybeExpandToNextRegion` only ever
triggers when zero regions are active) — none of it has been removed yet,
since this whole design hasn't been wired into production. No migration
is needed to simplify this later — the columns just go unread once the
application code stops using them.

### The ~100-unit list — designed, deferred

**Decided scope, not yet built:** ~50 Chilean cities treated as single
units, plus Gran Santiago/Valparaíso/Concepción split by comuna (~34+6+11)
where a single city-level query would blur together genuinely distinct
neighborhood art scenes — roughly 100 units total, covering all 16
administrative regions so none is excluded. Never verified against INE
data. **Deliberately deferred** until the mechanisms above are fully
implemented and validated in production — building the list is the last
step before actually spending real, ongoing money at scale, not a
prerequisite for finishing everything else first.

### All 346 comuna names seeded as `status='excluded'` — tagging only, not search coverage

**Not to be confused with the ~100-unit *active-search* list above.**
2026-07-17: every official Chilean comuna (346 total, cross-checked
against a structured dataset rather than typed from memory — see the
`20260717000000_seed_remaining_chile_comunas_excluded` migration) got
seeded as a `regions` row with `status='excluded'`. This does **not**
expand active search coverage or spend any Tavily/Anthropic budget:
`getUnitsDueForRun` filters `.neq('status', 'excluded')`, so none of
these enter the per-unit search loop. What it *does* fix: `matchRegionId`
(`apps/curator/src/lib/locations.ts`) only tags an event's `region_id`
when its `freeform_location` text matches a NAME already present in this
table, regardless of that region's status (`loadAllRegions` in `run.ts`
loads every region for this purpose, not just active ones). Bright
sources like arteinformado.com already return real events from comunas
that weren't seeded yet (Las Condes, Vitacura, El Bosque — found
2026-07-17) — those events were landing with `region_id=null` (the
"otro" bucket) purely because the comuna's name didn't exist as a row,
not because there wasn't real data for it. Turning any of these 331 into
a genuinely *active* search unit is still the separate, deliberate
~100-unit rollout decision above — this migration only fixes tagging for
whatever a comuna already organically surfaces.

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

## Ranking & expansion (superseded, kept for historical reference)

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

### No email approval flow yet (cost-driven, not a design gap)

**Decided:** ambiguous events would land with `events.curation_status =
'pending_review'` and no email — resolved manually in Supabase. The original
design called for an email with two approve/reject buttons (Supabase Edge
Function + one-time token), but adding `caldearte.com` to Resend requires
their paid plan (~$20/month) since the free-tier domain slot is already used
by another of the user's projects — not justified yet. Revisit once this
becomes genuinely mandatory (real volume, or the cost becomes worth it some
other way), not before. **Currently moot in practice:** Event Discovery's
curation call is binary (`approved`/`rejected` only, see
curation-policy.md#human-escalation-not-currently-implemented) — nothing in
production sets `pending_review` today, so this flow has nothing to trigger
it yet either.

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

