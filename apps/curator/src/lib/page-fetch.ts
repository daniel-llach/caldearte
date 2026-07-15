// Opportunistic image re-fetch: for an already-approved candidate whose
// sourceUrl we already have but whose imageUrl Tavily left null, fetch
// that one page and try a chain of strategies to find its image — not a
// new crawl, just using a URL we already collected. Instagram/Facebook
// are excluded entirely (any path) per the user's call: ToS risk, and
// those pages need JS/login to render for a plain fetch anyway, so a
// fetch there would just fail or scrape something misleading. Regex-only,
// matching this workspace's established convention (no HTML-parsing
// library — see event-discovery/extractors.ts's extractImgTags).

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

// Tried in order until one succeeds — still exactly ONE page fetch per
// candidate (only the parsing of that one already-fetched response is
// chained, not the fetching). og:image first since it's the most common/
// reliable; JSON-LD last since it needs the most parsing to trust.
const IMAGE_STRATEGIES: Array<(html: string) => string | null> = [extractOgImage, extractTwitterImage, extractJsonLdImage];

// Degrades to null on any failure (non-2xx, no strategy matches, bad URL,
// network error) — never throws, so a broken page never blocks the
// candidate it belongs to.
export async function fetchOgImage(url: string, fetchImpl: FetchLike = fetch): Promise<string | null> {
  if (isSocialMediaUrl(url)) return null;

  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;

    const html = await res.text();
    for (const strategy of IMAGE_STRATEGIES) {
      const content = strategy(html);
      if (!content) continue;
      try {
        return new URL(content, url).href;
      } catch {
        continue; // this strategy found something, but it wasn't a usable URL — try the next one
      }
    }
    return null;
  } catch (err) {
    console.error(`[page-fetch] image fetch failed for ${url}: ${(err as Error).message}`);
    return null;
  }
}

interface ImageCandidateLike {
  status: "approved" | "rejected";
  imageUrl: string | null;
  sourceUrl: string | null;
}

// Mutates approved, imageless candidates in place with a recovered image,
// when one is found — small and bounded (currently ~4 of 36 events fit
// this scope per run), so no allowlist/inference layer yet; basic logging
// here is the cost-visibility mechanism until real usage data says more is
// needed.
export async function enrichMissingImages<T extends ImageCandidateLike>(
  candidates: T[],
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  for (const c of candidates) {
    if (c.status !== "approved" || c.imageUrl !== null || !c.sourceUrl) continue;

    const image = await fetchOgImage(c.sourceUrl, fetchImpl);
    if (image) {
      console.log(`[page-fetch] recovered image from ${c.sourceUrl}`);
      c.imageUrl = image;
    }
  }
}
