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
import { eventKey, isUpcomingDated } from "../lib/event-filters.js";
import { discoverEvents, type MessagesClient, type EventDiscoveryCandidate } from "./discover.js";
import { findMatchingVenue, extractDomain, deriveListingUrl, type ExistingVenue } from "./dedup.js";

type Region = Tables<"regions">;

// Kept as "venue_discovery" in api_usage_log even though this pass now
// produces events directly — renaming the label needs a migration (a
// CHECK constraint governs this column, see
// 20260712000000_rename_usage_log_purpose_values.sql), not worth it just
// for a name. See docs/region-discovery.md.
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

// Yield is now measured in events inserted, not venues — venues are a
// byproduct, and the saturation/cadence logic should track what actually
// matters (docs/region-discovery.md).
async function updateRegionAfterRun(region: Region, insertedEventCount: number): Promise<void> {
  const client = getSupabaseClient();
  const zeroYield = insertedEventCount === 0;
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

async function isNewEvent(
  venueId: string | null,
  freeformLocation: string | null,
  title: string,
  openingDatetime: string | null,
): Promise<boolean> {
  const client = getSupabaseClient();
  let query = client.from("events").select("title, opening_datetime");
  query = venueId ? query.eq("venue_id", venueId) : query.eq("freeform_location", freeformLocation ?? "");

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to check existing events: ${error.message}`);
  }

  const key = eventKey(title, openingDatetime);
  return !(data ?? []).some((e) => eventKey(e.title, e.opening_datetime) === key);
}

// Matches or creates a venue for a candidate that identified one, keeping
// `knownVenues` up to date so a second candidate for the same institution
// later in this same batch matches it instead of creating a duplicate —
// replaces the old whole-candidate consolidation, which was wrong once a
// "candidate" started meaning one event rather than one venue (two
// different exhibitions at the same institution must both survive).
async function resolveVenue(
  candidate: EventDiscoveryCandidate,
  regionId: string,
  knownVenues: ExistingVenue[],
): Promise<ExistingVenue> {
  const client = getSupabaseClient();
  const identity = {
    name: candidate.venueName as string,
    websiteOrSocial: candidate.venueWebsiteOrSocial,
    sourceUrl: candidate.sourceUrl,
  };

  const match = findMatchingVenue(identity, knownVenues);

  if (match) {
    if (!match.listing_url && candidate.sourceUrl && candidate.sourceType === "oficial") {
      const listingUrl = deriveListingUrl(candidate.sourceUrl);
      if (listingUrl) {
        const { error } = await client.from("venues").update({ listing_url: listingUrl }).eq("id", match.id);
        if (error) throw new Error(`Failed to backfill listing_url for venue ${match.id}: ${error.message}`);
        match.listing_url = listingUrl;
      }
    }
    return match;
  }

  const { data: inserted, error } = await client
    .from("venues")
    .insert({
      region_id: regionId,
      name: identity.name,
      address: candidate.venueAddress,
      source_domain: extractDomain(candidate.venueWebsiteOrSocial),
      listing_url: candidate.sourceUrl && candidate.sourceType === "oficial" ? deriveListingUrl(candidate.sourceUrl) : null,
      contact_email: candidate.contactEmail,
      category: candidate.venueCategory ?? "needs_review",
    })
    .select("id, name, source_domain, listing_url")
    .single();

  if (error || !inserted) {
    throw new Error(`Failed to insert venue for region ${regionId}: ${error?.message}`);
  }

  knownVenues.push(inserted);
  return inserted;
}

export interface RunRegionDeps {
  discover?: (
    region: Region,
    client: MessagesClient,
    existingVenueNames: string[],
  ) => ReturnType<typeof discoverEvents>;
  messagesClient?: MessagesClient;
}

export async function runRegion(
  region: Region,
  deps: RunRegionDeps = {},
): Promise<{ inserted: number }> {
  const client = getSupabaseClient();
  const discover = deps.discover ?? discoverEvents;
  const messagesClient = deps.messagesClient ?? new Anthropic();

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

  for (const u of usage) {
    await recordUsage({ purpose: "venue_discovery", model: MODEL, regionId: region.id, usage: u });
  }

  const knownVenues: ExistingVenue[] = [...(existingVenues ?? [])];
  let insertedCount = 0;

  for (const candidate of candidates) {
    if (candidate.venueCategory === "hard_excluded") continue;
    if (!isUpcomingDated({ title: candidate.title, openingDatetime: candidate.openingDatetime })) continue;

    let venueId: string | null = null;
    let freeformLocation: string | null = null;
    let curationStatus = candidate.status;

    if (candidate.venueName) {
      const venue = await resolveVenue(candidate, region.id, knownVenues);
      venueId = venue.id;
      if (candidate.venueCategory === "needs_review") curationStatus = "pending_review";
    } else {
      freeformLocation = candidate.freeformLocation;
    }

    const isNew = await isNewEvent(venueId, freeformLocation, candidate.title, candidate.openingDatetime);
    if (!isNew) continue;

    const { error: insertError } = await client.from("events").insert({
      venue_id: venueId,
      freeform_location: freeformLocation,
      title: candidate.title,
      description: candidate.description,
      artist: candidate.artist,
      opening_datetime: candidate.openingDatetime as string,
      opening_date_confidence: candidate.openingDateConfidence,
      medium_type: candidate.mediumType,
      sensitivity_tags: candidate.sensitivityTags,
      source: "discovered",
      source_url: candidate.sourceUrl,
      image_url: candidate.imageUrl,
      curation_status: curationStatus,
      curation_reasoning: candidate.curationReasoning,
    });

    if (insertError) {
      throw new Error(`Failed to insert event for region ${region.id}: ${insertError.message}`);
    }

    insertedCount += 1;
  }

  await updateRegionAfterRun(region, insertedCount);

  return { inserted: insertedCount };
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
    console.log(`[event-discovery] ${region.name}: ${inserted} new event(s)`);
  }

  await maybeExpandToNextRegion();
}
