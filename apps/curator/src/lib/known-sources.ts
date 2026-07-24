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
import type { DescriptionConfig } from "./description-extract.js";

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
  // Present only for a confirmed single fixed-venue source — its comuna
  // never varies per event, so there's nothing for Haiku to infer or
  // report: attached directly in code by discover.ts's
  // curateBrightSourceItems, same posture as sourceUrl/imageUrl already
  // being deterministic from the extractor (2026-07-24). Deliberately
  // absent for real aggregators (arteinformado.com, uchile.cl root,
  // artes.uchile.cl) whose events span many different comunas/venues —
  // resolving "MAC Quinta Normal" -> "Santiago" needs real-world venue
  // knowledge a regex can't have, so those sources keep asking Haiku.
  fixedLocation?: { location: string; placeName: string };
  // Sibling to openingTimeExtractor, same reasoning: a real description
  // only exists on the event's own detail page for these sources (their
  // LISTING page never carries prose, confirmed 2026-07-24 by fetching
  // real pages — see docs/region-discovery.md) — recovered by
  // page-fetch.ts's enrichCandidates during the SAME detail-page fetch
  // already done for opening-time/image recovery, not a separate request.
  descriptionExtractor?: DescriptionConfig;
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
      // Real markup, confirmed 2026-07-24: "Todos los días (excepto el
      // lunes) del 11/07/2026 al 11/10/2026" — DD/MM/YYYY, always a range.
      dateRangeExtractor: {
        pattern: /del\s+(?<startDay>\d{1,2})\/(?<startMonth>\d{1,2})\/(?<startYear>\d{4})\s+al\s+(?<endDay>\d{1,2})\/(?<endMonth>\d{1,2})\/(?<endYear>\d{4})/i,
      },
    },
    // Real markup, confirmed 2026-07-24 against a live detail page — the
    // listing page itself never carries description prose (only title/
    // days/place), so this needs its own detail-page fetch, same as
    // openingTimeExtractor below (same CMS/template as uchile.cl root).
    descriptionExtractor: {
      pattern: /<div class="content__description"[^>]*>([\s\S]*?)<\/div>\s*<!--\/ description -->/,
    },
  },
  {
    url: "https://uchile.cl/agenda/30dias/6",
    note: 'Rolling 30-day agenda, Universidad de Chile\'s ROOT domain (not artes.uchile.cl — same underlying CMS/template, confirmed identical markup, but this feed aggregates exhibitions across faculties, e.g. Arquitectura y Urbanismo\'s Galería Micromedios, which artes.uchile.cl (Facultad de Artes only) never surfaces). Real production bug (found 2026-07-20): "Exhibición \'Alzar curva la mirada\'..." (Galería Micromedios, FAU) had sourceUrl=https://uchile.cl/agenda/exposiciones/10 — a listing page, not its own detail page — because this root domain had no dedicated entry yet, so it came in via regular per-comuna Tavily search instead of a direct fetch, and Tavily\'s plain-text extraction of a listing page drops per-event hrefs (same root cause as the arteinformado.com bug above). A dedicated extractor here fixes it the same way: each block\'s own <h4 class="mod__item-title"><a href="..."> is the correct per-event detail page, resolved against this page\'s own URL since the hrefs are relative (e.g. "/agenda/241838/exhibicion-alzar-curva-la-mirada-del-artista-francisco-belarmino").',
    lastReviewedAt: "2026-07-20",
    extractor: {
      kind: "articleList",
      blockRegex: /<article class="mod-cal-result__item">([\s\S]*?)<\/article>/g,
      titleLinkRegex: /<h4 class="mod__item-title"><a href="([^"]+)">([^<]*)<\/a><\/h4>/,
      daysRegex: /class="mod-cal-result__item-days"[^>]*>([\s\S]*?)<\/p>/,
      placeRegex: /class="mod-cal-result__item-place[a-z]*"[^>]*>([\s\S]*?)<\/p>/,
      // Same CMS/template as artes.uchile.cl — see its own dateRangeExtractor comment.
      dateRangeExtractor: {
        pattern: /del\s+(?<startDay>\d{1,2})\/(?<startMonth>\d{1,2})\/(?<startYear>\d{4})\s+al\s+(?<endDay>\d{1,2})\/(?<endMonth>\d{1,2})\/(?<endYear>\d{4})/i,
      },
    },
    // Real markup, confirmed 2026-07-20 against
    // .../agenda/241838/exhibicion-alzar-curva-la-mirada-del-artista-francisco-belarmino:
    // the opening time is NOT in an "Inauguración:" line (there isn't one)
    // — it's phrased as an invitation, "Los esperamos este miércoles 01 de
    // julio a las 18.00h. en Galería Micromedios...". The month is spelled
    // out in full ("julio", not "jul"), so the month group only captures
    // its first 3 letters (matching extractOpeningDatetime's existing
    // 3-letter lookup) while `[a-zé]*` consumes the rest. Only hand-verified
    // against this single real page — the phrasing may vary across other
    // uchile.cl event pages, unlike arteinformado.com's 20-page sample;
    // revisit if a future enrichment run turns up a non-matching format.
    openingTimeExtractor: {
      pattern:
        /esperamos\s+este\s+\S+\s+(?<day>\d{1,2})\s+de\s+(?<month>[a-zé]{3})[a-zé]*\s+a\s+las\s+(?<hour>\d{1,2})[.:](?<minute>\d{2})\s*h?/i,
    },
    // Same CMS/template as artes.uchile.cl, confirmed 2026-07-24 against a
    // real detail page on this root domain too.
    descriptionExtractor: {
      pattern: /<div class="content__description"[^>]*>([\s\S]*?)<\/div>\s*<!--\/ description -->/,
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
    // Single physical venue, one comuna — see BrightSourceItem.locationHint
    // doc comment in extractors.ts for why this is deterministic here but
    // not for a real aggregator.
    fixedLocation: { location: "Valparaíso", placeName: "Parque Cultural de Valparaíso" },
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
      // Real markup, confirmed 2026-07-24: the site's own Drupal date
      // field already embeds machine-readable ISO instants —
      // <time datetime="2025-07-10T12:00:00Z">10/Julio/2025</time> hasta
      // el <time datetime="...">31/Julio/2027</time> — no month-name
      // parsing needed at all, just read the attributes directly.
      dateRangeExtractor: {
        pattern: /<time datetime="(?<startIso>\d{4}-\d{2}-\d{2})[^"]*"[^>]*>[\s\S]*?<time datetime="(?<endIso>\d{4}-\d{2}-\d{2})[^"]*"[^>]*>/,
      },
    },
    fixedLocation: { location: "Santiago", placeName: "Museo Nacional de Bellas Artes" },
    // Real markup, confirmed 2026-07-24 against a live detail page —
    // listing page has no prose, only a topic/type tag and an address.
    descriptionExtractor: {
      pattern: /<div class="text-long">([\s\S]*?)<\/div>/,
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
      // Unlike every other articleList source, this LISTING page already
      // carries real description prose per event (confirmed 2026-07-24) —
      // captured directly here, no separate detail-page fetch needed.
      descriptionRegex: /class="ff-secondary fz-medium lh-high text-uppercase mb-0-last rmb-32">([\s\S]*?)<\/div>\s*<div class="page-evento__entradas">/,
      // Real markup, confirmed 2026-07-24: day+3-letter-month appear in two
      // separate <span> elements, with a single shared year in a sibling
      // element (evento-ano). A single-day event (concert/talk, not an
      // exhibition) puts an hour ("18 HRS") in the second span instead of
      // a month — resolveMonthGroup correctly fails to parse that as a
      // month, so this just yields null for those (harmless: they're
      // rejected on scope grounds anyway, never real exhibitions).
      dateRangeExtractor: {
        pattern:
          /class="evento-fecha[^"]*"[^>]*>[\s\S]*?<span>\s*(?<startDay>\d{1,2})\s+(?<startMonth>[A-ZÁÉÍÓÚ]{3})[\s\S]*?<\/span>\s*<span>\s*(?<endDay>\d{1,2})\s+(?<endMonth>[A-ZÁÉÍÓÚ]{3})[\s\S]*?<\/span>[\s\S]*?evento-ano[^"]*"[^>]*>\s*(?<year>\d{4})/,
      },
    },
    fixedLocation: { location: "Frutillar", placeName: "Centro de Arte Molino Machmar" },
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
      // Real markup, confirmed 2026-07-24: "11 jul de 2026 - 11 oct de
      // 2026" — day + 3-letter Spanish month + "de" + year, both ends.
      // Real production regression, same day: with dates left to Haiku to
      // interpret, a real ~28-item batch against this source came back
      // with EVERY item's runStartDate/runEndDate null despite this exact
      // unambiguous text — a mechanical parsing task Haiku shouldn't have
      // been doing in the first place, now fully deterministic.
      dateRangeExtractor: {
        pattern:
          /(?<startDay>\d{1,2})\s+(?<startMonth>[a-zé]{3})\.?\s+de\s+(?<startYear>\d{4})\s*-\s*(?<endDay>\d{1,2})\s+(?<endMonth>[a-zé]{3})\.?\s+de\s+(?<endYear>\d{4})/i,
      },
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
    // Real markup, confirmed 2026-07-24 against a live detail page —
    // labeled "Descripción de la Exposición" right before it, plain text
    // (no nested tags) inside the span itself.
    descriptionExtractor: {
      pattern: /<span class="event-text">([\s\S]*?)<\/span>/,
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

// Used by lib/page-fetch.ts's enrichCandidates to decide, per candidate,
// whether its sourceUrl's domain is opted in to description recovery.
export function findDescriptionConfig(sourceUrl: string): DescriptionConfig | null {
  let domain: string;
  try {
    domain = knownSourceDomain(sourceUrl);
  } catch {
    return null;
  }
  return KNOWN_SOURCES.find((s) => s.descriptionExtractor && knownSourceDomain(s.url) === domain)?.descriptionExtractor ?? null;
}
