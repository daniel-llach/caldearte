// Event Discovery orchestrator — deliberately simple (docs/region-discovery.md):
// every unit in `regions` gets a fixed cadence pass, no saturation state
// machine, no adaptive cadence. The old search_frequency/
// consecutive_zero_yield_runs columns are ignored entirely (they stay in
// the schema unread — no migration needed to stop using them);
// status='excluded' is still honored as a hard, editorial opt-out (e.g.
// OFAC), distinct from status='not_started' (a comuna simply not yet in
// the weekly batch rotation — see the 346-comuna rollout, below).
//
// Weekly batch rotation (2026-07-17): with all 346 official comunas
// seeded, running every due one every time would exceed GitHub Actions'
// 6-hour job timeout (346 sequential units ≈ 7.9h at ~82s/unit measured).
// getUnitsDueForRun caps each run to `weekly_batch_size` (system_config,
// no redeploy to change), oldest-last_run_at-first — a comuna that's
// never run (last_run_at null) sorts first, so the rotation naturally
// works through every comuna once before any repeats, then cycles
// forever with no special "reset" needed: a comuna that just ran becomes
// the newest, falls out of the "due" pool for RUN_INTERVAL_MS, and
// re-enters it once that elapses, same as always.
import Anthropic from "@anthropic-ai/sdk";
import type { Tables } from "@caldearte/shared-types";
import { getSupabaseClient } from "../lib/supabase-client.js";
import { recordUsage, getConfigNumber, getCurrentMonthSpend } from "../lib/usage-tracking.js";
import { estimateCostUsd } from "../lib/pricing.js";
import { knownSourceDomain } from "../lib/known-sources.js";
import { KNOWN_LOW_QUALITY_SOURCE_DOMAINS } from "../lib/known-exclusions.js";
import { matchRegionId, type RegionLike } from "../lib/locations.js";
import { normalizeLocation, isLikelySameTitle } from "../lib/event-filters.js";
import { enrichCandidates, isSocialMediaUrl, type FetchLike as PageFetchLike } from "../lib/page-fetch.js";
import { rehostImage, type RehostImageFn } from "../lib/image-rehost.js";
import { sendRunSummaryEmail, type RunSummary } from "../lib/notify.js";
import {
  buildBlock,
  buildSystemPrompt,
  curate,
  curateBrightSourceItems,
  currentMonthLabel,
  EVENT_DISCOVERY_MODEL,
  filterKnownExclusions,
  isCurrentOrUpcoming,
  normalizeTitle,
  searchUnit,
  type DiscoverUsage,
  type EventCandidate,
  type MessagesClient,
  type RawResult,
} from "./discover.js";
import {
  detectNewBrightSources,
  fetchBrightSources,
  mergeBrightSources,
  type BrightSource,
} from "./sources.js";

type Region = Tables<"regions">;

// ~monthly with tolerance for scheduling jitter (a cron that fires a day
// early shouldn't silently skip the whole month).
const RUN_INTERVAL_MS = 28 * 24 * 60 * 60 * 1000;

// Tavily's pay-as-you-go overage rate, confirmed against tavily.com/pricing
// (see docs/region-discovery.md's cost-governance section) — used only for
// the run-summary email's cost estimate, not for any real billing decision.
const TAVILY_COST_PER_CREDIT = 0.008;

function isDueForRun(region: Region, now: Date): boolean {
  if (!region.last_run_at) return true;
  return now.getTime() - new Date(region.last_run_at).getTime() >= RUN_INTERVAL_MS;
}

// Oldest last_run_at first; never-run (null) sorts before every real
// timestamp, so brand-new comunas get priority into the batch over ones
// merely due for a refresh.
function byOldestLastRunFirst(a: Region, b: Region): number {
  if (!a.last_run_at && !b.last_run_at) return 0;
  if (!a.last_run_at) return -1;
  if (!b.last_run_at) return 1;
  return a.last_run_at.localeCompare(b.last_run_at);
}

export async function getUnitsDueForRun(now: Date = new Date()): Promise<Region[]> {
  const { data, error } = await getSupabaseClient()
    .from("regions")
    .select("*")
    .neq("status", "excluded");

  if (error) {
    throw new Error(`Failed to load units: ${error.message}`);
  }

  const due = (data ?? []).filter((r) => isDueForRun(r, now)).sort(byOldestLastRunFirst);
  const batchSize = await getConfigNumber("weekly_batch_size");
  return due.slice(0, batchSize);
}

// All regions, regardless of status — region_id is a location tag, not a
// "should we search here" flag, so an event can still match an excluded
// or not-yet-due region by name.
export async function loadAllRegions(): Promise<RegionLike[]> {
  const { data, error } = await getSupabaseClient().from("regions").select("id, name");

  if (error) {
    throw new Error(`Failed to load regions: ${error.message}`);
  }

  return data ?? [];
}

async function loadDetectedSources(): Promise<BrightSource[]> {
  const { data, error } = await getSupabaseClient()
    .from("detected_sources")
    .select("url, note, source_type");

  if (error) {
    throw new Error(`Failed to load detected sources: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    url: row.url,
    note: row.note,
    type: row.source_type as BrightSource["type"],
  }));
}

// Per-source independent fetch cadence — until now, EVERY bright source got
// fetched on EVERY run with no gating at all. Same "due" shape as regions'
// isDueForRun/RUN_INTERVAL_MS, but keyed by the source's own url (see the
// bright_source_fetch_state migration for why: KNOWN_SOURCES is
// hand-curated in code, not a DB row, so url is the only identity both
// hand-curated and auto-detected sources share).
//
// 14 days -> 7 (2026-07-23, dual-cadence strategy — see
// event-discovery.yml's own doc comment): bright sources moved to their
// own weekly cron, separate from the comuna batch's monthly one. A 14-day
// per-source cadence against a 7-day cron would only find something new
// every OTHER run — halved to match.
const BRIGHT_SOURCE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export function isSourceDue(lastFetchedAt: string | undefined, now: Date): boolean {
  if (!lastFetchedAt) return true;
  return now.getTime() - new Date(lastFetchedAt).getTime() >= BRIGHT_SOURCE_INTERVAL_MS;
}

// Exported for headless-discovery/run.ts, which shares the exact same
// bright_source_fetch_state table/cadence — MAVI is just another bright
// source whose fetch mechanism happens to need a real browser instead of a
// plain fetch(), not a fundamentally different concept.
export async function loadBrightSourceFetchState(): Promise<Map<string, string>> {
  const { data, error } = await getSupabaseClient().from("bright_source_fetch_state").select("url, last_fetched_at");

  if (error) {
    throw new Error(`Failed to load bright source fetch state: ${error.message}`);
  }

  return new Map((data ?? []).map((row) => [row.url, row.last_fetched_at]));
}

// Records an attempt, not just a success — fetchBrightSources already
// swallows a single source's failure (network error, 404, etc.) and logs
// it rather than throwing, so by the time this runs there's no per-source
// success/failure signal left to key off. Retrying a broken source every
// single run wastes just as much time as retrying a working one; the
// 7-day backoff applies equally, same posture as regions' own due-check
// (which doesn't distinguish a zero-yield run from a failed one either).
export async function recordBrightSourcesFetched(urls: string[], now: Date): Promise<void> {
  const client = getSupabaseClient();
  for (const url of urls) {
    const { error } = await client.from("bright_source_fetch_state").upsert({ url, last_fetched_at: now.toISOString() });
    if (error) {
      console.error(`[event-discovery] failed to record fetch state for ${url}: ${error.message}`);
    }
  }
}

// Cross-run dedup: don't re-insert an event already in the calendar (e.g.
// a mid-July re-run must not duplicate everything found on July 1st).
// Three keys, any one is enough to count as a duplicate:
// - Normalized title — the same event routinely surfaces with slightly
//   different punctuation/quoting across sources and runs, which
//   exact-match comparison misses (a real observed failure).
// - sourceUrl — a real production bug (found 2026-07-16): the SAME bright
//   source content, re-curated in a later run, got a DIFFERENT title from
//   Haiku each time ("Rama torcida" vs "Muestra "Rama torcida" en el
//   Museo de Arte Contemporáneo" — same source_url, same image, same
//   event) — title extraction isn't stable across separate Haiku calls
//   even on identical input, so title-only dedup missed it entirely.
//   sourceUrl doesn't have that instability, so it catches what title
//   dedup can't. Only applied when sourceUrl is non-null — never used to
//   dedup two different candidates that both happen to lack one.
// - location + date fingerprint — a real production bug (found
//   2026-07-18): the same San Felipe exhibition, posted by 3 DIFFERENT
//   accounts (2 Instagram, 1 Facebook), got 3 differently-punctuated
//   titles ("SALa FEM 2026" / "SAlaFEM2026" / "SalaFEM 2026") AND 3
//   different sourceUrls — evading both keys above — while sharing the
//   exact same location, run dates, and opening time. That combination is
//   an extremely unlikely coincidence for genuinely different events, so
//   it's treated as a third dedup signal.
//
//   ONLY checked against events already in the DB from a PAST run
//   (`seen.locationDates`, loaded once via loadExistingKeys and never
//   mutated below) — deliberately NOT re-applied blindly between sibling
//   candidates within the SAME run's own batch. Real production bug
//   (found 2026-07-23): a single arteinformado.com pass had 9 genuinely
//   DIFFERENT concurrent exhibitions ("Ejercicios de enlaces", "Vestiario",
//   "Materia sensible", ...) all opening the same day in the same MAC wing
//   — same location, same exact run dates, completely unrelated titles.
//   Blind same-batch matching kept only the first and silently dropped
//   the other 8 as "duplicates". Within a single batch, only the
//   title-similarity-aware fuzzy check below (isFuzzyDuplicateTitle)
//   applies — safe for both real shapes: a repost with a garbled title
//   still needs the title to be at least somewhat similar to get merged
//   (true for real reposts, false for e.g. "Vestiario" vs "Materia
//   sensible"), while a PAST run's already-stored event is still caught
//   unconditionally on the exact fingerprint alone, no title check
//   needed — that's what the San Felipe case itself actually was: a
//   re-run finding an event already in the calendar from days earlier.
function locationDateKey(location: string, c: Pick<EventCandidate, "openingDatetime" | "runStartDate" | "runEndDate">): string {
  const dateFingerprint = c.openingDatetime ?? `${c.runStartDate ?? ""}|${c.runEndDate ?? ""}`;
  return `${normalizeLocation(location)}|${dateFingerprint}`;
}

// Date-only (no time-of-day) companion to locationDateKey, for the fuzzy
// title-similarity fallback below — deliberately coarser than
// locationDateKey's exact-datetime fingerprint, since the whole point is to
// catch cases where two sources report slightly different exact hours for
// what's otherwise the same real opening.
function locationDateOnlyKey(location: string, c: Pick<EventCandidate, "openingDatetime" | "runStartDate" | "runEndDate">): string {
  const dateOnly = (c.openingDatetime ?? c.runStartDate ?? c.runEndDate ?? "").slice(0, 10);
  return `${normalizeLocation(location)}|${dateOnly}`;
}

export interface SeenKeys {
  titles: Set<string>;
  sourceUrls: Set<string>;
  locationDates: Set<string>;
  // Real bug (found 2026-07-20, via a user-requested audit): none of the
  // three exact-match signals above catch two DIFFERENT sources reporting
  // the SAME real event with different exact hours ("19:00" vs "19:30")
  // and different exact title wording — the location+datetime fingerprint
  // misses on the time difference, and title/sourceUrl obviously differ
  // too. Bucketed by the coarser date-only key; within a bucket, a new
  // candidate is a duplicate if its title is a close match (see
  // isLikelySameTitle) to ANY existing title already in that bucket —
  // deliberately conservative (both a Jaccard threshold AND a minimum
  // shared-word count) since a false merge here silently drops a real,
  // distinct event, which is worse than an occasional missed duplicate.
  titlesByLocationDateOnly: Map<string, string[]>;
}

export async function loadExistingKeys(): Promise<SeenKeys> {
  const { data, error } = await getSupabaseClient()
    .from("events")
    .select("title, source_url, freeform_location, opening_datetime, run_start_date, run_end_date")
    .eq("source", "discovered");

  if (error) {
    throw new Error(`Failed to load existing discovered events: ${error.message}`);
  }

  const titlesByLocationDateOnly = new Map<string, string[]>();
  for (const row of data ?? []) {
    const key = locationDateOnlyKey(row.freeform_location, {
      openingDatetime: row.opening_datetime,
      runStartDate: row.run_start_date,
      runEndDate: row.run_end_date,
    });
    const existing = titlesByLocationDateOnly.get(key);
    if (existing) existing.push(row.title);
    else titlesByLocationDateOnly.set(key, [row.title]);
  }

  return {
    titles: new Set((data ?? []).map((row) => normalizeTitle(row.title))),
    sourceUrls: new Set((data ?? []).flatMap((row) => (row.source_url ? [row.source_url] : []))),
    locationDates: new Set(
      (data ?? []).map((row) =>
        locationDateKey(row.freeform_location, {
          openingDatetime: row.opening_datetime,
          runStartDate: row.run_start_date,
          runEndDate: row.run_end_date,
        }),
      ),
    ),
    titlesByLocationDateOnly,
  };
}

export async function insertCandidates(
  candidates: EventCandidate[],
  regions: RegionLike[],
  seen: SeenKeys,
  now: Date,
  rehostImageFn: RehostImageFn = rehostImage,
): Promise<number> {
  const client = getSupabaseClient();
  let inserted = 0;

  for (const c of candidates) {
    // Rejected candidates are no longer stored — was originally kept for
    // audit (spotting false negatives, a real event wrongly rejected), but
    // that auditing never actually happened in practice, while storing
    // rejected rows was the direct cause of a real crash (2026-07-22, see
    // lib/event-filters.ts/lib/locations.ts's null-safety fixes):
    // processing every candidate, not just approved ones, through the
    // dedup/region-match code let a rejected candidate's null `location`
    // reach a code path that assumed it was always a string. A log line is
    // enough for now — full curationReasoning stays visible in the run's
    // own logs without the DB write or the crash surface that came with it.
    if (c.status !== "approved") {
      console.log(`[event-discovery] rejected: "${c.title}" — ${c.curationReasoning}`);
      continue;
    }

    if (!isCurrentOrUpcoming(c, now)) continue;

    const titleKey = normalizeTitle(c.title);
    const locDateKey = locationDateKey(c.location, c);
    const locDateOnlyKey = locationDateOnlyKey(c.location, c);
    const isDuplicateTitle = seen.titles.has(titleKey);
    const isDuplicateSourceUrl = c.sourceUrl !== null && seen.sourceUrls.has(c.sourceUrl);
    const isDuplicateLocationDate = seen.locationDates.has(locDateKey);
    const isFuzzyDuplicateTitle = (seen.titlesByLocationDateOnly.get(locDateOnlyKey) ?? []).some((existingTitle) =>
      isLikelySameTitle(existingTitle, c.title),
    );
    if (isDuplicateTitle || isDuplicateSourceUrl || isDuplicateLocationDate || isFuzzyDuplicateTitle) {
      const reason = isFuzzyDuplicateTitle && !isDuplicateTitle && !isDuplicateSourceUrl && !isDuplicateLocationDate
        ? " (same location + date, similar title — likely the same event reported with a different exact hour)"
        : isDuplicateLocationDate && !isDuplicateTitle && !isDuplicateSourceUrl
          ? " (same location + date, different title/source)"
          : isDuplicateSourceUrl && !isDuplicateTitle
            ? " (same sourceUrl, different title)"
            : "";
      console.log(`[event-discovery] skipping duplicate: "${c.title}"${reason}`);
      continue;
    }

    // Instagram/Facebook's own imageUrl is a signed CDN link that rots
    // within hours-to-days (confirmed against real production samples) —
    // only ever re-hosted for a candidate that's actually about to be
    // inserted (approved, guaranteed by the status check at the top of
    // this loop now). On failure this resolves to null rather than
    // storing a link already known to rot; see image-rehost.ts's own doc
    // comment.
    let imageUrl = c.imageUrl;
    if (imageUrl && c.sourceUrl && isSocialMediaUrl(c.sourceUrl)) {
      imageUrl = await rehostImageFn(imageUrl, client);
    }

    const { error } = await client.from("events").insert({
      freeform_location: c.location,
      place_name: c.placeName,
      region_id: matchRegionId(c.location, regions),
      title: c.title,
      description: c.description,
      artist: c.artist,
      opening_datetime: c.openingDatetime,
      opening_time_confirmed: c.openingTimeConfirmed,
      run_start_date: c.runStartDate,
      run_end_date: c.runEndDate,
      medium_type: c.mediumType,
      sensitivity_tags: c.sensitivityTags,
      source: "discovered",
      source_url: c.sourceUrl,
      image_url: imageUrl,
      curation_status: c.status,
      curation_reasoning: c.curationReasoning,
    });

    if (error) {
      // Real production incident: one malformed candidate (missing every
      // date field the DB accepts) threw and crashed the entire run,
      // losing every remaining unit and the bright-sources pass. One bad
      // candidate must not cost the whole month's data — log it and move
      // on; it's visible in the workflow's own logs for follow-up.
      console.error(`[event-discovery] failed to insert "${c.title}": ${error.message}`);
      continue;
    }

    seen.titles.add(titleKey);
    if (c.sourceUrl) seen.sourceUrls.add(c.sourceUrl);
    // seen.locationDates is deliberately NOT updated here — see this
    // function's own doc comment above (2026-07-23 MAC case): the blind
    // location+date fingerprint only applies against events already
    // stored from a PAST run, never between sibling candidates in this
    // same batch. Sibling comparisons rely on titlesByLocationDateOnly
    // below instead, which requires title similarity too.
    const bucket = seen.titlesByLocationDateOnly.get(locDateOnlyKey);
    if (bucket) bucket.push(c.title);
    else seen.titlesByLocationDateOnly.set(locDateOnlyKey, [c.title]);
    inserted += 1;
  }

  return inserted;
}

const EVENT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

// overview.md's retention policy: delete events roughly a year past their
// run's end, not their opening date. Mirrors date.ts's activeRange "end"
// derivation (run_end_date, else run_start_date, else opening_datetime) so
// an event with only a confirmed opening and no run dates is still retained
// relative to that date. Piggybacked on this run's own weekly cadence
// rather than a separate cron (same reasoning as pruneOldRawSearchResults)
// — ancillary, a failure here must never break the actual run.
async function pruneExpiredEvents(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - EVENT_RETENTION_MS).toISOString().slice(0, 10);
  const { error } = await getSupabaseClient().rpc("prune_expired_events", { cutoff_date: cutoff });
  if (error) {
    console.error(`[event-discovery] failed to prune expired events: ${error.message}`);
  }
}

const RAW_SEARCH_RESULTS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

// Not a permanent archive — a short rolling window so an on-demand review
// ("¿hay fuentes brillantes nuevas?" shortly after a run) has real data to
// query, without needing a separate cleanup job. Piggybacked on this
// run's own cadence (Event Discovery is manually triggered, no schedule
// yet) rather than a new automation. Ancillary — a failure here must never
// break the actual run.
async function pruneOldRawSearchResults(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - RAW_SEARCH_RESULTS_RETENTION_MS).toISOString();
  const { error } = await getSupabaseClient().from("raw_search_results").delete().lt("created_at", cutoff);
  if (error) {
    console.error(`[event-discovery] failed to prune raw_search_results: ${error.message}`);
  }
}

// Logs EVERY raw Tavily hit for a unit (before filterKnownExclusions, so
// the log reflects everything Tavily actually returned) — not just what
// Haiku turns into a candidate. `events` can't serve this purpose: a
// weak-snippet aggregator page can show up in every search and never
// produce a single candidate, so it would never appear there. Purpose:
// spot a domain that keeps showing up (a possible bright-source
// candidate, found the same way mnba.gob.cl was) without re-running
// searches by hand. Ancillary — a failure here must never break the
// actual run.
async function logRawSearchResults(unitName: string, results: RawResult[]): Promise<void> {
  if (results.length === 0) return;
  const rows = results.map((r) => {
    let domain: string;
    try {
      domain = knownSourceDomain(r.url);
    } catch {
      domain = r.url; // unparseable — keep something queryable rather than dropping the row
    }
    return { unit_name: unitName, domain, url: r.url, title: r.title, score: r.score };
  });
  const { error } = await getSupabaseClient().from("raw_search_results").insert(rows);
  if (error) {
    console.error(`[event-discovery] failed to log raw search results for ${unitName}: ${error.message}`);
  }
}

// Ancillary bookkeeping, same posture as pruneOldRawSearchResults/
// recordBrightSourcesFetched — a failure here must never fail the whole
// run, since by the time this runs (the very last step) every unit and
// bright source has already been fully processed and saved. Real
// production bug (2026-07-17): a domain-normalization mismatch (fixed in
// detectNewBrightSources) let an ALREADY-known source repeatedly get
// flagged "new", hitting detected_sources' unique constraint on url and
// crashing an otherwise-fully-successful run at the last step. Even with
// that root cause fixed, this loop stays defensive — a duplicate/race
// here is a real possibility (e.g. two runs overlapping) and shouldn't
// be allowed to mark real, already-saved event data as a failed run.
async function persistNewBrightSources(candidates: EventCandidate[], now: Date, excludeDomains: string[]): Promise<void> {
  const detected = detectNewBrightSources(candidates, now, excludeDomains);
  if (detected.length === 0) return;

  const client = getSupabaseClient();
  for (const source of detected) {
    const { error } = await client.from("detected_sources").insert({
      url: source.url,
      note: source.note,
    });
    if (error) {
      console.error(`[event-discovery] failed to persist detected source ${source.url}: ${error.message}`);
      continue;
    }
    console.log(`[event-discovery] new bright source auto-added: ${source.url}`);
  }
}

export interface RunDeps {
  messagesClient?: MessagesClient;
  searchUnitFn?: typeof searchUnit;
  fetchBrightSourcesFn?: typeof fetchBrightSources;
  pageFetchFn?: PageFetchLike;
  rehostImageFn?: RehostImageFn;
  sendRunSummaryEmailFn?: typeof sendRunSummaryEmail;
  now?: Date;
  // Added 2026-07-23: a manual "just run bright sources" request kept
  // triggering a full run, which also picked up the next `weekly_batch_size`
  // due comunas — spending real Tavily/Haiku cost on a batch nobody asked
  // for, just to test/refresh a handful of bright sources. Skips
  // getUnitsDueForRun and the whole comuna loop entirely; bright sources
  // still only fetch if actually due (isSourceDue) — this doesn't force
  // them, it only removes the comuna batch as a side effect of checking.
  brightSourcesOnly?: boolean;
  // Added 2026-07-23: debugging one misbehaving bright source (e.g.
  // arteinformado.com's "Cannot read properties of null" failure) meant
  // waiting for its own 7-day cadence, or clearing EVERY source's fetch
  // state just to force the one you actually wanted logs for. A substring
  // match against each source's own url (e.g. "arteinformado.com",
  // "parquecultural.cl") — when set, this REPLACES the normal isSourceDue
  // check entirely for that filtered set: a matched source runs
  // regardless of its own cadence, and everything else is skipped, not
  // just deprioritized. Implies brightSourcesOnly in spirit (there's
  // rarely a reason to also want the comuna batch when debugging one
  // named source) but doesn't force it — set both explicitly if that's
  // not what you want.
  brightSourceUrlFilter?: string[];
}

export async function run(deps: RunDeps = {}): Promise<void> {
  const tavilyApiKey = process.env.TAVILY_API_KEY;
  if (!tavilyApiKey && !deps.searchUnitFn) {
    throw new Error("TAVILY_API_KEY is not set");
  }

  const now = deps.now ?? new Date();
  const messagesClient: MessagesClient = deps.messagesClient ?? new Anthropic();
  const searchUnitFn = deps.searchUnitFn ?? searchUnit;
  const fetchBrightSourcesFn = deps.fetchBrightSourcesFn ?? fetchBrightSources;
  const pageFetchFn = deps.pageFetchFn ?? fetch;
  const rehostImageFn = deps.rehostImageFn ?? rehostImage;
  const client = getSupabaseClient();

  await pruneOldRawSearchResults(now);
  await pruneExpiredEvents(now);

  const systemPrompt = buildSystemPrompt(currentMonthLabel(now));
  const brightSources = mergeBrightSources(await loadDetectedSources());
  // excludeDomains stays based on EVERY known bright source, not just the
  // due ones — a domain we've decided to treat as a bright source should
  // never resurface via regular Tavily search, independent of whether
  // we're actually re-fetching it this particular run. Also includes the
  // known low-quality-extraction domains (KNOWN_LOW_QUALITY_SOURCE_DOMAINS,
  // e.g. infobae.com's multi-country agenda-cultura pages) — passed to
  // Tavily so it ideally never returns them at all (saves the credits/
  // tokens of a result we'd discard anyway); filterKnownExclusions still
  // filters the same domains from whatever Tavily actually returns, since
  // exclude_domains isn't perfectly reliable on Tavily's side.
  const excludeDomains = [...brightSources.map((s) => knownSourceDomain(s.url)), ...KNOWN_LOW_QUALITY_SOURCE_DOMAINS];
  const fetchState = await loadBrightSourceFetchState();
  const dueBrightSources = deps.brightSourceUrlFilter?.length
    ? brightSources.filter((s) => deps.brightSourceUrlFilter!.some((f) => s.url.includes(f)))
    : brightSources.filter((s) => isSourceDue(fetchState.get(s.url), now));
  const seenKeys = await loadExistingKeys();
  const regions = await loadAllRegions();
  const allCandidates: EventCandidate[] = [];

  const units = deps.brightSourcesOnly ? [] : await getUnitsDueForRun(now);
  console.log(
    deps.brightSourcesOnly
      ? `[event-discovery] bright-sources-only run: skipping comuna batch, ${dueBrightSources.length}/${brightSources.length} bright source(s) due`
      : `[event-discovery] ${units.length} unit(s) due, ${dueBrightSources.length}/${brightSources.length} bright source(s) due`,
  );

  // Accumulated purely from data the run already computes (usage/credits
  // already returned by curate()/searchUnitFn) — no new API calls, see
  // sendRunSummaryEmail's own doc comment.
  const summary: RunSummary = {
    startedAt: now,
    units: { total: 0, failed: [] },
    comunas: [],
    brightSources: { due: dueBrightSources.length, total: brightSources.length },
    candidates: {
      total: 0,
      approvedByCuration: 0,
      rejectedByCuration: 0,
      insertedCount: 0,
      byMediumType: {},
      sensitivityTagged: 0,
    },
    cost: { anthropicUsd: 0, tavilyCredits: 0, tavilyUsd: 0, totalUsd: 0, monthToDateUsd: 0, monthlyBudgetUsd: 0 },
  };

  for (const unit of units) {
    summary.units.total += 1;
    summary.comunas.push(unit.name);

    // Real production bug (2026-07-17, weekly-batch rollout's first live
    // run): an uncaught exception processing ONE unit (Haiku returned
    // status:"approved" with location:null, crashing isChileanLocation)
    // killed the entire run — losing every remaining unit in the batch,
    // not just the bad one, and none of them got their last_run_at
    // updated despite Tavily credits/Haiku tokens already spent on the
    // ones that DID complete first. A weekly batch of 25+ units makes
    // this much more costly than it was as a single-digit-unit risk
    // before. Isolating per-unit like insertCandidates already isolates
    // per-candidate: one broken unit is logged and skipped, not fatal to
    // the rest of the batch. Deliberately does NOT update last_run_at/
    // status for a failed unit — it stays "due" and gets retried next
    // run, rather than being silently marked done with no real data.
    try {
      const { results: rawResults, credits } = await searchUnitFn(tavilyApiKey ?? "", unit.name, now, excludeDomains);
      console.log(`[event-discovery] ${unit.name}: ${rawResults.length} results, ${credits} Tavily credits`);
      summary.cost.tavilyCredits += credits;
      await logRawSearchResults(unit.name, rawResults);

      // Drop known-out-of-scope results before they ever reach Haiku — saves
      // both the input tokens for that result's content and the output
      // tokens Haiku would've spent on a candidate we'd just discard anyway.
      const results = filterKnownExclusions(rawResults);
      if (results.length !== rawResults.length) {
        console.log(`[event-discovery] ${unit.name}: dropped ${rawResults.length - results.length} known-excluded result(s) before curation`);
      }

      let inserted = 0;
      if (results.length > 0) {
        const block = buildBlock(`Resultados de búsqueda para "${unit.name}"`, results);
        const { candidates, usage } = await curate(messagesClient, systemPrompt, block);
        await recordUsage({
          purpose: "event_discovery",
          model: EVENT_DISCOVERY_MODEL,
          regionId: unit.id,
          usage,
        });
        summary.cost.anthropicUsd += estimateCostUsd(EVENT_DISCOVERY_MODEL, usage);
        await enrichCandidates(candidates, pageFetchFn, now);
        allCandidates.push(...candidates);
        inserted = await insertCandidates(candidates, regions, seenKeys, now, rehostImageFn);
        summary.candidates.insertedCount += inserted;
      }

      // A comuna's first real run graduates it out of 'not_started' — restores
      // real meaning to `status` (previously written once at seed time, then
      // never touched again by a run). 'active'/'excluded' otherwise pass
      // through untouched; only 'not_started' ever flips here.
      const nextStatus = unit.status === "not_started" ? "active" : unit.status;
      const { error } = await client
        .from("regions")
        .update({ last_run_at: now.toISOString(), status: nextStatus })
        .eq("id", unit.id);
      if (error) {
        throw new Error(`Failed to update last_run_at for ${unit.name}: ${error.message}`);
      }

      console.log(`[event-discovery] ${unit.name}: ${inserted} new approved event(s)`);
    } catch (err) {
      summary.units.failed.push(unit.name);
      console.error(`[event-discovery] ${unit.name}: unit failed, skipping (stays due for next run): ${(err as Error).message}`);
    }
  }

  // Bright sources: fetched directly, curated ONE SOURCE AT A TIME — not
  // attached to each unit's prompt (real runs showed Haiku inconsistently
  // surfacing that content when attached per-unit). Only the ones due for
  // their own 7-day cadence get fetched at all.
  //
  // Was ONE combined curate() call over every due source's content at
  // once — real production crash (2026-07-23): with enough sources due
  // together (arteinformado.com's own multi-page content alone is
  // sizeable), Haiku's response hit its max_tokens ceiling mid-JSON and
  // curate() choked, losing EVERY source's candidates for that run, not
  // just the oversized one. curate() itself was also hardened the same
  // day to degrade to zero candidates (keeping the real usage) instead of
  // throwing on a parse failure — but that alone doesn't fix a single
  // source alone being enough to blow the budget. Splitting into
  // one-call-per-source, same isolation as the per-unit comuna loop
  // above, means a single oversized/truncated source only loses ITS OWN
  // candidates, not every other due source's.
  if (dueBrightSources.length > 0) {
    const brightResults = await fetchBrightSourcesFn(dueBrightSources);
    const monthLabel = currentMonthLabel(now);
    for (const result of brightResults) {
      // "items": a source with a real extractor config — deterministic
      // title/sourceUrl/imageUrl/dates, Haiku only does curatorial
      // judgment (curateBrightSourceItems, discover.ts). "rawResult": the
      // old fallback path, still used for auto-detected sources with no
      // extractor config yet — unchanged curate()/isBrightSource behavior.
      const sourceUrl = result.kind === "items" ? result.source.url : result.result.url;
      try {
        let candidates: EventCandidate[];
        let usage: DiscoverUsage;
        if (result.kind === "items") {
          ({ candidates, usage } = await curateBrightSourceItems(messagesClient, result.items, monthLabel, {
            fixedLocation: result.source.fixedLocation,
          }));
        } else {
          const block = buildBlock("Fuentes brillantes (no específicas a ninguna comuna)", [result.result]);
          ({ candidates, usage } = await curate(messagesClient, systemPrompt, block, { isBrightSource: true }));
        }
        await recordUsage({ purpose: "event_discovery", model: EVENT_DISCOVERY_MODEL, usage });
        summary.cost.anthropicUsd += estimateCostUsd(EVENT_DISCOVERY_MODEL, usage);
        await enrichCandidates(candidates, pageFetchFn, now);
        allCandidates.push(...candidates);
        const inserted = await insertCandidates(candidates, regions, seenKeys, now, rehostImageFn);
        summary.candidates.insertedCount += inserted;
        console.log(`[event-discovery] bright source ${sourceUrl}: ${inserted} new approved event(s)`);
      } catch (err) {
        // Stack, not just message — a real production case (2026-07-23,
        // arteinformado.com: "Cannot read properties of null (reading
        // 'replace')") had no line number to go on afterward, since only
        // .message was ever logged.
        console.error(`[event-discovery] bright source ${sourceUrl}: pass failed, skipping: ${(err as Error).stack ?? (err as Error).message}`);
      }
    }
    await recordBrightSourcesFetched(
      dueBrightSources.map((s) => s.url),
      now,
    );
  }

  await persistNewBrightSources(allCandidates, now, excludeDomains);

  // Ancillary reporting only — by this point every unit/bright-source has
  // already been fully processed and saved, so a failure computing or
  // sending the summary must never surface as a failed run (this file has
  // no top-level error handling; an uncaught rejection here would mark an
  // otherwise fully-successful GitHub Action run as failed).
  try {
    summary.candidates.total = allCandidates.length;
    for (const c of allCandidates) {
      if (c.status === "approved") summary.candidates.approvedByCuration += 1;
      if (c.status === "rejected") summary.candidates.rejectedByCuration += 1;
      summary.candidates.byMediumType[c.mediumType] = (summary.candidates.byMediumType[c.mediumType] ?? 0) + 1;
      if (c.sensitivityTags.length > 0) summary.candidates.sensitivityTagged += 1;
    }
    summary.cost.tavilyUsd = summary.cost.tavilyCredits * TAVILY_COST_PER_CREDIT;
    summary.cost.totalUsd = summary.cost.anthropicUsd + summary.cost.tavilyUsd;
    summary.cost.monthToDateUsd = await getCurrentMonthSpend();
    summary.cost.monthlyBudgetUsd = await getConfigNumber("monthly_budget_usd");

    await (deps.sendRunSummaryEmailFn ?? sendRunSummaryEmail)(summary);
  } catch (err) {
    console.error(`[event-discovery] failed to build/send run-summary email: ${(err as Error).message}`);
  }
}
