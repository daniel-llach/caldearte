// Opportunistic detail-page enrichment: for an already-approved candidate
// whose sourceUrl we already have, fetch that one page (ONCE — see
// enrichCandidates below) and try to recover whatever's still missing:
// an image (Tavily left it null) and/or a specific opening date+time (the
// candidate's source only gave a date range — see known-sources.ts's
// openingTimeExtractor). Not a new crawl, just using a URL we already
// collected. Regex-only, matching this workspace's established convention
// (no HTML-parsing library — see event-discovery/extractors.ts's
// extractImgTags).
//
// Instagram/Facebook individual post/reel permalinks ARE fetched here too
// (as of 2026-07-20) — previously assumed to need JS/login to render, but
// verified against 9 real production samples (6 Instagram, 3 Facebook):
// a plain fetch, no special headers, no crawler-impersonating user-agent,
// reliably returns a working og:image for these single-post pages (unlike
// profile/feed pages, which do show a login wall). Same ToS-gray-zone
// caveat as any scrape of a third-party site with no official API — could
// stop working without notice if Meta changes markup or tightens
// detection; isSocialMediaUrl stays exported for image-rehost.ts, which
// still needs to know when a recovered image is one of these signed,
// short-lived CDN links that must be re-hosted before it rots.
import { findDescriptionConfig, findLocationConfig, findOpeningTimeConfig } from "./known-sources.js";
import { extractDescription } from "./description-extract.js";
import { extractComunaName, type RegionLike } from "./locations.js";
import {
  extractGenericInauguracionHour,
  extractOpeningDatetime,
  santiagoWallTimeToUtcIso,
  utcIsoToSantiagoDateParts,
} from "./opening-time.js";
import { extractPublishedDate, isStalePublishYear } from "./post-freshness.js";

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const SOCIAL_DOMAINS = ["instagram.com", "facebook.com"];

export function isSocialMediaUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return SOCIAL_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`));
  } catch {
    return true; // unparseable — never fetch it
  }
}

// --- Image-recovery strategies, tried in order until one matches --------
// Each takes the already-fetched HTML and returns a (possibly relative)
// image URL string, or null. Resolving against the page URL and picking
// the winner happens once, in fetchOgImage below — these stay pure and
// individually testable.

// Real production bug, found 2026-07-22 running Event Discovery for real:
// meta-tag `content` attributes are raw HTML, so a URL's query string
// separators come through as the literal entity `&amp;`, not `&` — e.g.
// Instagram's own CDN URLs (always query-string-heavy, carrying the
// signature params `oh`/`oe` the CDN needs to authorize the request) came
// through as "...&amp;oh=...&amp;oe=..." verbatim. Only 2 of 29 approved
// candidates in that run got an image; fetching the corrupted URL directly
// (not through this codebase, a raw curl) confirmed the exact failure —
// 403 with the literal "&amp;" left in, 200 with a real JPEG once decoded
// back to "&". Not a bot-blocking issue at all, despite looking like one.
// Only the handful of entities that can plausibly appear inside a URL are
// covered — this is not a general-purpose HTML entity decoder.
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// property/content order varies in the wild — match both.
const OG_IMAGE_REGEX = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i;
const OG_IMAGE_REGEX_REVERSED = /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i;

export function extractOgImage(html: string): string | null {
  const match = html.match(OG_IMAGE_REGEX) ?? html.match(OG_IMAGE_REGEX_REVERSED);
  const content = match?.[1]?.trim();
  return content ? decodeHtmlEntities(content) : null;
}

const TWITTER_IMAGE_REGEX = /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/i;
const TWITTER_IMAGE_REGEX_REVERSED = /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["'][^>]*>/i;

export function extractTwitterImage(html: string): string | null {
  const match = html.match(TWITTER_IMAGE_REGEX) ?? html.match(TWITTER_IMAGE_REGEX_REVERSED);
  const content = match?.[1]?.trim();
  return content ? decodeHtmlEntities(content) : null;
}

// A page's own structured data (schema.org Article/Event/etc.) sometimes
// carries an "image" field even when it has no og:image/twitter:image meta
// tags at all — a third, independent place to look before giving up.
const JSON_LD_REGEX = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

export function extractJsonLdImage(html: string): string | null {
  for (const match of html.matchAll(JSON_LD_REGEX)) {
    let data: unknown;
    try {
      data = JSON.parse(match[1]);
    } catch {
      continue; // malformed JSON-LD on the page — skip, try the next block
    }
    for (const node of Array.isArray(data) ? data : [data]) {
      const image = (node as { image?: unknown } | null)?.image;
      if (typeof image === "string" && image) return image;
      if (Array.isArray(image) && typeof image[0] === "string") return image[0];
      if (image && typeof image === "object" && typeof (image as { url?: unknown }).url === "string") {
        return (image as { url: string }).url;
      }
    }
  }
  return null;
}

// Tried in order until one succeeds — og:image first since it's the most
// common/reliable; JSON-LD last since it needs the most parsing to trust.
const IMAGE_STRATEGIES: Array<(html: string) => string | null> = [extractOgImage, extractTwitterImage, extractJsonLdImage];

// Pure — runs the strategy chain against already-fetched HTML and resolves
// the winner against the page's own URL (relative URLs are common).
function resolveImageFromHtml(html: string, pageUrl: string): string | null {
  for (const strategy of IMAGE_STRATEGIES) {
    const content = strategy(html);
    if (!content) continue;
    try {
      return new URL(content, pageUrl).href;
    } catch {
      continue; // this strategy found something, but it wasn't a usable URL — try the next one
    }
  }
  return null;
}

// The one network call this module makes. Degrades to null on any failure
// (social URL, non-2xx, network error) — never throws, so a broken page
// never blocks the candidate it belongs to.
async function fetchDetailHtml(url: string, fetchImpl: FetchLike): Promise<string | null> {
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    return await res.text();
  } catch (err) {
    console.error(`[page-fetch] detail fetch failed for ${url}: ${(err as Error).message}`);
    return null;
  }
}

// Kept as a thin wrapper — directly exported/tested elsewhere, and useful
// on its own when only the image is wanted.
export async function fetchOgImage(url: string, fetchImpl: FetchLike = fetch): Promise<string | null> {
  const html = await fetchDetailHtml(url, fetchImpl);
  return html ? resolveImageFromHtml(html, url) : null;
}

interface EnrichCandidateLike {
  status: "approved" | "rejected";
  imageUrl: string | null;
  sourceUrl: string | null;
  openingDatetime: string | null;
  openingTimeConfirmed: boolean;
  description: string | null;
  location: string;
}

// Deliberately conservative: unknown per-request latency to arbitrary
// third-party sites, politeness toward those sites, and headroom under the
// 346-comuna weekly batch's documented 6-hour GitHub Actions ceiling
// (docs/region-discovery.md). Revisit once real timing data exists — same
// posture as this file's other tunables.
const ENRICHMENT_CONCURRENCY = 4;

async function processCandidate<T extends EnrichCandidateLike>(
  c: T,
  fetchImpl: FetchLike,
  referenceDate: Date,
  regions: RegionLike[],
): Promise<void> {
  try {
    const html = await fetchDetailHtml(c.sourceUrl!, fetchImpl);
    if (!html) return;

    if (c.imageUrl === null) {
      const image = resolveImageFromHtml(html, c.sourceUrl!);
      if (image) {
        console.log(`[page-fetch] recovered image from ${c.sourceUrl}`);
        c.imageUrl = image;
      }
    }

    // `!c.openingTimeConfirmed` (not `c.openingDatetime === null`) covers
    // both cases this re-fetch can help with: no confirmed inauguración at
    // all (openingDatetime null, openingTimeConfirmed false together — see
    // buildSystemPrompt), and — since PR #94 — a confirmed date with an
    // unconfirmed hour (openingDatetime now non-null, a real date + "00:00"
    // placeholder, openingTimeConfirmed false). Real regression found
    // 2026-07-21: PR #94 changed Haiku's own output so the date-only case no
    // longer sets openingDatetime to null, which silently disabled this
    // re-fetch for known sources (arteinformado.com, uchile.cl) in exactly
    // the case it exists for.
    const openingConfig = !c.openingTimeConfirmed && c.sourceUrl ? findOpeningTimeConfig(c.sourceUrl) : null;
    if (openingConfig) {
      const opening = extractOpeningDatetime(html, openingConfig);
      if (opening) {
        console.log(
          `[page-fetch] recovered opening ${opening.timeConfirmed ? "date+time" : "date (no time confirmed)"} from ${c.sourceUrl}`,
        );
        c.openingDatetime = opening.iso;
        c.openingTimeConfirmed = opening.timeConfirmed;
      }
    } else if (!c.openingTimeConfirmed && c.openingDatetime) {
      // Generic hour recovery — no known-source config for this domain, but
      // Haiku already confirmed the DATE itself (openingDatetime is set),
      // just not the hour. Cross-checks the generic match's day/month
      // against the date Haiku already confirmed before trusting it — a
      // page can mention other dates/times unrelated to this inauguración
      // (a venue's regular opening hours, another listed event), so a bare
      // "found a time somewhere" match on its own isn't enough (see
      // extractGenericInauguracionHour's own doc comment).
      const confirmed = utcIsoToSantiagoDateParts(c.openingDatetime);
      const generic = extractGenericInauguracionHour(html);
      if (confirmed && generic && generic.day === confirmed.day && generic.month0 === confirmed.month0) {
        console.log(`[page-fetch] recovered generic hour from ${c.sourceUrl} (day/month cross-checked against Haiku's confirmed date)`);
        c.openingDatetime = santiagoWallTimeToUtcIso(confirmed.year, confirmed.month0, confirmed.day, generic.hour, generic.minute);
        c.openingTimeConfirmed = true;
      }
    }

    // Description recovery (2026-07-24) — most bright-source LISTING pages
    // never carry event prose at all (only title/dates/place); the real
    // description, when there is one, lives on the event's own detail
    // page, same page already being fetched here for image/opening-time
    // recovery (see known-sources.ts's descriptionExtractor doc comment).
    if (c.description === null && c.sourceUrl) {
      const descriptionConfig = findDescriptionConfig(c.sourceUrl);
      if (descriptionConfig) {
        const description = extractDescription(html, descriptionConfig);
        if (description) {
          console.log(`[page-fetch] recovered description from ${c.sourceUrl}`);
          c.description = description;
        }
      }
    }

    // Location recovery (2026-07-24) — a real aggregator (arteinformado.com,
    // uchile.cl, artes.uchile.cl) has events spread across many different
    // comunas, so unlike a fixedLocation source there's no single constant
    // to attach — but the comuna doesn't need Haiku to infer it from venue
    // knowledge either: the event's own detail page already states its
    // real address (sometimes as clean structured JSON-LD, e.g.
    // arteinformado.com's "addressLocality"), always ending in a real,
    // matchable comuna name. Always overrides whatever curateBrightSourceItems
    // put in `location` when a locationExtractor is configured for this
    // domain — Haiku's own location guess for these sources was always
    // just a fallback for a source with no working extractor yet, never
    // meant to be trusted over the source's own stated address once one
    // exists.
    if (c.sourceUrl) {
      const locationConfig = findLocationConfig(c.sourceUrl);
      if (locationConfig) {
        const addressText = extractDescription(html, locationConfig);
        const comuna = extractComunaName(addressText, regions);
        if (comuna) {
          console.log(`[page-fetch] recovered comuna "${comuna}" from ${c.sourceUrl}`);
          c.location = comuna;
        }
      }
    }

    // Deterministic freshness backstop (see post-freshness.ts) — runs for
    // every approved candidate, independent of whether image/opening-time
    // enrichment was needed, since a stale post can arrive with a
    // Haiku-confirmed image AND hour just as easily as with neither.
    const publishedDate = extractPublishedDate(html);
    if (publishedDate && isStalePublishYear(publishedDate, referenceDate)) {
      console.log(
        `[page-fetch] rejected ${c.sourceUrl}: real publish date ${publishedDate.toISOString().slice(0, 10)} doesn't match the curated year`,
      );
      c.status = "rejected";
    }
  } catch (err) {
    console.error(`[page-fetch] enrichment failed for ${c.sourceUrl}: ${(err as Error).message}`);
  }
}

// Mutates eligible candidates in place — one fetch per candidate covers
// image recovery, opening-time recovery, AND the freshness backstop
// (never fetches the same sourceUrl twice for the same candidate). Every
// approved candidate with a sourceUrl is now eligible (not just ones
// missing an image/hour) since the freshness check applies universally —
// small and bounded (a handful of approved events per run fit this
// scope), fetched in chunks of ENRICHMENT_CONCURRENCY rather than fully
// sequential or fully unbounded.
export async function enrichCandidates<T extends EnrichCandidateLike>(
  candidates: T[],
  fetchImpl: FetchLike = fetch,
  referenceDate: Date = new Date(),
  regions: RegionLike[] = [],
): Promise<void> {
  const eligible = candidates.filter((c) => c.status === "approved" && c.sourceUrl);
  for (let i = 0; i < eligible.length; i += ENRICHMENT_CONCURRENCY) {
    const batch = eligible.slice(i, i + ENRICHMENT_CONCURRENCY);
    await Promise.all(batch.map((c) => processCandidate(c, fetchImpl, referenceDate, regions)));
  }
}
