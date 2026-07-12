# Caldearte — Region Discovery, Crawling & Cost Governance

Two distinct processes, run at different frequencies with different models,
plus the cost-governance system that keeps both bounded. This document is
required reading before touching either process — it supersedes the original
draft's pure population/distance ranking (which had a real bias problem, see
below) and is the only place the cost-governance system is documented outside
the code itself.

## Venue Discovery (research)

Uses Claude **Sonnet** (not Haiku — here judgment matters more than cost, to
avoid polluting the `venues` table with junk) with the **Anthropic API's
native web search tool** ($10 per 1,000 searches + tokens — no separate
search service like SerpAPI needed).

1. Search by region: "art galleries in [city]", "cultural centers [city]",
   "neighborhood associations with cultural activities [city]" — queries
   generated in the region's local language.
2. For each result, validate it's a legitimate art/community space (not a
   stale blog, not a news article, not a dead result) before accepting it.
3. Extract name, address, website or social account, and contact email if
   publicly visible.
4. Classify `venues.category` (`art_space` / `hard_excluded` / `needs_review`)
   at creation time — this resolves how the category gets decided the first
   time a new venue appears.
5. Insert into `venues`, deduplicating against existing entries (by name +
   address, or by domain).

**Geographic scope: global by design** (leveraging the `.com`), but expanding
into a new region is an **explicit editorial decision** by the curators, same
as content curation — not something the model decides on its own. The search
unit is **region** (city/state/metro), not country: a large country is
handled from the start as several regions (e.g. "Brazil / São Paulo",
"Brazil / Rio de Janeiro") with no separate rule needed for when to split it
up — the granularity is a curator decision made when each region is added.

## Ranking & expansion

**Bootstrap:** starts with all of Chile's named regions (Santiago,
Valparaíso, Concepción, Antofagasta, Arica) active simultaneously on a
**weekly** cadence from day one — not a single city.

Saturation (no longer finding new venues) is what triggers moving to the next
region, following a precalculated ranking:

- **Ranking by population + proximity ("gravitational model"):** a single
  global list of cities/metros is precalculated once (using public
  population data, e.g. GeoNames or the World Cities Database), ordered by a
  score that weighs population against distance from Santiago — so a bigger
  but farther city can rank ahead of a smaller, closer one.
- **Automatic expansion on saturation:** once **all** currently active
  regions are saturated (2 consecutive runs with no new venues — see cadence
  below), the system automatically activates the next region(s) from the
  ranking. The curators don't have to manually approve each activation step —
  the editorial control that's preserved is the **exclusion list** (below),
  not each individual activation.
- **Manual exclusion list**, separate from the automatic ranking: for cases
  that should never activate regardless of rank (see the North
  Korea/Russia/China note below).

### Fixing the big-city bias in the ranking formula

The original score formula (`population / distance^k`, raw population) has a
real problem: as the project expands globally, a big city somewhere far away
will always be able to "jump the queue" ahead of a small town, and because
it's a strict ordered queue consumed top-down, small towns can end up
**permanently stuck at the bottom of a list that keeps growing from above** —
never getting a turn. Left uncorrected, this produces exactly the outcome the
curation policy argues against elsewhere: the calendar would end up implying
"art only happens in big cities," when the project explicitly values street
murals and community-center shows as much as an established gallery opening
(see [curation-policy.md](curation-policy.md#venue-type-filter-independent-of-content)).

Two corrections, applied together:

1. **Log-compressed score:** `score = log(population) / distance^k` instead
   of raw population. This compresses the gap between a big city and a small
   one — Buenos Aires still outranks a small town, but doesn't crowd it out
   as aggressively.
2. **Diversity quota:** every Nth expansion is guaranteed to pull from a
   separate "low-population" queue, rather than strictly the highest global
   score. This guarantees small regions eventually get a turn no matter how
   many new, bigger cities get added elsewhere over time — it prevents the
   permanent starvation the pure-ranking model allowed, though it doesn't
   guarantee a *short* wait if the candidate pool keeps growing faster than
   it's consumed.

The ranking itself is still precalculated **once**, not recomputed on every
saturation event — the inputs (population, distance) don't change run to
run, so recalculating would be wasted work. The diversity quota and
log-compression are properties of how the *existing* precalculated list is
consumed, not a reason to regenerate it.

**Why region-level search, not country-level, matters for this same bias:**
a single broad query like "art in Chile" would surface mostly Santiago
results and likely miss Arica or Antofagasta entirely — not because there's
no art there, but because a generic country-wide query gets swamped by
whatever is biggest/best-indexed. Keeping the search unit at
city/metro-level (as already seeded for Chile) is what actually guarantees a
small city's visibility — that's a property of the *search granularity*, not
the *expansion ranking*. The right pattern per country: a small country
(e.g. Uruguay, with less population than metro Santiago alone) can be loaded
as a single region with one query; a large country (e.g. Brazil) should be
loaded as several metro-level regions, each roughly the scope already used
for Chile's cities — not one query for the whole country.

### Adaptive frequency within each active region

- A newly activated region starts on a **weekly** cadence for its first 4
  runs (bootstrap).
- After 2 consecutive runs with no new venues, it's marked `saturated` and
  drops to a **monthly** cadence (it stops counting as "active" for the
  expansion trigger, though it still gets a monthly maintenance pass).
- If it starts yielding results again, it can return to `active`/weekly.

This means a region is never permanently dropped — discovery just slows down
to monthly maintenance indefinitely, and speeds back up if it starts
producing results again.

### North Korea, Russia, and China — not the same case

- Not having user accounts doesn't exempt anything — the ToS that matters
  here is the *scraped site's*, not Caldearte's. That risk is already
  general (see [risks.md](risks.md)) and applies to any country, not
  specific to these three.
- **North Korea is a genuinely different case and is excluded outright:**
  it's under comprehensive US economic sanctions (OFAC), and all of the
  project's infrastructure is US-based (GitHub, Vercel, Supabase, Anthropic).
  Running automation specifically targeted at that country would put those
  providers in a sanctions-compliance gray zone that isn't worth it for a
  free project — and the practical coverage value there is close to zero
  anyway. Added directly to the exclusion list, no need to wait its turn in
  the ranking. (Not legal advice — a reasonable operational precaution, not
  a formal compliance analysis.)
- **Russia and China don't have that same sanctions problem**, but a more
  practical limitation: the Anthropic web search tool likely has weak
  coverage of Russian/Chinese-language sources, and various sites there may
  not be normally reachable due to national firewalls — so even without
  upfront exclusion, they're expected to perform poorly whenever their turn
  comes. Since the population/distance-from-Santiago ranking places them
  fairly far down the activation order, this isn't a decision that needs
  making now — revisit when they actually come up, with more context than
  exists today.

### Multi-language

Not a separate technical component — Claude already operates natively across
languages, no "support" needs to be added. What does need generating per
region is the search query in that region's local language. Pending for
when non-Spanish-speaking regions activate: the Flujo 1/2 emails (Phase 1b)
are currently designed in Spanish and will need localizing to each venue's
language.

### Capturing events with no recurring venue

A real case the "recurring venue" model doesn't cover well: one-off
interventions in the street or non-institutional spaces, with no venue that
will show up again — not worth creating a persistent `venues` row for, but
worth capturing the event anyway.

When Venue Discovery finds one of these during research (not a venue), it creates
a row directly in `events` with `venue_id` null and a freeform location
(`freeform_location`), instead of forcing it through the venues table. It
still goes through the same curation pipeline — the five axes plus the
venue filter, the latter applied to the location description instead of a
formal venue.

**Honest limitation worth assuming upfront:** neither the weekly/monthly
regional research nor the daily known-venue crawl are reliable mechanisms
for this kind of event — by definition they're short-notice, with no fixed
distribution channel. What actually works for this is the public mailbox
(Flujo 2, Phase 1b) and, later, some monitoring of local social media
sources (already flagged as a risk — see [risks.md](risks.md)). Don't expect
Venue Discovery to catch these interventions consistently — it'll catch some by
having run at the right moment, not by reliable design.

## Event Crawler (daily, already designed in Phase 1a)

Walks the already-known list of `venues` with Claude **Haiku** (cheap, high
volume, no need for the web search tool since the exact URL to visit is
already known), looking for new opening announcements at each one.

### Handling `needs_review` venues

**Decided:** the Event Crawler skips any venue with `category =
'needs_review'` by default — it only crawls `art_space`. There's no
confirmation flow built for venues yet (unlike events, which already have
the email-with-two-buttons design) — today the only way a `needs_review`
venue gets resolved is manually, either updating `venues.category` directly
in Supabase, or in an ad-hoc review session with Claude going case by case.
Worth revisiting once the `needs_review` backlog grows enough that manual
resolution stops being cheap — not before.

### Sequencing: Venue Discovery doesn't block the Event Crawler

Not sequential in the sense that the Event Crawler *waits* for Venue
Discovery on every run — but to get started, running Venue Discovery first
(instead of hand-seeding venues) is preferred, since it'll be more thorough.
Agreed in general, with one adjustment: scope Venue Discovery to a single
region first (the curators' own) before activating it across multiple
countries/languages at once. This validates detection quality — false
positives ("this isn't really an art space"), deduplication, category
classification — against a case that can be checked by hand, before scaling
to regions with no easy way to notice if the model got something wrong.
Phase 1a ends up depending on Venue Discovery's first run in that region
instead of a hand-seeded list — same practical result, less manual work,
with a quality checkpoint before expanding further.

---

## Cost governance

Confirmed with the user after modeling real dollar costs: the **daily venue
crawl (the Event Crawler)** drives spend over the long run, because it runs
indefinitely regardless of a region's status — but the first real production
run also showed **Venue Discovery's own weekly searches are a major
near-term cost driver**, not a rounding error, during the bootstrap phase
when several regions are still on a weekly cadence (see "Venue Discovery
search cost" below). The project now has a self-enforced, self-tracked
**$10/month ceiling**, plus the specific cost-reduction techniques below, all
shipped in `supabase/migrations/` + `apps/curator/src/lib/` (PR #12).

### The self-tracked ledger

Rather than depend on Anthropic's billing API, every paid call records its
own estimated cost:

- **`system_config`** table — a plain key/value config table, editable
  directly (no redeploy needed): `monthly_budget_usd = 10`,
  `max_total_regions = 200`.
- **`api_usage_log`** table — one row per paid call: model, purpose
  (`venue_discovery` | `event_crawl`), token counts (including cache
  read/write), and an estimated cost computed from a hardcoded per-model
  $/Mtok table (`apps/curator/src/lib/pricing.ts` — needs manual updates if
  Anthropic pricing changes; there's no API to fetch it live).
- `apps/curator/src/lib/usage-tracking.ts` exposes `recordUsage()`,
  `getCurrentMonthSpend()`, `getConfigNumber()`, `isOverBudget()`, and
  `isOverRegionCap()` — any future Venue Discovery/Event Crawler code must
  route spend through these, not add a call path that bypasses the ledger.

### What happens when the ceiling is hit

**Confirmed behavior:** hitting `monthly_budget_usd` blocks **new region
activation only** (Venue Discovery). The Event Crawler's daily crawl of
already-known venues keeps running — the calendar doesn't go stale just
because expansion paused. `max_total_regions` is a secondary sanity check
(catches runaway growth, e.g. a bug), not the primary control.

Raising the ceiling is a one-line SQL update
(`update system_config set value = '25' where key = 'monthly_budget_usd';`)
— no code change or redeploy required. Visibility: `apps/curator/src/lib/notify.ts`
opens a GitHub issue (labeled `budget-alert`, deduplicated so it doesn't spam)
the moment the ceiling is hit, using the Action's own `GITHUB_TOKEN` — no new
secret needed.

### Cost-reduction techniques (why $10/month is realistic)

- **Change-detection before spending on an LLM call.** `content-hash.ts`
  hashes a venue's fetched page content (after whitespace normalization);
  `venues.content_hash` + `last_checked_at` let the Event Crawler skip the
  Haiku call entirely when nothing changed since the last check — fetching a page to
  hash it costs nothing, only evaluating a real change costs tokens.
- **Adaptive per-venue check cadence.** `venues.check_frequency_days`
  defaults to **3, not daily** — openings are normally announced with more
  than a day or two's notice, so this trades a little freshness for
  materially less operational overhead. `consecutive_zero_yield_checks`
  is the foundation for eventually slowing down (or speeding back up) a
  specific venue's cadence, mirroring the region-level saturation logic
  above but one level down — the actual adaptive algorithm is still to be
  implemented in the Event Crawler's code.
- **Prompt caching** on the shared curation-policy instructions, since
  that text is identical across every daily call.
- **Batching multiple venues per call**, amortizing the fixed
  "explain the task" overhead across more venues per request.

**Deferred to later: the Batch API** (50% discount, **tokens only — it does
not discount web search's $10/1,000-searches charge**, per Anthropic's
pricing docs). Also adds real complexity — a batch job can take up to ~1
hour to complete, which means splitting a cron into a submit step and a
separate poll-for-results step. Given change-detection alone already
projects comfortably under $10/month at the current region count, this is
worth revisiting only once actual volume justifies the added complexity —
and worth remembering that it wouldn't touch Venue Discovery's search cost
at all even if adopted.

### Venue Discovery search cost (found on the first real run, fixed in PR #14's follow-up)

The first production run (Santiago + Valparaíso) cost **$1.36** in real
Anthropic billing — `api_usage_log` only recorded **$0.62**. The gap: **web
search is billed separately from tokens** ($10 per 1,000 searches, reported
in `response.usage.server_tool_use.web_search_requests`), and
`pricing.ts` never accounted for it. That's not just an estimation gap —
`isOverBudget()` was blind to roughly half of real spend, which defeats the
point of having a self-tracked ceiling at all. Fixed by adding
`web_search_requests` to `api_usage_log` and to `pricing.ts`'s cost
calculation.

Inferring from that gap, the model made roughly ~37 searches per region —
far more than the 3 template queries suggested, because it defaulted to one
follow-up validation search per candidate venue, and (since nothing told it
otherwise) would repeat that validation work on every subsequent weekly run
of the same region. Modeled out, unoptimized weekly Venue Discovery across 5
regions could cost **~$27/month** on its own — comfortably over the
ceiling. Three fixes, in `apps/curator/src/venue-discovery/discover.ts`:

- **Search-economy instruction:** the system prompt now tells the model to
  rely on its initial broad-query results first, and only search again for a
  specific candidate when those results didn't already confirm it's real/
  active or give its address/contact — not as a default per-candidate step.
- **Pass already-known venues, skip them:** `discoverVenues` takes the
  region's existing venue names and instructs the model not to re-search or
  re-validate them — only report genuinely new candidates. This is what
  should make a region's second and later weekly runs much cheaper than its
  first (the first run has nothing to skip, since nothing is known yet).
- **`max_uses: 12` on the web_search tool** as a backstop, not the primary
  lever — caps worst-case cost on a pathological run without being the thing
  actually doing the cost reduction. (Lowered from 20 after the first
  optimized run measured 5-16 real searches/region.)

Every search query the model issues is also logged (region name + query
text) specifically so future runs give an *observed* search count instead of
one inferred from a cost gap, the way the ~37/region figure above was.

**Measured result (Concepción, Antofagasta, Arica — first optimized run):**
27 searches total for 3 regions (avg ~9/region, vs. the ~37/region inferred
before), real cost **$0.81** for the 3 regions combined (`api_usage_log`'s
own tracked total for these 3: $0.88 — the two now agree closely, confirming
the tracking fix works). That's from the search-economy instruction alone —
none of these 3 regions had existing venues to skip yet, since it was each
region's first run; the "skip already-known venues" saving is still
unmeasured and should show up starting each region's second weekly run.

One anomaly this run's logging caught: Arica issued the same 4 queries
twice (8 of its 16 searches were exact repeats). Nothing in the prompt told
the model not to re-run a query it had already made — fixed by adding that
instruction directly to `SEARCH_ECONOMY_POLICY`.

**Prompt caching, considered and skipped for now:** the stable parts of the
system prompt (`VENUE_FILTER_POLICY` + `SEARCH_ECONOMY_POLICY` + the generic
instructions) come to roughly 400-500 tokens — under Sonnet's ~1024-token
minimum cacheable prefix. Marking that block with `cache_control` today
would be a no-op (Anthropic silently skips caching below the minimum, no
error, no savings either). Worth revisiting once the system prompt grows
past that threshold (e.g. if event-capture support, below, gets built into
the same prompt), not before.

Two ideas considered and set aside, for the record:

- **Searching at region/state level instead of city/metro level** — would
  only save on the 3 broad initial queries (~8% of the total), not the
  per-candidate validation searches that actually dominate cost, and risks
  reintroducing the big-city bias the log-ranking fix above exists to
  prevent (a broad regional query surfaces the biggest city's results, not
  small towns within it).
- **Doing our own web search/fetching instead of Anthropic's tool** — would
  eliminate the $10/1,000 charge, but reopens a vendor decision the project
  deliberately avoided (see "Stack" in architecture.md — no separate search
  service like SerpAPI), adds real ongoing maintenance (HTML parsing,
  fetch resilience, rate limiting), and Google's own search results page
  cannot be scraped directly (against their ToS, actively detected/blocked).
  Worth revisiting only if the prompt-level fixes above turn out not to be
  enough once measured for real.

### Rough cost model (for context, not a live estimate)

At 5–10 active regions (roughly today's scale), modeled cost — Venue
Discovery (Sonnet + web search) plus the Event Crawler (Haiku daily crawl,
pre-optimization) — lands in the **$10–25/month** range under pessimistic
assumptions (5–20 venues discovered per region, no change-detection or
search-economy optimizations). With change-detection, adaptive cadence,
prompt caching, and the Venue Discovery search-cost fixes above all in
place, the realistic figure drops to roughly **$9–10/month** at this scale —
still worth watching closely, since it's close to the ceiling rather than
comfortably under it. This was modeled, not measured — validate against
`api_usage_log` once a few more real runs have happened, and don't treat
this paragraph as a live number.
