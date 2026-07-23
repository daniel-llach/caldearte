// Separate, deferred orchestrator for bright sources that need a real
// browser to read at all (MAVI UC today — see lib/mavi-headless.ts for
// why). Deliberately its OWN process/workflow, not folded into
// event-discovery/run.ts: the main weekly run already sits close to
// GitHub Actions' 6-hour job ceiling across 346 comunas (docs/
// region-discovery.md), and a headless browser launch + page render is
// several seconds versus sub-second for a plain fetch() — mixing the two
// risks that budget for a source most runs won't even need to re-fetch
// (bright_source_fetch_state's existing 7-day per-source cadence, reused
// as-is here). Isolating it in its own workflow also means a Playwright
// failure (a new, more fragile dependency than anything else in this
// pipeline) can never fail the main run.
//
// Reuses event-discovery/run.ts's curation/insertion pipeline completely
// unchanged (same buildSystemPrompt, same curate(), same
// nullifyOpeningDatetimeForKnownSources safety net, same insertCandidates
// dedup) — the only new thing here is HOW the source content gets fetched,
// not how it gets curated.
import Anthropic from "@anthropic-ai/sdk";
import { recordUsage, getConfigNumber, getCurrentMonthSpend } from "../lib/usage-tracking.js";
import { estimateCostUsd } from "../lib/pricing.js";
import { enrichCandidates, type FetchLike as PageFetchLike } from "../lib/page-fetch.js";
import { fetchMaviActivities, type MaviActivity } from "../lib/mavi-headless.js";
import { sendHeadlessRunSummaryEmail, type HeadlessRunSummary } from "../lib/notify.js";
import {
  buildBlock,
  buildSystemPrompt,
  currentMonthLabel,
  curate,
  EVENT_DISCOVERY_MODEL,
  type MessagesClient,
  type RawResult,
} from "../event-discovery/discover.js";
import {
  insertCandidates,
  loadAllRegions,
  loadBrightSourceFetchState,
  loadExistingKeys,
  isSourceDue,
  recordBrightSourcesFetched,
} from "../event-discovery/run.js";

// The listing page itself is the identity tracked in
// bright_source_fetch_state — same table/cadence mechanism the main run's
// bright sources already use (see lib/mavi-headless.ts's own doc comment
// for why THIS URL specifically can't be fetched any other way).
const MAVI_SOURCE_URL = "https://mavi.uc.cl/exposiciones-actuales/";

function maviActivityToRawResult(activity: MaviActivity): RawResult {
  return {
    title: activity.title,
    url: activity.detailUrl,
    content: activity.placeName ? `${activity.content}\n\nLugar: ${activity.placeName}` : activity.content,
    score: 1,
    images: activity.imageUrl ? [{ url: activity.imageUrl, description: "Imagen principal de la exposición" }] : [],
  };
}

export interface HeadlessRunDeps {
  messagesClient?: MessagesClient;
  fetchMaviActivitiesFn?: typeof fetchMaviActivities;
  pageFetchFn?: PageFetchLike;
  sendHeadlessRunSummaryEmailFn?: typeof sendHeadlessRunSummaryEmail;
  now?: Date;
}

export async function run(deps: HeadlessRunDeps = {}): Promise<void> {
  const now = deps.now ?? new Date();
  const messagesClient: MessagesClient = deps.messagesClient ?? new Anthropic();
  const fetchMaviActivitiesFn = deps.fetchMaviActivitiesFn ?? fetchMaviActivities;
  const pageFetchFn = deps.pageFetchFn ?? fetch;

  const fetchState = await loadBrightSourceFetchState();
  const due = isSourceDue(fetchState.get(MAVI_SOURCE_URL), now);

  const summary: HeadlessRunSummary = {
    startedAt: now,
    sourcesFetched: due ? [MAVI_SOURCE_URL] : [],
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

  if (!due) {
    console.log(`[headless-discovery] ${MAVI_SOURCE_URL} not due yet (7-day cadence) — nothing to do`);
    await (deps.sendHeadlessRunSummaryEmailFn ?? sendHeadlessRunSummaryEmail)(summary);
    return;
  }

  const activities = await fetchMaviActivitiesFn();
  console.log(`[headless-discovery] fetched ${activities.length} MAVI activity(ies)`);

  if (activities.length > 0) {
    const systemPrompt = buildSystemPrompt(currentMonthLabel(now));
    const block = buildBlock("Fuentes brillantes headless (MAVI UC)", activities.map(maviActivityToRawResult));
    const { candidates, usage } = await curate(messagesClient, systemPrompt, block);

    await recordUsage({ purpose: "event_discovery", model: EVENT_DISCOVERY_MODEL, usage });
    summary.cost.anthropicUsd = estimateCostUsd(EVENT_DISCOVERY_MODEL, usage);
    summary.cost.totalUsd = summary.cost.anthropicUsd;

    await enrichCandidates(candidates, pageFetchFn, now);

    const regions = await loadAllRegions();
    const seenKeys = await loadExistingKeys();
    const inserted = await insertCandidates(candidates, regions, seenKeys, now);

    summary.candidates.total = candidates.length;
    summary.candidates.insertedCount = inserted;
    for (const c of candidates) {
      if (c.status === "approved") summary.candidates.approvedByCuration += 1;
      if (c.status === "rejected") summary.candidates.rejectedByCuration += 1;
      summary.candidates.byMediumType[c.mediumType] = (summary.candidates.byMediumType[c.mediumType] ?? 0) + 1;
      if (c.sensitivityTags.length > 0) summary.candidates.sensitivityTagged += 1;
    }
    console.log(`[headless-discovery] ${inserted} new approved event(s) inserted`);
  }

  await recordBrightSourcesFetched([MAVI_SOURCE_URL], now);

  try {
    summary.cost.monthToDateUsd = await getCurrentMonthSpend();
    summary.cost.monthlyBudgetUsd = await getConfigNumber("monthly_budget_usd");
  } catch (err) {
    // Ancillary reporting only — every event is already fully saved by
    // this point, same posture as event-discovery/run.ts's own summary
    // try/catch.
    console.error(`[headless-discovery] failed to compute month-to-date spend for the summary email: ${(err as Error).message}`);
  }

  await (deps.sendHeadlessRunSummaryEmailFn ?? sendHeadlessRunSummaryEmail)(summary);
}
