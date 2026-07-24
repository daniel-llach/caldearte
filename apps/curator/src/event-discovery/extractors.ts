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
import { isJunkImage, type ImageCandidate } from "./discover.js";

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
}

// matchAll requires a global regex — a config author forgetting the "g"
// flag would otherwise throw at runtime instead of just not matching.
function ensureGlobalFlag(re: RegExp): RegExp {
  return re.global ? re : new RegExp(re.source, `${re.flags}g`);
}

export function extractArticleList(
  html: string,
  pageUrl: string,
  config: ArticleListConfig,
): { content: string; images: ImageCandidate[] } | null {
  const lines: string[] = [];
  const images: ImageCandidate[] = [];
  const blockRegex = ensureGlobalFlag(config.blockRegex);

  for (const blockMatch of html.matchAll(blockRegex)) {
    const block = blockMatch[1] ?? blockMatch[0];
    const titleMatch = block.match(config.titleLinkRegex);
    if (!titleMatch) continue;
    const [, href, rawTitle] = titleMatch;
    const title = collapseWhitespace(rawTitle ?? "");

    const days = config.daysRegex ? collapseWhitespace(block.match(config.daysRegex)?.[1] ?? "") : "";
    const place = config.placeRegex ? collapseWhitespace(block.match(config.placeRegex)?.[1] ?? "") : "";

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

function formatWpDate(yyyymmdd: string | undefined): string {
  if (!yyyymmdd || yyyymmdd.length !== 8) return "?";
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

// A WordPress REST API response is already structured — no HTML parsing,
// no guessing which image belongs to which event. Real find (Parque
// Cultural Valparaíso): hora_de_inicio/hora_de_termino are the venue's
// daily opening hours, NOT the inauguración time — the real one, when
// there is one, lives in the description field's free text, so Haiku
// still reads that instead of trusting the structured hour fields blindly.
export function extractWordpressItems(
  items: unknown[],
  config: WordpressRestConfig,
  fallbackUrl: string,
): { content: string; images: ImageCandidate[] } {
  const rows = items.map((item) => ({
    title: getStringPath(item, config.titleField) ?? "(sin título)",
    image: getStringPath(item, config.imageField),
    link: getStringPath(item, config.linkField),
    description: getStringPath(item, config.descriptionField),
    startDate: getStringPath(item, config.startDateField),
    endDate: getStringPath(item, config.endDateField),
  }));

  const images: ImageCandidate[] = rows
    .filter((row) => row.image)
    .map((row) => ({ url: row.image as string, description: `Imagen de la exposición: ${row.title}` }));

  // The per-event link sits right after the title, not at the end of the
  // line — real bug found in production (2026-07-24): parquecultural.cl's
  // description field (extracto_corto) is often long and itself contains
  // embedded field-like text (e.g. its own "Lugar: ..." segment, several
  // dashes), which reliably pushed a trailing "Más info: <url>" out of
  // Haiku's attention — every real, in-scope candidate from this source
  // came back with sourceUrl null despite the real per-event link being
  // present in the block, while shorter articleList-sourced lines (url
  // also at the end, but a much shorter line) never had this problem.
  // Matches the pattern Haiku already follows reliably elsewhere: the
  // block's own URL right after its title (buildBlock's own
  // `### title\nurl\ncontent` convention).
  const content = rows
    .map((row) => {
      const start = formatWpDate(row.startDate);
      const end = formatWpDate(row.endDate);
      return `- "${row.title}" — ${row.link ?? fallbackUrl} (${start} a ${end}): ${row.description ?? "sin descripción"}`;
    })
    .join("\n");

  return { content, images };
}

export type ExtractorConfig = ArticleListConfig | WordpressRestConfig;
