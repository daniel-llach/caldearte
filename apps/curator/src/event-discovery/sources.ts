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
import { type EventCandidate, type RawResult } from "./discover.js";
import {
  extractArticleList,
  extractImgTags,
  extractWordpressItems,
  filterKnownSourceImages,
  collapseWhitespace,
  type ExtractorConfig,
} from "./extractors.js";

export interface BrightSource {
  url: string;
  note: string;
  type?: "html" | "json-api";
  extractor?: ExtractorConfig;
}

async function fetchHtmlSource(source: BrightSource): Promise<RawResult> {
  const res = await fetch(source.url);
  if (!res.ok) {
    throw new Error(`html source ${source.url} responded ${res.status}`);
  }
  const html = await res.text();

  if (source.extractor?.kind === "articleList") {
    const structured = extractArticleList(html, source.url, source.extractor);
    if (structured) {
      return { title: source.note, url: source.url, content: structured.content, score: 1, images: structured.images };
    }
  }

  // Fallback: no configured extractor, or the configured one didn't match
  // this page's actual markup — whole-page flatten, as before (script/
  // style CONTENTS stripped first, not just the tags, so JS/CSS source
  // doesn't leak into the text Haiku reads).
  const images = filterKnownSourceImages(extractImgTags(html), source.url);
  const text = collapseWhitespace(html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "")).slice(0, 4000);
  return { title: source.note, url: source.url, content: text, score: 1, images };
}

async function fetchJsonApiSource(source: BrightSource): Promise<RawResult> {
  const res = await fetch(source.url);
  if (!res.ok) {
    throw new Error(`json-api source ${source.url} responded ${res.status}`);
  }
  const items = (await res.json()) as unknown[];

  if (source.extractor?.kind !== "wordpressRestApi") {
    throw new Error(`json-api source ${source.url} has no wordpressRestApi extractor configured`);
  }

  const { content, images } = extractWordpressItems(items, source.extractor, source.url);
  return { title: source.note, url: source.url, content, score: 1, images };
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

export async function fetchBrightSources(sources: BrightSource[]): Promise<RawResult[]> {
  const out: RawResult[] = [];
  for (const source of sources) {
    try {
      out.push(source.type === "json-api" ? await fetchJsonApiSource(source) : await fetchHtmlSource(source));
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
      domain = new URL(c.sourceUrl).hostname.replace(/^www\./, "");
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
