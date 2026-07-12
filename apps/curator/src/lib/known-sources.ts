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
// "html" sources get scraped as a page (tags stripped, <img src/alt>
// pulled out first). "json-api" sources are structured data already —
// no HTML parsing needed, just map fields directly.
export interface KnownSource {
  url: string;
  note: string;
  lastReviewedAt: string;
  type?: "html" | "json-api";
}

export const KNOWN_SOURCES: KnownSource[] = [
  {
    url: "https://artes.uchile.cl/agenda/30dias/6",
    note: "Rolling 30-day agenda, Universidad de Chile — lists multiple real exhibitions per entry, updates dynamically.",
    lastReviewedAt: "2026-07-12",
  },
  {
    url: "https://parquecultural.cl/wp-json/wp/v2/events_list?_fields=title,meta&per_page=20",
    note: 'WordPress REST API behind Parque Cultural Valparaíso\'s events widget (the widget itself is JS-rendered, invisible to a plain fetch — found via the browser\'s Network tab). Structured fields: title.rendered, meta.imagen_evento (image), meta.extracto_corto (free-text description, often states the real "Inauguración" date/time — meta.hora_de_inicio/hora_de_termino are just the venue\'s daily opening hours, NOT the inauguración time), meta.fecha_de_inicio/fecha_de_termino (YYYYMMDD).',
    lastReviewedAt: "2026-07-12",
    type: "json-api",
  },
];

export function knownSourceDomain(url: string): string {
  return new URL(url).hostname;
}
