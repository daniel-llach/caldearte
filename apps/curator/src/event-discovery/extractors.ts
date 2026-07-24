// Generic, config-driven content extraction for bright sources — the
// registry that replaces one-off parser functions. A source's markup/
// field-shape is described as DATA (an ExtractorConfig) in
// lib/known-sources.ts, not as a new function; adding a new bright source
// with known structure means writing a config entry, not a parser.
//
// Two shapes, matching the two kinds of structure bright sources have
// shown so far (docs/region-discovery.md#fuentes-brillantes):
// - "articleList": an HTML listing page where each event lives in its own
//   repeating block (uchile.cl's <article> tags).
// - "wordpressRestApi": a WordPress REST endpoint returning structured
//   JSON, fields named per-site (Parque Cultural Valparaíso's meta.*
//   fields aren't a WordPress standard, just this site's own naming).
//
// sources.ts's fetchHtmlSource/fetchJsonApiSource dispatch to these when a
// source has a matching config, falling back to sources.ts's own
// whole-page-flatten when it doesn't (or the config doesn't match) — that
// fallback stays in sources.ts since it isn't config-driven, it's the
// generic last resort.
//
// Real production pattern (2026-07-24, three separate bugs in one week —
// see docs/region-discovery.md): both extractors below used to parse this
// exact structure and then immediately THROW IT AWAY, flattening title/
// link/date/image into one prose line and asking Haiku to re-extract them
// from that prose — with deterministic "grounding" checks bolted on
// afterward to catch Haiku mis-transcribing a fact the code already had.
// Now they return the structure itself (`BrightSourceItem[]`) — sourceUrl/
// imageUrl/title/structured dates never touch Haiku at all for a
// source with a real extractor config; see discover.ts's
// curateBrightSourceItems for the curatorial-only Haiku call these feed.
import { isJunkImage, type ImageCandidate } from "./discover.js";

// One real event, already resolved to its true per-event identity by the
// extractor — never the listing/API page's own URL. `rawDateText` is
// whatever free text the source states (daysRegex capture, WordPress
// description field, etc.) for discover.ts to hand Haiku when there's no
// structured date to fall back on; `structuredStartDate`/`structuredEndDate`
// are populated only when the source itself gives an exact date (so far,
// only wordpressRestApi's YYYYMMDD meta fields) and are used as-is,
// bypassing Haiku's interpretation entirely. `locationHint` is raw venue/
// place text captured from the source (e.g. an articleList's placeRegex) —
// used only as a hint for Haiku's location inference on aggregator
// sources (several different comunas in one feed); ignored entirely for a
// source with a fixed known comuna (known-sources.ts's `fixedLocation`).
export interface BrightSourceItem {
  title: string;
  sourceUrl: string;
  imageUrl: string | null;
  description: string | null;
  locationHint: string | null;
  rawDateText: string;
  structuredStartDate: string | null; // YYYY-MM-DD
  structuredEndDate: string | null; // YYYY-MM-DD
}

export function collapseWhitespace(text: string): string {
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// Pull <img src/alt> pairs out BEFORE stripping tags — the original crude
// tag-strip threw away real per-exhibition thumbnails sitting right in the
// HTML (a real bug, found against artes.uchile.cl's agenda).
//
// src attributes are real HTML, so a site is free to (correctly) escape
// query-string "&" as "&amp;" — a real bug found against mnba.gob.cl's
// Drupal image-style URLs (?h=...&amp;itok=...): stored verbatim, that
// "&amp;" is literal text, not the "&" the real URL needs, breaking it.
function decodeHtmlEntities(text: string): string {
  return text.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

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
    images.push({ url: decodeHtmlEntities(src), description: alt && alt.trim().length > 0 ? alt.trim() : null });
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

// --- articleList: repeating HTML blocks, one event per block ------------

export interface ArticleListConfig {
  kind: "articleList";
  blockRegex: RegExp; // wraps one event's markup; capture group 1 is the block body (falls back to the whole match if there's no group)
  titleLinkRegex: RegExp; // within a block: captures [href, title]
  daysRegex?: RegExp; // within a block: captures the date-range text
  placeRegex?: RegExp; // within a block: captures the place text
  // Optional — most articleList sources' LISTING page has no prose at all
  // (only title/dates/place), in which case description recovery happens
  // separately, per-event, from the detail page (see lib/known-sources.ts's
  // descriptionExtractor + lib/page-fetch.ts). A source whose listing page
  // DOES carry real prose per event (confirmed 2026-07-24: molinomachmar.cl)
  // captures it here instead — no extra fetch needed.
  descriptionRegex?: RegExp;
}

// matchAll requires a global regex — a config author forgetting the "g"
// flag would otherwise throw at runtime instead of just not matching.
function ensureGlobalFlag(re: RegExp): RegExp {
  return re.global ? re : new RegExp(re.source, `${re.flags}g`);
}

export function extractArticleList(html: string, pageUrl: string, config: ArticleListConfig): BrightSourceItem[] | null {
  const items: BrightSourceItem[] = [];
  const blockRegex = ensureGlobalFlag(config.blockRegex);

  for (const blockMatch of html.matchAll(blockRegex)) {
    const block = blockMatch[1] ?? blockMatch[0];
    const titleMatch = block.match(config.titleLinkRegex);
    if (!titleMatch) continue;
    const [, href, rawTitle] = titleMatch;
    const title = collapseWhitespace(rawTitle ?? "");

    const days = config.daysRegex ? collapseWhitespace(block.match(config.daysRegex)?.[1] ?? "") : "";
    const place = config.placeRegex ? collapseWhitespace(block.match(config.placeRegex)?.[1] ?? "") : "";
    const descriptionMatch = config.descriptionRegex ? collapseWhitespace(block.match(config.descriptionRegex)?.[1] ?? "") : "";

    let individualUrl: string;
    try {
      individualUrl = new URL(href, pageUrl).href;
    } catch {
      individualUrl = pageUrl;
    }

    const [firstImage] = filterKnownSourceImages(extractImgTags(block), pageUrl);

    items.push({
      title,
      sourceUrl: individualUrl,
      imageUrl: firstImage?.url ?? null,
      description: descriptionMatch || null,
      locationHint: place || null,
      rawDateText: days || "fecha no indicada",
      structuredStartDate: null,
      structuredEndDate: null,
    });
  }

  if (items.length === 0) return null;
  return items;
}

// --- wordpressRestApi: structured JSON, fields named per-site -----------

export interface WordpressRestConfig {
  kind: "wordpressRestApi";
  titleField: string; // dotted path, e.g. "title.rendered"
  linkField: string; // e.g. "meta.link_al_evento"
  imageField: string; // e.g. "meta.imagen_evento"
  descriptionField?: string; // e.g. "meta.extracto_corto"
  startDateField?: string; // e.g. "meta.fecha_de_inicio" (YYYYMMDD)
  endDateField?: string; // e.g. "meta.fecha_de_termino" (YYYYMMDD)
}

function getStringPath(obj: unknown, path: string | undefined): string | undefined {
  if (!path) return undefined;
  const value = path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
  return typeof value === "string" ? value : undefined;
}

// YYYYMMDD -> YYYY-MM-DD, or null when absent/malformed — null (not a
// display placeholder) since this now feeds BrightSourceItem's
// structuredStartDate/EndDate directly, used as real data, not prose.
function formatWpDate(yyyymmdd: string | undefined): string | null {
  if (!yyyymmdd || yyyymmdd.length !== 8) return null;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

// A WordPress REST API response is already structured — no HTML parsing,
// no guessing which image belongs to which event, no need for Haiku to
// interpret startDate/endDate at all when the source gives them exactly
// (structuredStartDate/EndDate below). Real find (Parque Cultural
// Valparaíso): hora_de_inicio/hora_de_termino are the venue's daily
// opening hours, NOT the inauguración time — the real one, when there is
// one, lives in the description field's free text (rawDateText), so
// Haiku still reads that for openingDatetime specifically.
export function extractWordpressItems(items: unknown[], config: WordpressRestConfig, fallbackUrl: string): BrightSourceItem[] {
  return items.map((item) => {
    const title = getStringPath(item, config.titleField) ?? "(sin título)";
    const description = getStringPath(item, config.descriptionField) ?? null;
    return {
      title,
      sourceUrl: getStringPath(item, config.linkField) ?? fallbackUrl,
      imageUrl: getStringPath(item, config.imageField) ?? null,
      description,
      locationHint: null, // wordpressRestApi sources are always fixedLocation single-venue ones so far — no per-item venue text to infer from
      rawDateText: description ?? "",
      structuredStartDate: formatWpDate(getStringPath(item, config.startDateField)),
      structuredEndDate: formatWpDate(getStringPath(item, config.endDateField)),
    };
  });
}

export type ExtractorConfig = ArticleListConfig | WordpressRestConfig;
