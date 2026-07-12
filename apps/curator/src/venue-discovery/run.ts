import Anthropic from "@anthropic-ai/sdk";
import type { Tables } from "@caldearte/shared-types";
import { getSupabaseClient } from "../lib/supabase-client.js";
import {
  recordUsage,
  getCurrentMonthSpend,
  getConfigNumber,
  isOverBudget,
  isOverRegionCap,
} from "../lib/usage-tracking.js";
import { flagBudgetExceeded } from "../lib/notify.js";
import { discoverVenues, type MessagesClient } from "./discover.js";
import { findMatchingVenue, extractDomain, deriveListingUrl, consolidateCandidates } from "./dedup.js";

type Region = Tables<"regions">;

const MODEL = "claude-haiku-4-5";
const SATURATION_THRESHOLD = 2;
const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000;
const MONTHLY_MS = 30 * 24 * 60 * 60 * 1000;

function isDueForRun(region: Region): boolean {
  if (!region.last_run_at) return true;
  const elapsed = Date.now() - new Date(region.last_run_at).getTime();
  const interval = region.search_frequency === "monthly" ? MONTHLY_MS : WEEKLY_MS;
  return elapsed >= interval;
}

export async function getRegionsDueForRun(): Promise<Region[]> {
  const { data, error } = await getSupabaseClient().from("regions").select("*").eq(
    "status",
    "active",
  );

  if (error) {
    throw new Error(`Failed to load active regions: ${error.message}`);
  }

  return (data ?? []).filter(isDueForRun);
}

async function updateRegionAfterRun(region: Region, insertedCount: number): Promise<void> {
  const client = getSupabaseClient();
  const zeroYield = insertedCount === 0;
  const consecutiveZeroYieldRuns = zeroYield ? region.consecutive_zero_yield_runs + 1 : 0;

  let status = region.status;
  let searchFrequency = region.search_frequency;

  if (zeroYield && consecutiveZeroYieldRuns >= SATURATION_THRESHOLD) {
    status = "saturated";
    searchFrequency = "monthly";
  } else if (!zeroYield && region.status === "saturated") {
    status = "active";
    searchFrequency = "weekly";
  }

  const { error } = await client
    .from("regions")
    .update({
      consecutive_zero_yield_runs: consecutiveZeroYieldRuns,
      status,
      search_frequency: searchFrequency,
      last_run_at: new Date().toISOString(),
    })
    .eq("id", region.id);

  if (error) {
    throw new Error(`Failed to update region ${region.id} after run: ${error.message}`);
  }
}

export interface RunRegionDeps {
  discover?: (
    region: Region,
    client: MessagesClient,
    existingVenueNames: string[],
  ) => ReturnType<typeof discoverVenues>;
  messagesClient?: MessagesClient;
}

export async function runRegion(
  region: Region,
  deps: RunRegionDeps = {},
): Promise<{ inserted: number }> {
  const client = getSupabaseClient();
  const discover = deps.discover ?? discoverVenues;
  const messagesClient = deps.messagesClient ?? new Anthropic();

  // Fetched before discovery (not just for matching afterward) so we can
  // tell the model what's already known — this is what makes a region's
  // second and later runs cheaper than its first. See
  // docs/region-discovery.md#cost-governance.
  const { data: existingVenues, error: existingError } = await client
    .from("venues")
    .select("id, name, source_domain, listing_url")
    .eq("region_id", region.id);

  if (existingError) {
    throw new Error(
      `Failed to load existing venues for region ${region.id}: ${existingError.message}`,
    );
  }

  const existingVenueNames = (existingVenues ?? []).map((v) => v.name);

  const { candidates, usage } = await discover(region, messagesClient, existingVenueNames);

  await recordUsage({
    purpose: "venue_discovery",
    model: MODEL,
    regionId: region.id,
    usage,
  });

  const newCandidates: typeof candidates = [];

  // Consolidate against the batch itself first — a single discover() call
  // can report the same institution more than once (e.g. once per
  // exhibition it hosts), which existingVenues-based matching alone
  // wouldn't catch since it only compares against rows from before this run.
  for (const candidate of consolidateCandidates(candidates)) {
    const match = findMatchingVenue(candidate, existingVenues ?? []);

    if (!match) {
      newCandidates.push(candidate);
      continue;
    }

    // Already-known venue: not a new discovery, but if this candidate
    // surfaced via a specific exhibition/intervention page and we don't
    // have a listing_url yet, backfill it — this is how venues found
    // before this feature existed get resolved over time, not just new
    // ones. Doesn't count toward insertedCount/saturation below.
    //
    // Only derived from an "oficial" source — a diffusion source (news,
    // aggregator, municipal listing) doesn't update when the venue's own
    // exhibitions change and often covers many venues at once, so deriving
    // a "listing page" from it would misattribute whatever the Event
    // Crawler later finds there (this is exactly the bug the first real
    // run surfaced: MAC's two locations and MNBA/Casa Museo Santa Rosa all
    // ended up sharing another institution's or an aggregator's URL).
    if (!match.listing_url && candidate.sourceUrl && candidate.sourceType === "oficial") {
      const listingUrl = deriveListingUrl(candidate.sourceUrl);
      if (listingUrl) {
        const { error: updateError } = await client
          .from("venues")
          .update({ listing_url: listingUrl })
          .eq("id", match.id);

        if (updateError) {
          throw new Error(
            `Failed to backfill listing_url for venue ${match.id}: ${updateError.message}`,
          );
        }
      }
    }
  }

  if (newCandidates.length > 0) {
    const { error: insertError } = await client.from("venues").insert(
      newCandidates.map((c) => ({
        region_id: region.id,
        name: c.name,
        address: c.address,
        source_domain: extractDomain(c.websiteOrSocial),
        listing_url: c.sourceUrl && c.sourceType === "oficial" ? deriveListingUrl(c.sourceUrl) : null,
        contact_email: c.contactEmail,
        category: c.category,
      })),
    );

    if (insertError) {
      throw new Error(`Failed to insert venues for region ${region.id}: ${insertError.message}`);
    }
  }

  await updateRegionAfterRun(region, newCandidates.length);

  return { inserted: newCandidates.length };
}

// Infrastructure for Phase 1c: with no `not_started` region carrying an
// `expansion_rank` seeded yet, this correctly finds nothing to activate
// today. See docs/region-discovery.md.
async function maybeExpandToNextRegion(): Promise<void> {
  const client = getSupabaseClient();

  const { count, error } = await client
    .from("regions")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");

  if (error) {
    throw new Error(`Failed to count active regions: ${error.message}`);
  }

  if ((count ?? 0) > 0) {
    return;
  }

  const [overBudget, overRegionCap] = await Promise.all([isOverBudget(), isOverRegionCap()]);

  if (overBudget) {
    const [spend, budget] = await Promise.all([
      getCurrentMonthSpend(),
      getConfigNumber("monthly_budget_usd"),
    ]);
    await flagBudgetExceeded({ spend, budget });
    return;
  }

  if (overRegionCap) {
    console.warn("maybeExpandToNextRegion: region cap reached, skipping expansion");
    return;
  }

  const { data: nextRegion, error: nextError } = await client
    .from("regions")
    .select("*")
    .eq("status", "not_started")
    .not("expansion_rank", "is", null)
    .order("expansion_rank", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (nextError) {
    throw new Error(`Failed to find next region to activate: ${nextError.message}`);
  }

  if (!nextRegion) {
    return;
  }

  const { error: activateError } = await client
    .from("regions")
    .update({ status: "active", search_frequency: "weekly" })
    .eq("id", nextRegion.id);

  if (activateError) {
    throw new Error(`Failed to activate region ${nextRegion.id}: ${activateError.message}`);
  }
}

export async function run(): Promise<void> {
  const regions = await getRegionsDueForRun();

  for (const region of regions) {
    const { inserted } = await runRegion(region);
    console.log(`[venue-discovery] ${region.name}: ${inserted} new venue(s)`);
  }

  await maybeExpandToNextRegion();
}
