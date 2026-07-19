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
import type { OpeningTimeConfig } from "./opening-time.js";

export interface KnownSource {
  url: string;
  note: string;
  lastReviewedAt: string;
  extractor?: ExtractorConfig;
  additionalPages?: string[];
  // Sibling to `extractor`, not nested inside it: the opening date+time
  // lives on a DIFFERENT page than the listing markup `extractor`
  // describes (each event's own detail page, reachable only via the
  // candidate's post-curation sourceUrl) — see lib/page-fetch.ts's
  // enrichCandidates and docs/region-discovery.md. Opt-in per source since
  // the phrasing varies too much across sites for one universal regex.
  openingTimeExtractor?: OpeningTimeConfig;
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
  {
    url: "https://www.molinomachmar.cl/cartelera/",
    note: 'Centro de Arte Molino Machmar (CAMM), Frutillar — events/expositions listing page. Mix of exposiciones (visual art, in scope) and performances/charlas (out of scope), which Haiku filters correctly. Real production bug (found 2026-07-16): this page is long (9 mixed-category events, ~68k chars) and the exposiciones happen to sit past the whole-page-flatten\'s 4000-char cutoff (lib/sources.ts) — without a structured extractor, all 3 real exhibitions ("Ausencia y Presencia", "Paisaje en Erupción", "Una Paloma en el Molino") were silently truncated out and never reached Haiku. Per-event title+link live in the SAME <a> tag (its title attribute is "Leer: <event title>"), letting titleLinkRegex read both from one match instead of needing separate title/link patterns.',
    lastReviewedAt: "2026-07-16",
    extractor: {
      kind: "articleList",
      blockRegex: /<article class="page-evento[^"]*">([\s\S]*?)<\/article>/g,
      titleLinkRegex: /<a href="([^"]+)" title="Leer: ([^"]*)" class="page-evento__enlace/,
      daysRegex: /class="evento-fecha[^"]*"[^>]*>([\s\S]*?class="evento-ano[^"]*"[^>]*>[\s\S]*?)<\/p>/,
    },
  },
  {
    url: "https://www.arteinformado.com/agenda/exposiciones/exposiciones-de-arte-en-chile-cl_1",
    note: 'ARTEINFORMADO, a large Ibero-American art-events aggregator ("4226 Exposiciones en Chile", paginated —423 pages total; fetches page 1 + page 2 only, see additionalPages below, deliberately not more). Real production bug (found 2026-07-16): this domain was auto-detected as a bright source from REGULAR per-unit Tavily search hits (its listing page kept surfacing across several comuna searches) before this dedicated entry existed. Tavily\'s plain-text extraction of a listing page like this drops each event\'s own detail-page href entirely — only the single aggregator page URL survives as "the block\'s own URL" — so Haiku had no per-event link to report, and (pre-enforceSourceUrlInvariant fix) silently approved several events with sourceUrl=null instead of falling back to that block URL as instructed: "Sín-tesis", "Existen otros mundos, pero están en este", "Hallazgo, réplica, ficción", and others — manually deleted from production once found. A dedicated extractor fixes this at the root: each event block\'s own <h3><a href="..."> IS the correct per-event detail page (confirmed real, e.g. .../agenda/f/existen-otros-mundos-pero-estan-en-este-243857), giving Haiku a specific link and image per event instead of one shared page-level URL.',
    lastReviewedAt: "2026-07-17",
    extractor: {
      kind: "articleList",
      blockRegex: /<div class="col-md-2 col-sm-4 bottom30">([\s\S]*?)(?=<div class="col-md-2 col-sm-4 bottom30">|$)/g,
      titleLinkRegex: /<h3><a href="([^"]+)"[^>]*>([^<]*)<\/a><\/h3>/,
      daysRegex: /class="txt-date txt-gris">([^<]*)<\/span>/,
      placeRegex: /class="font17">([\s\S]*?)<\/div>/,
    },
    // Real production check (2026-07-17): "Sín-tesis" (Galería NAC) was
    // missing from page 1 and only showed up on page 2. The site's sort
    // order isn't chronological/vigencia-first (page 5 already had events
    // that ended ~2 months before today) — pagination URL format is
    // "..._1/N" (a trailing /N, NOT "_N"), confirmed against the page's own
    // pagination links, not guessed.
    additionalPages: ["https://www.arteinformado.com/agenda/exposiciones/exposiciones-de-arte-en-chile-cl_1/2"],
    // Real bug (found 2026-07-19): the listing page's daysRegex above only
    // gives a date RANGE ("15 jul de 2026 - 22 ago de 2026") — every one of
    // the 10 approved arteinformado.com events in production had
    // opening_datetime = null as a result. The specific opening date+time
    // only exists on each event's own detail page, in a structured
    // "Inauguración : ..." line — confirmed against real markup, which is
    // why this pattern is matched against collapsed-whitespace text (see
    // extractOpeningDatetime), not the raw HTML directly (there's a </span>
    // and <br/> between "Inauguración" and the date).
    //
    // Real bug #2 (found 2026-07-19, hours after shipping the fix above):
    // the FIRST version of this regex only matched the "19 a 21 h." range
    // format seen on .../agenda/f/dejar-atras-245428 — but a sample of 20
    // real detail pages (both listing pages' events) showed that format is
    // the outlier (1/20). The overwhelming majority (17/20) use a plain
    // "HH:MM" time ("24 abr de 2026 / 19:00"), one uses "HH:MMh" with no
    // space before the "h" (.../agenda/f/cuerpos-velados-santiago-figueroa-245451),
    // and one has no time at all, just a date (.../agenda/f/sin-tesis-245342)
    // — that last case is a real editorial gap on arteinformado.com's own
    // page, not something to fabricate an hour for; it correctly yields
    // null (event still counts as an "expo actual", just not as an
    // "inauguración", since we genuinely don't know when it opened). The
    // time portion of this regex is one optional group so any of these
    // (range / HH:MM / HH:MMh / absent) matches without needing a separate
    // config entry.
    openingTimeExtractor: {
      pattern:
        /Inauguraci[oó]n\s*:?\s*(?<day>\d{1,2})\s+(?<month>[a-zé]{3})\.?\s+de\s+(?<year>\d{4})(?:\s*\/\s*(?<hour>\d{1,2})(?::(?<minute>\d{2}))?(?:\s*h(?:rs?)?\.?)?(?:\s*a\s*\d{1,2}\s*h(?:rs?)?\.?)?)?/i,
    },
  },
];

export function knownSourceDomain(url: string): string {
  return new URL(url).hostname;
}

// Used by lib/page-fetch.ts's enrichCandidates to decide, per candidate,
// whether its sourceUrl's domain is opted in to opening-time enrichment.
export function findOpeningTimeConfig(sourceUrl: string): OpeningTimeConfig | null {
  let domain: string;
  try {
    domain = knownSourceDomain(sourceUrl);
  } catch {
    return null; // unparseable URL — not our problem here
  }
  return KNOWN_SOURCES.find((s) => s.openingTimeExtractor && knownSourceDomain(s.url) === domain)?.openingTimeExtractor ?? null;
}
