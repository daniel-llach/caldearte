// MAVI UC's own exhibition listing (mavi.uc.cl/exposiciones-actuales/) is a
// client-rendered Next.js app whose data comes from a Strapi API
// (api.agenda.uc.cl) that returns 403 Forbidden to a plain fetch()
// (confirmed via curl, with and without browser-like headers) — the only
// way to read it is from inside a real browser session. Rather than
// scraping the rendered DOM, this intercepts the actual JSON response the
// page itself receives: richer and far more robust than regex over
// rendered HTML, and confirmed (2026-07-20, real probe against the live
// API) to already include everything needed — title, a full prose
// description with real exhibition dates, a direct S3 image URL, and the
// slug to build a real per-event uc.cl/agenda/actividad/<slug> URL.
//
// The API's own `dates`/`datesBuilder`/`nextDate` fields are the museum's
// regular VISITING HOURS (open Tue-Sun, same shape every week), never an
// inauguración — this is exactly what got misread as an opening-night
// time in production before (see docs/region-discovery.md's 2026-07-20
// manual-review section). Deliberately not surfaced here at all; real
// exhibition dates live in the prose `content` field instead, same as any
// other source Haiku already curates correctly.
import { chromium } from "playwright";

const MAVI_LISTING_URL = "https://mavi.uc.cl/exposiciones-actuales/";
const MAVI_API_URL_FRAGMENT = "api.agenda.uc.cl/api/activities";

interface StrapiActivity {
  title: string;
  slug: string;
  content: string;
  mainImage?: { url: string } | null;
  place?: { name: string } | null;
}

interface StrapiActivitiesResponse {
  data: StrapiActivity[];
}

export interface MaviActivity {
  title: string;
  content: string;
  detailUrl: string;
  imageUrl: string | null;
  placeName: string | null;
}

// Pure and separately exported so it's unit-testable against a captured
// real response shape without launching a browser.
export function parseMaviActivities(json: StrapiActivitiesResponse): MaviActivity[] {
  return json.data.map((item) => ({
    title: item.title,
    content: item.content,
    detailUrl: `https://www.uc.cl/agenda/actividad/${item.slug}`,
    imageUrl: item.mainImage?.url ?? null,
    placeName: item.place?.name ?? null,
  }));
}

// Never throws — a broken/changed API shape or a Playwright launch failure
// must not take down the whole headless-discovery run, same defensive
// posture as event-discovery/sources.ts's fetchBrightSources.
export async function fetchMaviActivities(): Promise<MaviActivity[]> {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    const responsePromise = page.waitForResponse((res) => res.url().includes(MAVI_API_URL_FRAGMENT), {
      timeout: 30000,
    });
    await page.goto(MAVI_LISTING_URL, { waitUntil: "networkidle", timeout: 30000 });
    const response = await responsePromise;
    const json = (await response.json()) as StrapiActivitiesResponse;
    return parseMaviActivities(json);
  } catch (err) {
    console.error(`[headless-discovery] failed to fetch MAVI activities: ${(err as Error).message}`);
    return [];
  } finally {
    await browser?.close();
  }
}
