// Opportunistic og:image re-fetch: for an already-approved candidate whose
// sourceUrl we already have but whose imageUrl Tavily left null, fetch that
// one page and pull its <meta property="og:image"> — not a new crawl, just
// using a URL we already collected. Instagram/Facebook are excluded
// entirely (any path) per the user's call: ToS risk, and those pages need
// JS/login to render for a plain fetch anyway, so a fetch there would just
// fail or scrape something misleading. Regex-only, matching this
// workspace's established convention (no HTML-parsing library — see
// event-discovery/sources.ts's extractImgTags).

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

// property/content order varies in the wild — match both.
const OG_IMAGE_REGEX = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i;
const OG_IMAGE_REGEX_REVERSED = /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i;

// Degrades to null on any failure (non-2xx, no tag, bad URL, network error)
// — never throws, so a broken page never blocks the candidate it belongs to.
export async function fetchOgImage(url: string, fetchImpl: FetchLike = fetch): Promise<string | null> {
  if (isSocialMediaUrl(url)) return null;

  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;

    const html = await res.text();
    const match = html.match(OG_IMAGE_REGEX) ?? html.match(OG_IMAGE_REGEX_REVERSED);
    const content = match?.[1]?.trim();
    if (!content) return null;

    return new URL(content, url).href;
  } catch (err) {
    console.error(`[page-fetch] og:image fetch failed for ${url}: ${(err as Error).message}`);
    return null;
  }
}

interface ImageCandidateLike {
  status: "approved" | "rejected";
  imageUrl: string | null;
  sourceUrl: string | null;
}

// Mutates approved, imageless candidates in place with a recovered
// og:image, when one is found — small and bounded (currently ~4 of 36
// events fit this scope per run), so no allowlist/inference layer yet;
// basic logging here is the cost-visibility mechanism until real usage data
// says more is needed.
export async function enrichMissingImages<T extends ImageCandidateLike>(
  candidates: T[],
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  for (const c of candidates) {
    if (c.status !== "approved" || c.imageUrl !== null || !c.sourceUrl) continue;

    const image = await fetchOgImage(c.sourceUrl, fetchImpl);
    if (image) {
      console.log(`[page-fetch] recovered og:image from ${c.sourceUrl}`);
      c.imageUrl = image;
    }
  }
}
