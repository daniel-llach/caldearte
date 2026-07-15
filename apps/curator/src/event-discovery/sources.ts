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
import { KNOWN_SOURCES, knownSourceDomain, type KnownSource } from "../lib/known-sources.js";
import {
  filterImageCandidates,
  isJunkImage,
  type EventCandidate,
  type ImageCandidate,
  type RawResult,
} from "./discover.js";

// --- HTML sources -----------------------------------------------------

// Pull <img src/alt> pairs out BEFORE stripping tags — the original crude
// tag-strip threw away real per-exhibition thumbnails sitting right in the
// HTML (a real bug, found against artes.uchile.cl's agenda).
export function extractImgTags(html: string): Array<{ url: string; description: string | null }> {
  const images: Array<{ url: string; description: string | null }> = [];
  const imgTagRegex = /<img\b[^>]*>/gi;
  const srcRegex = /\bsrc=["']([^"']+)["']/i;
  const altRegex = /\balt=["']([^"']*)["']/i;

  for (const match of html.matchAll(imgTagRegex)) {
    const tag = match[0];
    const src = tag.match(srcRegex)?.[1];
    if (!src) continue;
    const alt = tag.match(altRegex)?.[1] ?? null;
    images.push({ url: src, description: alt && alt.trim().length > 0 ? alt.trim() : null });
  }

  return images;
}

// Aggregator pages legitimately list many events, each with its own small
// first-party thumbnail — the per-result cap/description-required filter
// used for noisy social/CDN search results is the wrong fit here. Only
// drop obvious site chrome, resolve relative URLs against the page's own
// origin. ("vacio" is a real literal alt value seen on artes.uchile.cl —
// an alt that says "empty" carries no signal, treat as none.)
export function filterKnownSourceImages(
  images: Array<{ url: string; description: string | null }>,
  pageUrl: string,
): ImageCandidate[] {
  const seen = new Set<string>();
  const out: ImageCandidate[] = [];
  for (const img of images) {
    const trimmedUrl = img.url.trim();
    if (isJunkImage(trimmedUrl)) continue;
    let absoluteUrl: string;
    try {
      absoluteUrl = new URL(trimmedUrl, pageUrl).href;
    } catch {
      continue;
    }
    if (seen.has(absoluteUrl)) continue;
    seen.add(absoluteUrl);
    out.push({ url: absoluteUrl, description: img.description === "vacio" ? null : img.description });
  }
  return out;
}

// --- JSON-API sources ---------------------------------------------------

interface WpEventsListItem {
  title: { rendered: string };
  meta: {
    link_al_evento?: string;
    imagen_evento?: string;
    extracto_corto?: string;
    fecha_de_inicio?: string; // YYYYMMDD
    fecha_de_termino?: string; // YYYYMMDD
  };
}

function formatWpDate(yyyymmdd: string | undefined): string {
  if (!yyyymmdd || yyyymmdd.length !== 8) return "?";
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

// A WordPress REST API response is already structured — no HTML parsing,
// no guessing which image belongs to which event. Real find (Parque
// Cultural Valparaíso): hora_de_inicio/hora_de_termino are the venue's
// daily opening hours, NOT the inauguración time — the real one, when
// there is one, lives in extracto_corto's free text, so Haiku still reads
// that instead of trusting the structured hour fields blindly.
async function fetchJsonApiSource(source: { url: string; note: string }): Promise<RawResult> {
  const res = await fetch(source.url);
  if (!res.ok) {
    throw new Error(`json-api source ${source.url} responded ${res.status}`);
  }
  const items = (await res.json()) as WpEventsListItem[];

  const images: ImageCandidate[] = items
    .filter((item) => item.meta.imagen_evento)
    .map((item) => ({
      url: item.meta.imagen_evento as string,
      description: `Imagen de la exposición: ${item.title.rendered}`,
    }));

  const content = items
    .map((item) => {
      const start = formatWpDate(item.meta.fecha_de_inicio);
      const end = formatWpDate(item.meta.fecha_de_termino);
      return `- "${item.title.rendered}" (${start} a ${end}): ${item.meta.extracto_corto ?? "sin descripción"}. Más info: ${item.meta.link_al_evento ?? source.url}`;
    })
    .join("\n");

  return { title: source.note, url: source.url, content, score: 1, images };
}

function collapseWhitespace(text: string): string {
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// artes.uchile.cl's agenda listing (currently the only `html`-type bright
// source) wraps each event in its own <article class="mod-cal-result__item">
// with a title+individual-page link, a run date-range line, a venue-
// name-and-address line, and its own <img> — all cleanly co-located. The
// old approach flattened the WHOLE page (all N events) into one
// tag-stripped text blob before Haiku saw it, destroying that pairing —
// Haiku had to blind-match N images to N events from one pooled list and
// got some wrong (confirmed: 3 of 15 in a real run). This extracts one
// content line + one image per event instead, embedding the event's own
// title into its image's description — the exact trick that already makes
// image/event pairing reliable for the json-api bright-source path below
// (`Imagen de la exposición: ${title}`), and embedding each event's own
// individual page URL the same way json-api's `Más info: ${link}` already
// does, so Haiku picks it up as sourceUrl instead of the listing page.
//
// Returns null (caller falls back to the old whole-page approach) if the
// page doesn't match this structure — keeps this safe for any *other*
// html-type source added later with different markup, rather than baking
// in an assumption that every html source looks like this one.
const ARTICLE_REGEX = /<article class="mod-cal-result__item">([\s\S]*?)<\/article>/g;
const TITLE_LINK_REGEX = /<h4 class="mod__item-title"><a href="([^"]+)">([^<]*)<\/a><\/h4>/;
const DAYS_REGEX = /class="mod-cal-result__item-days"[^>]*>([\s\S]*?)<\/p>/;
// Real markup has a typo — some entries use "item-place", most use
// "item-placer" — match both rather than assuming the source will fix it.
const PLACE_REGEX = /class="mod-cal-result__item-place[a-z]*"[^>]*>([\s\S]*?)<\/p>/;

export function extractEventArticles(html: string, pageUrl: string): { content: string; images: ImageCandidate[] } | null {
  const lines: string[] = [];
  const images: ImageCandidate[] = [];

  for (const articleMatch of html.matchAll(ARTICLE_REGEX)) {
    const block = articleMatch[1];
    const titleMatch = block.match(TITLE_LINK_REGEX);
    if (!titleMatch) continue;
    const [, href, rawTitle] = titleMatch;
    const title = collapseWhitespace(rawTitle);

    const days = collapseWhitespace(block.match(DAYS_REGEX)?.[1] ?? "");
    const place = collapseWhitespace(block.match(PLACE_REGEX)?.[1] ?? "");

    let individualUrl: string;
    try {
      individualUrl = new URL(href, pageUrl).href;
    } catch {
      individualUrl = pageUrl;
    }

    lines.push(`- "${title}" (${days || "fecha no indicada"}). Lugar: ${place || "no indicado"}. Más info: ${individualUrl}`);

    const [firstImage] = filterKnownSourceImages(extractImgTags(block), pageUrl);
    if (firstImage) {
      images.push({ url: firstImage.url, description: `Imagen de la exposición: ${title}` });
    }
  }

  if (lines.length === 0) return null;
  return { content: lines.join("\n"), images };
}

async function fetchHtmlSource(source: { url: string; note: string }): Promise<RawResult> {
  const res = await fetch(source.url);
  if (!res.ok) {
    throw new Error(`html source ${source.url} responded ${res.status}`);
  }
  const html = await res.text();

  const structured = extractEventArticles(html, source.url);
  if (structured) {
    return { title: source.note, url: source.url, content: structured.content, score: 1, images: structured.images };
  }

  // Fallback: unrecognized markup — whole-page flatten, as before (script/
  // style CONTENTS stripped first, not just the tags, so JS/CSS source
  // doesn't leak into the text Haiku reads).
  const images = filterKnownSourceImages(extractImgTags(html), source.url);
  const text = collapseWhitespace(html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "")).slice(0, 4000);
  return { title: source.note, url: source.url, content: text, score: 1, images };
}

export interface BrightSource {
  url: string;
  note: string;
  type?: "html" | "json-api";
}

// Merge hand-curated + detected, deduped by domain (hand-curated wins —
// guards against a domain being both hand-added and previously
// auto-detected, which would otherwise fetch it twice).
export function mergeBrightSources(detected: BrightSource[]): BrightSource[] {
  const seen = new Set<string>();
  const merged: BrightSource[] = [];
  for (const source of [...(KNOWN_SOURCES as KnownSource[]), ...detected]) {
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
