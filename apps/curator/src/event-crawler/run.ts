import Anthropic from "@anthropic-ai/sdk";
import type { Tables } from "@caldearte/shared-types";
import { getSupabaseClient } from "../lib/supabase-client.js";
import { hashContent } from "../lib/content-hash.js";
import { recordUsage } from "../lib/usage-tracking.js";
import { defaultPageFetcher, type PageFetcher } from "./fetch-page.js";
import { extractImageCandidates } from "./extract-images.js";
import { curateVenuePage, defaultImageFetcher, type EventCandidate, type ImageFetcher, type MessagesClient } from "./curate.js";

type Venue = Tables<"venues">;

const MODEL = "claude-haiku-4-5";
const ZERO_YIELD_STREAK_FOR_SLOWDOWN = 3;
const DEFAULT_CHECK_FREQUENCY_DAYS = 3;
const SLOW_CHECK_FREQUENCY_DAYS = 7;

// Social platforms have no reliable "current exhibitions" page to fetch and
// carry ToS risk for direct scraping (docs/risks.md) — excluded from v1,
// not deleted. Revisit once there's a real path for them (e.g. Phase 1b's
// public mailbox).
const SOCIAL_DOMAIN_DENYLIST = new Set(["facebook.com", "instagram.com"]);

function isDueForCheck(venue: Venue): boolean {
  if (!venue.last_checked_at) return true;
  const elapsed = Date.now() - new Date(venue.last_checked_at).getTime();
  const intervalMs = venue.check_frequency_days * 24 * 60 * 60 * 1000;
  return elapsed >= intervalMs;
}

export async function getVenuesDueForCheck(): Promise<Venue[]> {
  const { data, error } = await getSupabaseClient()
    .from("venues")
    .select("*")
    .eq("category", "art_space")
    .not("source_domain", "is", null);

  if (error) {
    throw new Error(`Failed to load crawlable venues: ${error.message}`);
  }

  return (data ?? [])
    .filter((v) => v.source_domain && !SOCIAL_DOMAIN_DENYLIST.has(v.source_domain))
    .filter(isDueForCheck);
}

async function updateVenueAfterCheck(
  venue: Venue,
  contentHash: string,
  insertedCount: number,
): Promise<void> {
  const zeroYield = insertedCount === 0;
  const consecutiveZeroYieldChecks = zeroYield ? venue.consecutive_zero_yield_checks + 1 : 0;

  const checkFrequencyDays =
    zeroYield && consecutiveZeroYieldChecks >= ZERO_YIELD_STREAK_FOR_SLOWDOWN
      ? SLOW_CHECK_FREQUENCY_DAYS
      : zeroYield
        ? venue.check_frequency_days
        : DEFAULT_CHECK_FREQUENCY_DAYS;

  const { error } = await getSupabaseClient()
    .from("venues")
    .update({
      content_hash: contentHash,
      last_checked_at: new Date().toISOString(),
      consecutive_zero_yield_checks: consecutiveZeroYieldChecks,
      check_frequency_days: checkFrequencyDays,
    })
    .eq("id", venue.id);

  if (error) {
    throw new Error(`Failed to update venue ${venue.id} after check: ${error.message}`);
  }
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

// Compares by parsed instant, not raw string — Postgres normalizes
// timestamptz to UTC on storage, so a candidate re-evaluated later can
// come back from the model with a different (but equivalent) ISO offset
// than what's already stored. Comparing text would treat that as "new"
// and re-insert the same event under a different curation_status.
function eventKey(title: string, openingDatetime: string | null): string {
  const time = openingDatetime ? new Date(openingDatetime).getTime() : Number.NaN;
  return `${normalizeTitle(title)}|${Number.isNaN(time) ? "invalid" : time}`;
}

async function filterNewEvents(
  venueId: string,
  candidates: EventCandidate[],
): Promise<EventCandidate[]> {
  const { data: existing, error } = await getSupabaseClient()
    .from("events")
    .select("title, opening_datetime")
    .eq("venue_id", venueId);

  if (error) {
    throw new Error(`Failed to load existing events for venue ${venueId}: ${error.message}`);
  }

  const existingKeys = new Set(
    (existing ?? []).map((e) => eventKey(e.title, e.opening_datetime)),
  );

  return candidates.filter((c) => !existingKeys.has(eventKey(c.title, c.openingDatetime)));
}

export interface CrawlVenueDeps {
  fetchPage?: PageFetcher;
  curate?: typeof curateVenuePage;
  messagesClient?: MessagesClient;
  imageFetcher?: ImageFetcher;
}

export async function crawlVenue(
  venue: Venue,
  deps: CrawlVenueDeps = {},
): Promise<{ inserted: number }> {
  const client = getSupabaseClient();
  const fetchPage = deps.fetchPage ?? defaultPageFetcher;
  const curate = deps.curate ?? curateVenuePage;
  const messagesClient = deps.messagesClient ?? (new Anthropic() as unknown as MessagesClient);
  const imageFetcher = deps.imageFetcher ?? defaultImageFetcher;

  const pageUrl = venue.listing_url ?? `https://${venue.source_domain}`;
  const html = await fetchPage.fetch(pageUrl);
  const contentHash = hashContent(html);

  // Unchanged since the last check — this is the actual cost lever: no
  // Haiku call at all, just note the check happened. See
  // docs/region-discovery.md#cost-governance.
  if (contentHash === venue.content_hash) {
    await updateVenueAfterCheck(venue, contentHash, 0);
    return { inserted: 0 };
  }

  const imageCandidates = extractImageCandidates(html, pageUrl);
  const { candidates, usage } = await curate(venue.name, html, imageCandidates, messagesClient, imageFetcher);

  for (const u of usage) {
    await recordUsage({ purpose: "event_crawl", model: MODEL, venueId: venue.id, usage: u });
  }

  // events.opening_datetime is NOT NULL — a candidate the model couldn't
  // pin to any date isn't a storable event yet (no Flow 1 date-inquiry
  // mechanism exists until Phase 1b). Dropped, not stored.
  //
  // Also drop anything whose opening date has already passed by scrape
  // time (docs/overview.md: "the calendar exists to capture the opening
  // night... never added" if already past) — checked in code, not left to
  // the model, same reasoning as the null-date filter above.
  const now = Date.now();
  const datedCandidates = candidates.filter((c) => {
    if (!c.openingDatetime || c.title.trim().length === 0) return false;
    const openingTime = new Date(c.openingDatetime).getTime();
    return !Number.isNaN(openingTime) && openingTime >= now;
  });
  const newCandidates = await filterNewEvents(venue.id, datedCandidates);

  if (newCandidates.length > 0) {
    const { error: insertError } = await client.from("events").insert(
      newCandidates.map((c) => ({
        venue_id: venue.id,
        title: c.title,
        description: c.description,
        artist: c.artist,
        opening_datetime: c.openingDatetime as string,
        opening_date_confidence: c.openingDateConfidence,
        medium_type: c.mediumType,
        sensitivity_tags: c.sensitivityTags,
        source: "scraped",
        source_url: pageUrl,
        image_url: c.imageUrl,
        curation_status: c.status,
        curation_reasoning: c.curationReasoning,
      })),
    );

    if (insertError) {
      throw new Error(`Failed to insert events for venue ${venue.id}: ${insertError.message}`);
    }
  }

  await updateVenueAfterCheck(venue, contentHash, newCandidates.length);

  return { inserted: newCandidates.length };
}

export async function run(): Promise<void> {
  const venues = await getVenuesDueForCheck();

  for (const venue of venues) {
    const { inserted } = await crawlVenue(venue);
    console.log(`[event-crawler] ${venue.name}: ${inserted} new event(s)`);
  }
}
