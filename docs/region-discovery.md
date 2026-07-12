# Caldearte — Region Discovery, Crawling & Cost Governance

Two distinct processes, run at different frequencies with different models,
plus the cost-governance system that keeps both bounded. This document is
required reading before touching either process.

**Status note (this revision):** Event Discovery's search/curation design
below reflects a real, validated proof-of-concept
(`apps/curator/scripts/poc-tavily-discover.ts`) — extensively tested with
real Tavily + Anthropic calls, but **not yet wired into the real production
code** (`apps/curator/src/venue-discovery/discover.ts` and `run.ts` still
run the older Anthropic-`web_search` + venue-first design described lower in
this doc's history). Read this document for the *intended* design; check
the actual source files for what's deployed today.

## Event Discovery (research) — Tavily + Haiku, events only, no venues

**Superseded design decision:** Event Discovery no longer produces or
touches venues at all. Events have a `location` (always freeform text) —
there is no venue-matching, no venue category gating, nothing. This is a
further step past the earlier "venues are a byproduct" pivot: venues turned
out to be pure overhead once the goal is capturing *events*, not building a
venue directory. (The Event Crawler, described lower down, is unaffected —
it still walks a `venues` table populated separately, unrelated to this.)

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

**Output shape** (validated in the PoC, not yet migrated — see
[data-model.md](data-model.md)): `title`, `description`, `artist`,
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

**Vision check (Axis 5)** reuses `lib/vision-check.ts` unchanged. Measured
real cost: ~$0.0003-0.0011 per image — negligible, applying it to every
event with an image would barely move the budget. Two real bugs found and
fixed in `defaultImageFetcher` (shared code, not just this flow):
(1) some servers append parameters to `Content-Type`
(`image/jpeg;charset=UTF-8`), which Anthropic's API rejects outright —
fixed by stripping everything after the first `;`; (2) Instagram's CDN
sometimes returns 403 on a direct server-side fetch (hotlink protection) —
not fixed (would need a different fetch strategy/headers), but the vision
step now falls back to the next available candidate image instead of
failing the whole run.

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

## Fuentes brillantes (bright sources)

A "fuente brillante" is a URL that reliably lists several real events in
one place — fetched **directly** (plain `fetch`, not via Tavily search)
every run, and excluded from regular Tavily searches for that domain (via
`exclude_domains`) so the search budget isn't spent re-discovering what's
already covered directly.

**Two source types**, `apps/curator/src/lib/known-sources.ts`:
- `"html"` — scrape the page: extract `<img src/alt>` pairs *before*
  stripping tags (a real bug — the original crude tag-strip threw away
  real per-exhibition thumbnails that were sitting right in the HTML,
  fixed by pulling images out first), resolve relative image URLs against
  the page's own origin.
- `"json-api"` — structured data already, no HTML parsing or image-to-
  event matching needed. Example: Parque Cultural Valparaíso's events
  widget is JS-rendered (invisible to a plain `fetch` — confirmed the raw
  HTML response never contains the widget's real content anywhere, even
  though the browser's DevTools shows it after JavaScript runs), but the
  widget itself calls a clean WordPress REST endpoint
  (`/wp-json/wp/v2/events_list`) found via the browser's Network tab —
  hitting that directly gives real, structured title/image/description/
  date fields per event, no guessing required. One real find worth noting:
  its `hora_de_inicio`/`hora_de_termino` fields are the *venue's* daily
  opening hours, not the actual inauguración time — the real opening time,
  when there is one, is only in the free-text description field, so Haiku
  still needs to read that rather than trust the structured hour fields
  blindly.

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
date within the current month — gets auto-added to a persisted
`detected-sources.json`, merged with the hand-curated `KNOWN_SOURCES` list
at the start of every run. No source file gets rewritten by the script;
`known-sources.ts` stays the manually-reviewed list, detection just grows
a separate file alongside it. **`description` is deliberately not
required** for "complete" — a real test against arteinformado.com (a
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

## Event Crawler (implemented, manual-trigger only for now, unchanged this session)

Walks the already-known list of `venues` with Claude **Haiku** (cheap, high
volume, no need for a search tool since the exact URL to visit is already
known), looking for new opening announcements at each one. This is
completely separate from Event Discovery above — it still uses the
`venues` table and venue-matching logic that Event Discovery no longer
touches.

### v1 implementation (`apps/curator/src/event-crawler/`)

**Found by a real local pilot run (GAM + Matucana 100), fixed before the
GitHub Action shipped:** the first version only ported
`curation-policy.md`'s four exclusion axes into the prompt — it never
checked `overview.md`'s "what counts as art" scope at all, so conventional
concerts, album launches, and a clown-school show at Matucana 100 got
captured as if they were art openings. Also missing: a deterministic filter
for events whose opening date has already passed by scrape time
(`overview.md` is explicit these should never be added), and the
event-dedup key compared raw ISO date strings instead of parsed instants —
harmless until a venue's page is re-crawled and the model expresses the
same timestamp with a different UTC offset, which silently re-inserted a
duplicate under a different `curation_status`. All three are fixed in code
(`curate.ts`'s `ART_SCOPE_POLICY`, `run.ts`'s date filter and `eventKey`
helper) — kept here as a reminder that a docs-only design review doesn't
catch this kind of gap; running it against real data does.

- **Eligible venues**: `category = 'art_space'` AND `source_domain` set AND
  not a social platform (`facebook.com`/`instagram.com` denylist in code,
  not a schema column) — see "Venues without a crawlable site" below.
- **Change-detection first**: fetches the venue's root domain with plain
  `fetch` (no Playwright yet — added only if a real venue's page turns out
  to need JS rendering), hashes it (`lib/content-hash.ts`, reused as-is).
  Unchanged since the last check → zero LLM cost, just bumps
  `last_checked_at`. This is the actual cost lever, not a nice-to-have.
- **Two Haiku calls, not one, when content changed**: a text-only call
  applies the four text-based curation axes (religion / war / far-right /
  pseudoscience) plus escalation signals from `docs/curation-policy.md`,
  tags `sensitivity_tags`/`medium_type`/`opening_date_confidence`, and picks
  a candidate image from the page's `<img>` tags (regex-extracted, scored by
  alt text + dimensions — `event-crawler/extract-images.ts`). A second,
  vision-only call applies Axis 5 (explicit aggression) — but **only** for
  candidates that passed axis 1-4 and have a chosen image, so vision cost is
  paid only when it matters. No image → treated as approved directly
  (nothing to falsely show, matching curation-policy.md's framing of axis
  5's actual risk).
- **Adaptive per-venue cadence**: mirrors the region-level saturation logic
  above — no new events on a check → `consecutive_zero_yield_checks`
  increments; after 3 consecutive, `check_frequency_days` extends from 3 to
  7; a yield resets both.
- **`events.opening_datetime` is `NOT NULL`**: a candidate the model can't
  pin to any date isn't stored — there's no Flow 1 (automatic date inquiry)
  built yet to resolve it. Dropped, not half-persisted.
- **No image persistence yet**: the chosen image URL is used internally for
  the Axis 5 vision check but isn't written anywhere on the `events` row —
  `events` only has `image_storage_path` (meant for a re-hosted copy, Phase
  3), not a raw external URL field. Revisit once Phase 3's image pipeline
  exists; not worth a migration just to hold a URL that will be replaced
  anyway.

### No email approval flow yet (cost-driven, not a design gap)

**Decided:** ambiguous events land with `events.curation_status =
'pending_review'` and no email — resolved manually in Supabase, the same
posture as `needs_review` venues below. The original design called for an
email with two approve/reject buttons (Supabase Edge Function + one-time
token), but adding `caldearte.com` to Resend requires their paid plan
(~$20/month) since the free-tier domain slot is already used by another of
the user's projects — not justified yet. Revisit once this becomes
genuinely mandatory (real volume, or the cost becomes worth it some other
way), not before.

### Venues without a crawlable site

Some venues Event Discovery has found have no real website —
`source_domain` is `facebook.com`/`instagram.com`, or null (mostly small
community spaces and neighborhood associations whose only channel is a
social account). Scraping social platforms directly carries ToS risk
(`docs/risks.md`) and isn't reliable via a plain `fetch` (JS-rendered,
frequently blocked). **Decided:** excluded from Event Crawler v1 via a
denylist in code, not deleted from `venues` — revisit once there's a real
path for them (e.g. Phase 1b's public mailbox, or a manually-confirmed
alternate URL per venue).

### Handling `needs_review` venues

**Decided:** the Event Crawler skips any venue with `category =
'needs_review'` by default — it only crawls `art_space`. There's no
confirmation flow built for venues yet (unlike events, which already have
the email-with-two-buttons design) — today the only way a `needs_review`
venue gets resolved is manually, either updating `venues.category` directly
in Supabase, or in an ad-hoc review session with Claude going case by case.
Worth revisiting once the `needs_review` backlog grows enough that manual
resolution stops being cheap — not before.

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
ceiling still apply generally as a spend guardrail. The Event Crawler's
daily crawl of already-known venues is unaffected either way. Raising the
ceiling is a one-line SQL update, no redeploy required.
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
- **Change-detection before spending on an LLM call** (Event Crawler).
  `content-hash.ts` hashes a venue's fetched page content;
  `venues.content_hash` + `last_checked_at` skip the Haiku call entirely
  when nothing changed.
- **Adaptive per-venue check cadence** (Event Crawler): `check_frequency_days`
  defaults to 3, extends to 7 after 3 zero-yield checks.
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

### Rough cost model (for context, not a live estimate)

The Event Crawler's own cost model (change-detection + adaptive cadence,
Haiku) was estimated pre-optimization at $9-25/month depending on venue
volume, and hasn't been re-measured against real production data recently.
Combined with Event Discovery's real measured cost above, total spend
across both processes is expected to land well under the relaxed
$50/month ceiling even once the ~100-unit list is live — but this
combination hasn't been measured together in production yet, only
projected from each process's own real data separately.
