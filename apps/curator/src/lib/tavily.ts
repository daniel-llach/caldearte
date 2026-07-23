// Thin client for Tavily's REST /search endpoint. Deliberately NOT the
// official @tavily/core SDK: confirmed via a real side-by-side test that
// the SDK (v0.7.6) silently drops per-result `images` even with
// includeImages/includeImageDescriptions set, while the REST API returns
// them — and per-result images are load-bearing for event image selection
// (docs/region-discovery.md).

export interface TavilyImage {
  url: string;
  description?: string | null;
}

export interface TavilyResult {
  url: string;
  title: string;
  content: string;
  score: number;
  images?: TavilyImage[];
}

export interface TavilyResponse {
  results: TavilyResult[];
  usage?: { credits: number };
}

export interface TavilySearchOptions {
  startDate: string; // YYYY-MM-DD, first day of the target month
  excludeDomains: string[];
}

// Injectable fetch so tests can stub the HTTP layer.
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;

export async function tavilySearch(
  apiKey: string,
  query: string,
  opts: TavilySearchOptions,
  fetchImpl: FetchLike = fetch,
): Promise<TavilyResponse> {
  const res = await fetchImpl("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      query,
      // "basic" was tested manually and returned noticeably worse results;
      // country scoping costs 2 credits instead of 1 but eliminates
      // wrong-country noise (confirmed with real data — see
      // docs/region-discovery.md). max_results: 20 is Tavily's fixed API
      // ceiling regardless of plan.
      search_depth: "advanced",
      max_results: 20,
      start_date: opts.startDate,
      // 1 -> 2 (2026-07-23): a real production run truncated a long
      // Instagram caption before it reached the sentence that would've
      // triggered rejectConvocatorias (discover.ts) — chunks_per_source
      // doesn't change Tavily's credit cost (confirmed against Tavily's
      // own docs: cost is determined solely by search_depth), only the
      // amount of content per source, so this is free to try. The
      // tradeoff is more input tokens sent to Haiku per unit — measure
      // the real delta on the next run rather than guessing further.
      chunks_per_source: 2,
      country: "chile",
      exclude_domains: opts.excludeDomains,
      include_images: true,
      include_image_descriptions: true,
    }),
  });

  if (!res.ok) {
    throw new Error(`Tavily search failed for "${query}": ${res.status} ${await res.text()}`);
  }

  return (await res.json()) as TavilyResponse;
}
