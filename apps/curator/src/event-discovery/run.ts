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
import {
  buildBlock,
  buildSystemPrompt,
  curate,
  currentMonthLabel,
  EVENT_DISCOVERY_MODEL,
  isCurrentOrUpcoming,
  normalizeTitle,
  searchUnit,
  type EventCandidate,
  type MessagesClient,
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
// Normalized title is the key — the same event routinely surfaces with
// slightly different punctuation/quoting across sources and runs, which
// exact-match comparison misses (a real observed failure).
async function loadExistingTitleKeys(): Promise<Set<string>> {
  const { data, error } = await getSupabaseClient()
    .from("events")
    .select("title")
    .eq("source", "discovered");

  if (error) {
    throw new Error(`Failed to load existing discovered events: ${error.message}`);
  }

  return new Set((data ?? []).map((row) => normalizeTitle(row.title)));
}

async function insertCandidates(
  candidates: EventCandidate[],
  regionId: string | null,
  seenTitleKeys: Set<string>,
  now: Date,
): Promise<number> {
  const client = getSupabaseClient();
  let inserted = 0;

  for (const c of candidates) {
    if (!isCurrentOrUpcoming(c, now)) continue;

    const key = normalizeTitle(c.title);
    if (seenTitleKeys.has(key)) {
      console.log(`[event-discovery] skipping duplicate: "${c.title}"`);
      continue;
    }

    const { error } = await client.from("events").insert({
      venue_id: null,
      freeform_location: c.location,
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
      throw new Error(`Failed to insert event "${c.title}": ${error.message}`);
    }

    seenTitleKeys.add(key);
    if (c.status === "approved") inserted += 1;
  }

  return inserted;
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
  const client = getSupabaseClient();

  const systemPrompt = buildSystemPrompt(currentMonthLabel(now));
  const brightSources = mergeBrightSources(await loadDetectedSources());
  const excludeDomains = brightSources.map((s) => knownSourceDomain(s.url));
  const seenTitleKeys = await loadExistingTitleKeys();
  const allCandidates: EventCandidate[] = [];

  const units = await getUnitsDueForRun(now);
  console.log(`[event-discovery] ${units.length} unit(s) due, ${brightSources.length} bright source(s)`);

  for (const unit of units) {
    const { results, credits } = await searchUnitFn(tavilyApiKey ?? "", unit.name, now, excludeDomains);
    console.log(`[event-discovery] ${unit.name}: ${results.length} results, ${credits} Tavily credits`);

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
      allCandidates.push(...candidates);
      inserted = await insertCandidates(candidates, unit.id, seenTitleKeys, now);
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
    allCandidates.push(...candidates);
    const inserted = await insertCandidates(candidates, null, seenTitleKeys, now);
    console.log(`[event-discovery] bright sources: ${inserted} new approved event(s)`);
  }

  await persistNewBrightSources(allCandidates, now, excludeDomains);
}
