// Event Discovery orchestrator — deliberately simple (docs/region-discovery.md):
// every unit in `regions` gets a fixed monthly pass, no saturation state
// machine, no adaptive cadence, no automatic expansion. The old
// status/search_frequency/consecutive_zero_yield_runs columns are ignored
// entirely (they stay in the schema unread — no migration needed to stop
// using them); only status='excluded' is still honored, since exclusion
// (e.g. OFAC) is an editorial decision, not cadence machinery.
import Anthropic from "@anthropic-ai/sdk";
import type { Tables } from "@caldearte/shared-types";
import { getSupabaseClient } from "../lib/supabase-client.js";
import { recordUsage } from "../lib/usage-tracking.js";
import { knownSourceDomain } from "../lib/known-sources.js";
import { matchRegionId, type RegionLike } from "../lib/locations.js";
import { enrichMissingImages, type FetchLike as PageFetchLike } from "../lib/page-fetch.js";
import {
  buildBlock,
  buildSystemPrompt,
  curate,
  currentMonthLabel,
  EVENT_DISCOVERY_MODEL,
  filterKnownExclusions,
  isCurrentOrUpcoming,
  normalizeTitle,
  searchUnit,
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

function isDueForRun(region: Region, now: Date): boolean {
  if (!region.last_run_at) return true;
  return now.getTime() - new Date(region.last_run_at).getTime() >= RUN_INTERVAL_MS;
}

export async function getUnitsDueForRun(now: Date = new Date()): Promise<Region[]> {
  const { data, error } = await getSupabaseClient()
    .from("regions")
    .select("*")
    .neq("status", "excluded");

  if (error) {
    throw new Error(`Failed to load units: ${error.message}`);
  }

  return (data ?? []).filter((r) => isDueForRun(r, now));
}

// All regions, regardless of status — region_id is a location tag, not a
// "should we search here" flag, so an event can still match an excluded
// or not-yet-due region by name.
async function loadAllRegions(): Promise<RegionLike[]> {
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

// Cross-run dedup: don't re-insert an event already in the calendar (e.g.
// a mid-July re-run must not duplicate everything found on July 1st).
// Two keys, either one is enough to count as a duplicate:
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
async function loadExistingKeys(): Promise<{ titles: Set<string>; sourceUrls: Set<string> }> {
  const { data, error } = await getSupabaseClient()
    .from("events")
    .select("title, source_url")
    .eq("source", "discovered");

  if (error) {
    throw new Error(`Failed to load existing discovered events: ${error.message}`);
  }

  return {
    titles: new Set((data ?? []).map((row) => normalizeTitle(row.title))),
    sourceUrls: new Set((data ?? []).flatMap((row) => (row.source_url ? [row.source_url] : []))),
  };
}

async function insertCandidates(
  candidates: EventCandidate[],
  regions: RegionLike[],
  seen: { titles: Set<string>; sourceUrls: Set<string> },
  now: Date,
): Promise<number> {
  const client = getSupabaseClient();
  let inserted = 0;

  for (const c of candidates) {
    if (!isCurrentOrUpcoming(c, now)) continue;

    const titleKey = normalizeTitle(c.title);
    const isDuplicateTitle = seen.titles.has(titleKey);
    const isDuplicateSourceUrl = c.sourceUrl !== null && seen.sourceUrls.has(c.sourceUrl);
    if (isDuplicateTitle || isDuplicateSourceUrl) {
      const reason = isDuplicateSourceUrl && !isDuplicateTitle ? " (same sourceUrl, different title)" : "";
      console.log(`[event-discovery] skipping duplicate: "${c.title}"${reason}`);
      continue;
    }

    const { error } = await client.from("events").insert({
      freeform_location: c.location,
      place_name: c.placeName,
      region_id: matchRegionId(c.location, regions),
      title: c.title,
      description: c.description,
      artist: c.artist,
      opening_datetime: c.openingDatetime,
      run_start_date: c.runStartDate,
      run_end_date: c.runEndDate,
      medium_type: c.mediumType,
      sensitivity_tags: c.sensitivityTags,
      source: "discovered",
      source_url: c.sourceUrl,
      image_url: c.imageUrl,
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
    if (c.status === "approved") inserted += 1;
  }

  return inserted;
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
      throw new Error(`Failed to persist detected source ${source.url}: ${error.message}`);
    }
    console.log(`[event-discovery] new bright source auto-added: ${source.url}`);
  }
}

export interface RunDeps {
  messagesClient?: MessagesClient;
  searchUnitFn?: typeof searchUnit;
  fetchBrightSourcesFn?: typeof fetchBrightSources;
  pageFetchFn?: PageFetchLike;
  now?: Date;
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
  const client = getSupabaseClient();

  await pruneOldRawSearchResults(now);

  const systemPrompt = buildSystemPrompt(currentMonthLabel(now));
  const brightSources = mergeBrightSources(await loadDetectedSources());
  const excludeDomains = brightSources.map((s) => knownSourceDomain(s.url));
  const seenKeys = await loadExistingKeys();
  const regions = await loadAllRegions();
  const allCandidates: EventCandidate[] = [];

  const units = await getUnitsDueForRun(now);
  console.log(`[event-discovery] ${units.length} unit(s) due, ${brightSources.length} bright source(s)`);

  for (const unit of units) {
    const { results: rawResults, credits } = await searchUnitFn(tavilyApiKey ?? "", unit.name, now, excludeDomains);
    console.log(`[event-discovery] ${unit.name}: ${rawResults.length} results, ${credits} Tavily credits`);
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
      await enrichMissingImages(candidates, pageFetchFn);
      allCandidates.push(...candidates);
      inserted = await insertCandidates(candidates, regions, seenKeys, now);
    }

    const { error } = await client
      .from("regions")
      .update({ last_run_at: now.toISOString() })
      .eq("id", unit.id);
    if (error) {
      throw new Error(`Failed to update last_run_at for ${unit.name}: ${error.message}`);
    }

    console.log(`[event-discovery] ${unit.name}: ${inserted} new approved event(s)`);
  }

  // Bright sources: fetched directly and curated ONCE per run, in their own
  // call — not attached to each unit's prompt (real runs showed Haiku
  // inconsistently surfacing that content when attached per-unit).
  const brightResults = await fetchBrightSourcesFn(brightSources);
  if (brightResults.length > 0) {
    const block = buildBlock("Fuentes brillantes (no específicas a ninguna comuna)", brightResults);
    const { candidates, usage } = await curate(messagesClient, systemPrompt, block);
    await recordUsage({ purpose: "event_discovery", model: EVENT_DISCOVERY_MODEL, usage });
    await enrichMissingImages(candidates, pageFetchFn);
    allCandidates.push(...candidates);
    const inserted = await insertCandidates(candidates, regions, seenKeys, now);
    console.log(`[event-discovery] bright sources: ${inserted} new approved event(s)`);
  }

  await persistNewBrightSources(allCandidates, now, excludeDomains);
}
