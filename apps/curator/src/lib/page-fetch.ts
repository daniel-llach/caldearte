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
import { findOpeningTimeConfig } from "./known-sources.js";
import { extractOpeningDatetime } from "./opening-time.js";

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

// property/content order varies in the wild — match both.
const OG_IMAGE_REGEX = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i;
const OG_IMAGE_REGEX_REVERSED = /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i;

export function extractOgImage(html: string): string | null {
  const match = html.match(OG_IMAGE_REGEX) ?? html.match(OG_IMAGE_REGEX_REVERSED);
  return match?.[1]?.trim() || null;
}

const TWITTER_IMAGE_REGEX = /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/i;
const TWITTER_IMAGE_REGEX_REVERSED = /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["'][^>]*>/i;

export function extractTwitterImage(html: string): string | null {
  const match = html.match(TWITTER_IMAGE_REGEX) ?? html.match(TWITTER_IMAGE_REGEX_REVERSED);
  return match?.[1]?.trim() || null;
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
}

// Deliberately conservative: unknown per-request latency to arbitrary
// third-party sites, politeness toward those sites, and headroom under the
// 346-comuna weekly batch's documented 6-hour GitHub Actions ceiling
// (docs/region-discovery.md). Revisit once real timing data exists — same
// posture as this file's other tunables.
const ENRICHMENT_CONCURRENCY = 4;

async function processCandidate<T extends EnrichCandidateLike>(c: T, fetchImpl: FetchLike): Promise<void> {
  try {
    const needsImage = c.imageUrl === null;
    const openingConfig = c.openingDatetime === null && c.sourceUrl ? findOpeningTimeConfig(c.sourceUrl) : null;
    if (!needsImage && !openingConfig) return;

    const html = await fetchDetailHtml(c.sourceUrl!, fetchImpl);
    if (!html) return;

    if (needsImage) {
      const image = resolveImageFromHtml(html, c.sourceUrl!);
      if (image) {
        console.log(`[page-fetch] recovered image from ${c.sourceUrl}`);
        c.imageUrl = image;
      }
    }
    if (openingConfig) {
      const opening = extractOpeningDatetime(html, openingConfig);
      if (opening) {
        console.log(
          `[page-fetch] recovered opening ${opening.timeConfirmed ? "date+time" : "date (no time confirmed)"} from ${c.sourceUrl}`,
        );
        c.openingDatetime = opening.iso;
        c.openingTimeConfirmed = opening.timeConfirmed;
      }
    }
  } catch (err) {
    console.error(`[page-fetch] enrichment failed for ${c.sourceUrl}: ${(err as Error).message}`);
  }
}

// Mutates eligible candidates in place — one fetch per candidate covers
// BOTH image and opening-time recovery (never fetches the same sourceUrl
// twice for the same candidate). Small and bounded (a handful of events
// per run fit this scope), fetched in chunks of ENRICHMENT_CONCURRENCY
// rather than fully sequential or fully unbounded.
export async function enrichCandidates<T extends EnrichCandidateLike>(
  candidates: T[],
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const eligible = candidates.filter(
    (c) =>
      c.status === "approved" &&
      c.sourceUrl &&
      (c.imageUrl === null || (c.openingDatetime === null && findOpeningTimeConfig(c.sourceUrl) !== null)),
  );
  for (let i = 0; i < eligible.length; i += ENRICHMENT_CONCURRENCY) {
    const batch = eligible.slice(i, i + ENRICHMENT_CONCURRENCY);
    await Promise.all(batch.map((c) => processCandidate(c, fetchImpl)));
  }
}
