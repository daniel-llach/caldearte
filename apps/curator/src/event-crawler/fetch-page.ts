export interface PageFetcher {
  fetch(url: string): Promise<string>;
}

// Thin wrapper so `crawlVenue` can inject a stub in tests without hitting
// the network, same pattern as `MessagesClient` in event-discovery/discover.ts.
export const defaultPageFetcher: PageFetcher = {
  async fetch(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: { "User-Agent": "Caldearte Event Crawler (+https://caldearte.com)" },
    });

    if (!response.ok) {
      throw new Error(`fetchPage: ${url} responded ${response.status}`);
    }

    return response.text();
  },
};
