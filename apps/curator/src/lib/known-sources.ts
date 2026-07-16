// Persisted list of "fuentes brillantes" — sources that have already
// proven to reliably list multiple real events in one place, fetched
// directly every run regardless of what search turns up. Not scoped to
// any single comuna/city; grows by hand as more of these get found.
//
// Also excluded from regular Tavily searches (via excludeDomains) since we
// already cover them via direct fetch — avoids paying to re-discover the
// same content through search. Doesn't apply to social platforms (a
// domain like instagram.com is shared by thousands of unrelated accounts,
// excluding it would exclude everything, not just one known-good source).
//
// lastReviewedAt: manual review cadence — every 3-6 months, confirm the
// URL still works and is still worth fetching directly. Not automated;
// just a note for whoever does the periodic check.
//
// `extractor`: which registry parser (event-discovery/extractors.ts) knows
// how to pull individual events out of this source's real structure —
// config, not a new one-off function per site. Its `kind` also decides HOW
// the source gets fetched: "wordpressRestApi" -> REST call, anything else
// (an "articleList" config, or no extractor at all) -> plain HTML page
// fetch, falling back to a whole-page flatten when there's no config or it
// doesn't match. A type-only import from event-discovery/ is the one place
// this file points "up" instead of down — extractor shapes are inherently
// owned by the extraction registry, not worth duplicating here.
import type { ExtractorConfig } from "../event-discovery/extractors.js";

export interface KnownSource {
  url: string;
  note: string;
  lastReviewedAt: string;
  extractor?: ExtractorConfig;
}

export const KNOWN_SOURCES: KnownSource[] = [
  {
    url: "https://artes.uchile.cl/agenda/30dias/6",
    note: "Rolling 30-day agenda, Universidad de Chile — lists multiple real exhibitions per entry, updates dynamically.",
    lastReviewedAt: "2026-07-12",
    extractor: {
      kind: "articleList",
      blockRegex: /<article class="mod-cal-result__item">([\s\S]*?)<\/article>/g,
      titleLinkRegex: /<h4 class="mod__item-title"><a href="([^"]+)">([^<]*)<\/a><\/h4>/,
      // Real markup has a typo — some entries use "item-place", most use
      // "item-placer" — match both rather than assuming the source will fix it.
      daysRegex: /class="mod-cal-result__item-days"[^>]*>([\s\S]*?)<\/p>/,
      placeRegex: /class="mod-cal-result__item-place[a-z]*"[^>]*>([\s\S]*?)<\/p>/,
    },
  },
  {
    url: "https://parquecultural.cl/wp-json/wp/v2/events_list?_fields=title,meta&per_page=20",
    note: 'WordPress REST API behind Parque Cultural Valparaíso\'s events widget (the widget itself is JS-rendered, invisible to a plain fetch — found via the browser\'s Network tab). Structured fields: title.rendered, meta.imagen_evento (image), meta.extracto_corto (free-text description, often states the real "Inauguración" date/time — meta.hora_de_inicio/hora_de_termino are just the venue\'s daily opening hours, NOT the inauguración time), meta.fecha_de_inicio/fecha_de_termino (YYYYMMDD).',
    lastReviewedAt: "2026-07-12",
    extractor: {
      kind: "wordpressRestApi",
      titleField: "title.rendered",
      linkField: "meta.link_al_evento",
      imageField: "meta.imagen_evento",
      descriptionField: "meta.extracto_corto",
      startDateField: "meta.fecha_de_inicio",
      endDateField: "meta.fecha_de_termino",
    },
  },
  {
    url: "https://www.mnba.gob.cl/cartelera",
    note: 'Museo Nacional de Bellas Artes\' full listing page (NOT /cartelera/proximos — that variant only shows 1 near-term addition; the plain /cartelera page has the real current lineup, 6 events at last check, 5 of them "Exposición"). Drupal site, clean semantic markup per event.',
    lastReviewedAt: "2026-07-16",
    extractor: {
      kind: "articleList",
      blockRegex: /<article\s+class="node node--evento[^"]*">([\s\S]*?)<\/article>/g,
      titleLinkRegex: /<h2 class="destacado__title"><a href="([^"]+)">([^<]*)<\/a><\/h2>/,
      daysRegex: /field--name-field-fechas"[^>]*>([\s\S]*?)<\/div>/,
      placeRegex: /field--name-institucion"><a[^>]*>([^<]*)<\/a>/,
    },
  },
];

export function knownSourceDomain(url: string): string {
  return new URL(url).hostname;
}
