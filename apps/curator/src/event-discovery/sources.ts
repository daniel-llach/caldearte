// "Fuentes brillantes" (bright sources): URLs that reliably list several
// real events in one place — fetched directly (plain fetch, not via Tavily
// search) once per run, curated in their own dedicated Haiku call (NOT
// attached to each unit's prompt — real runs showed Haiku inconsistently
// deciding whether to surface that content when attached per-unit), and
// excluded from regular Tavily searches via exclude_domains.
//
// Two lists, merged (deduped by domain, hand-curated list wins) at the
// start of every run: the hand-curated seed in lib/known-sources.ts, plus
// rows auto-detected into the detected_sources table (a table, not a local
// JSON file — GitHub Actions runners are ephemeral, nothing on disk
// survives between monthly runs).
//
// fetchHtmlSource/fetchJsonApiSource are thin dispatchers: `type` decides
// HOW to fetch (plain HTML page vs a REST call), `extractor` (when present
// — extractors.ts's config-driven registry) decides HOW to pull per-event
// structure out of what got fetched. A source with no `extractor` (every
// auto-detected one today — the detected_sources table only stores a
// simple `source_type` enum, not a full parser config) safely falls back
// to a generic whole-page flatten for html sources, or a clear
// log-and-skip for a json-api source nobody's configured yet — better than
// silently reusing another site's field names against it.
import { KNOWN_SOURCES, knownSourceDomain } from "../lib/known-sources.js";
import { type EventCandidate, type ImageCandidate, type RawResult } from "./discover.js";
import {
  extractArticleList,
  extractImgTags,
  extractWordpressItems,
  filterKnownSourceImages,
  collapseWhitespace,
  type BrightSourceItem,
  type ExtractorConfig,
} from "./extractors.js";

export interface BrightSource {
  url: string;
  note: string;
  type?: "html" | "json-api";
  extractor?: ExtractorConfig;
  // Extra URLs whose content gets fetched (same extractor) and appended to
  // this source's single result — e.g. arteinformado.com's listing is
  // paginated, and page 1 alone missed a real event ("Sín-tesis", found
  // 2026-07-17) that only showed up on page 2. Kept small deliberately: a
  // few pages costs a bit more Haiku input per fetch, but fetching this
  // source's ~423 pages every run would be both expensive and mostly
  // wasted — the site's own sort order isn't chronological, so later pages
  // increasingly return events that have already ended (real check:
  // page 5 already had events that ended ~2 months before today).
  additionalPages?: string[];
  // Present only for a confirmed single fixed-venue source — see
  // lib/known-sources.ts's KnownSource.fixedLocation doc comment. Kept in
  // sync with that field so run.ts's curateBrightSourceItems call can read
  // it directly off whatever merged source produced a given fetch result.
  fixedLocation?: { location: string; placeName: string };
}

// A source with a real extractor config yields structured BrightSourceItems
// (title/sourceUrl/imageUrl/dates never touch Haiku, see discover.ts's
// curateBrightSourceItems) — a source with none (every auto-detected one
// today; detected_sources only stores a simple source_type enum, not a
// full parser config) falls back to the old whole-page-flatten RawResult,
// which still goes through the original curate()/isBrightSource path in
// run.ts unchanged.
export type BrightSourceFetchResult =
  | { kind: "items"; source: BrightSource; items: BrightSourceItem[] }
  | { kind: "rawResult"; source: BrightSource; result: RawResult };

async function fetchHtmlPage(pageUrl: string, extractor: ExtractorConfig | undefined): Promise<BrightSourceItem[] | null> {
  const res = await fetch(pageUrl);
  if (!res.ok) {
    throw new Error(`html source ${pageUrl} responded ${res.status}`);
  }
  const html = await res.text();
  if (extractor?.kind !== "articleList") return null;
  return extractArticleList(html, pageUrl, extractor);
}

async function fetchHtmlPageFallback(pageUrl: string): Promise<{ content: string; images: ImageCandidate[] }> {
  const res = await fetch(pageUrl);
  if (!res.ok) {
    throw new Error(`html source ${pageUrl} responded ${res.status}`);
  }
  const html = await res.text();
  // Whole-page flatten for sources with no configured extractor (or one
  // that didn't match this page's actual markup) — script/style CONTENTS
  // stripped first, not just the tags, so JS/CSS source doesn't leak into
  // the text Haiku reads.
  const images = filterKnownSourceImages(extractImgTags(html), pageUrl);
  const text = collapseWhitespace(html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "")).slice(0, 4000);
  return { content: text, images };
}

async function fetchHtmlSource(source: BrightSource): Promise<BrightSourceFetchResult> {
  const primaryItems = await fetchHtmlPage(source.url, source.extractor);

  if (primaryItems === null) {
    // No matching extractor — old fallback path, unchanged shape (RawResult).
    const primary = await fetchHtmlPageFallback(source.url);
    let content = primary.content;
    let images = primary.images;
    for (const pageUrl of source.additionalPages ?? []) {
      try {
        const page = await fetchHtmlPageFallback(pageUrl);
        content += "\n" + page.content;
        images = images.concat(page.images);
      } catch (err) {
        console.error(`[event-discovery] additional page failed for ${source.url}: ${pageUrl}: ${(err as Error).message}`);
      }
    }
    return { kind: "rawResult", source, result: { title: source.note, url: source.url, content, score: 1, images } };
  }

  let items = primaryItems;
  for (const pageUrl of source.additionalPages ?? []) {
    try {
      const page = await fetchHtmlPage(pageUrl, source.extractor);
      if (page) items = items.concat(page);
    } catch (err) {
      // Losing one extra page shouldn't drop the whole source's primary
      // page too — only the primary page's own failure propagates (kept
      // as a throw, unchanged from before additionalPages existed).
      console.error(`[event-discovery] additional page failed for ${source.url}: ${pageUrl}: ${(err as Error).message}`);
    }
  }
  return { kind: "items", source, items };
}

async function fetchJsonApiSource(source: BrightSource): Promise<BrightSourceFetchResult> {
  const res = await fetch(source.url);
  if (!res.ok) {
    throw new Error(`json-api source ${source.url} responded ${res.status}`);
  }
  const items = (await res.json()) as unknown[];

  if (source.extractor?.kind !== "wordpressRestApi") {
    throw new Error(`json-api source ${source.url} has no wordpressRestApi extractor configured`);
  }

  return { kind: "items", source, items: extractWordpressItems(items, source.extractor, source.url) };
}

// Merge hand-curated + detected, deduped by domain (hand-curated wins —
// guards against a domain being both hand-added and previously
// auto-detected, which would otherwise fetch it twice).
export function mergeBrightSources(detected: BrightSource[]): BrightSource[] {
  const seen = new Set<string>();
  const merged: BrightSource[] = [];
  for (const source of [...KNOWN_SOURCES, ...detected]) {
    const domain = knownSourceDomain(source.url);
    if (seen.has(domain)) continue;
    seen.add(domain);
    merged.push(source);
  }
  return merged;
}

// Real production bug, found 2026-07-24: `KnownSource` (known-sources.ts)
// has never set `type` at all — it was dropped when extraction moved to
// the config-driven `extractor.kind` registry, but this dispatch check
// was never updated to match, so parquecultural.cl (the one
// wordpressRestApi source) has ALWAYS been routed to `fetchHtmlSource`
// instead of `fetchJsonApiSource` in production. `fetchHtmlPage` bails
// immediately for a non-`articleList` extractor, so every real run fell
// through to the whole-page-flatten fallback — raw JSON text truncated
// and treated as HTML — meaning `extractWordpressItems`'s structured
// dates/sourceUrl/etc. (and this whole file's `curateBrightSourceItems`
// deterministic path) were NEVER actually exercised for parquecultural.cl
// despite being built and tested. `source.type` still wins first for
// auto-detected sources (`detected_sources.source_type`, the one place a
// real `type` value can still come from) — but `extractor.kind` is the
// authoritative signal for hand-curated sources now.
export async function fetchBrightSources(sources: BrightSource[]): Promise<BrightSourceFetchResult[]> {
  const out: BrightSourceFetchResult[] = [];
  for (const source of sources) {
    try {
      const isJsonApi = source.type === "json-api" || source.extractor?.kind === "wordpressRestApi";
      out.push(isJsonApi ? await fetchJsonApiSource(source) : await fetchHtmlSource(source));
    } catch (err) {
      // One broken source shouldn't kill the whole monthly run — log and
      // keep going; the periodic manual review (lastReviewedAt) is the
      // mechanism for pruning dead ones.
      console.error(`[event-discovery] bright source failed: ${source.url}: ${(err as Error).message}`);
    }
  }
  return out;
}

// --- Auto-detection of new bright sources --------------------------------

// Simple rule (user's call): a domain — never a social platform, those are
// shared by thousands of unrelated accounts — that contributed 2+ COMPLETE
// events in one run (image + title + a start date within the current
// month; description deliberately NOT required — a real test against
// arteinformado.com showed rich sources legitimately lack per-event prose)
// is assumed a bright source by default and persisted for the next run.
const SOCIAL_DOMAINS = ["instagram.com", "facebook.com", "tiktok.com", "twitter.com", "x.com"];
const DETECTION_THRESHOLD = 2;

export function isCompleteEvent(c: EventCandidate, now: Date): boolean {
  if (!c.imageUrl || !c.title) return false;
  const dateToCheck = c.runStartDate ?? c.openingDatetime;
  if (!dateToCheck) return false;
  const d = new Date(dateToCheck);
  if (Number.isNaN(d.getTime())) return false;
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

export interface DetectedSource {
  url: string;
  note: string;
}

export function detectNewBrightSources(
  candidates: EventCandidate[],
  now: Date,
  existingDomains: string[],
): DetectedSource[] {
  const byDomain = new Map<string, Set<string>>();

  for (const c of candidates) {
    if (c.status !== "approved" || !c.sourceUrl || !isCompleteEvent(c, now)) continue;
    let domain: string;
    try {
      // Real production bug (2026-07-17): this used to strip "www." here
      // but knownSourceDomain() (used to build `existingDomains` in
      // run.ts) doesn't — "www.arteinformado.com" in existingDomains
      // never matched this function's own "arteinformado.com", so an
      // ALREADY-known source kept getting flagged "new" every run,
      // eventually hitting detected_sources' unique constraint on url
      // and crashing the whole run. Reusing the same function both sides
      // makes the two domain computations consistent by construction.
      domain = knownSourceDomain(c.sourceUrl);
    } catch {
      continue;
    }
    if (SOCIAL_DOMAINS.some((s) => domain.includes(s))) continue;
    if (existingDomains.includes(domain)) continue;
    if (!byDomain.has(domain)) byDomain.set(domain, new Set());
    byDomain.get(domain)!.add(c.sourceUrl);
  }

  return [...byDomain.entries()]
    .filter(([, urls]) => urls.size >= DETECTION_THRESHOLD)
    .map(([domain, urls]) => ({
      url: [...urls][0],
      note: `Auto-detectado: ${urls.size} eventos completos (imagen+título+fecha del mes) en ${domain} el ${now.toISOString().slice(0, 10)}.`,
    }))
    .sort((a, b) => a.url.localeCompare(b.url));
}
