// Post-curation, deterministic (regex, not Haiku) recovery of a real event
// description from its own detail page — for bright sources whose LISTING
// page never carries prose at all (only title/dates/place), confirmed by
// hand against 4 real detail pages (2026-07-24, see
// docs/region-discovery.md): artes.uchile.cl/uchile.cl, mnba.gob.cl,
// arteinformado.com. Same "regex-only" convention as opening-time.ts,
// which this mirrors — a separate module (not folded into opening-time.ts)
// since the two extract genuinely different shapes: opening-time.ts
// matches against ALREADY-tag-stripped text (a date/hour phrase has no
// nested markup worth preserving), while description markup is nested
// <p>/<span> tags that must stay intact until AFTER the right chunk is
// isolated — collapsing whitespace first would erase the tag boundaries
// these patterns rely on to find the right chunk at all.

export interface DescriptionConfig {
  // Matched against the RAW page html, not collapsed-whitespace text (see
  // module doc comment above). Capture group 1 is the HTML fragment to
  // clean (strip tags, decode entities, collapse whitespace) into the
  // final description text.
  pattern: RegExp;
}

// A small, real-entity-driven table — not a general HTML-entity decoder.
// Covers what's actually been seen in these 4 sources' real description
// markup (Spanish accented letters, punctuation, non-breaking spaces) plus
// the same basic set extractors.ts's own decodeHtmlEntities covers.
const HTML_ENTITIES: Record<string, string> = {
  amp: "&", quot: '"', "#39": "'", lt: "<", gt: ">", nbsp: " ",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  ntilde: "ñ", Ntilde: "Ñ", uuml: "ü", Uuml: "Ü",
  iexcl: "¡", iquest: "¿", ldquo: "“", rdquo: "”",
  lsquo: "‘", rsquo: "’", hellip: "…", mdash: "—", ndash: "–",
};

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#?\w+);/g, (full, name: string) => HTML_ENTITIES[name] ?? full);
}

function stripTagsAndCollapse(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

// Pure, never throws — null on no match or an empty result, same
// defensive posture as opening-time.ts's extractors. The captured chunk
// often opens with a stray <img>/<br> or an empty first paragraph (e.g.
// artes.uchile.cl's detail markup always leads with the exhibition
// flyer image inside its own <p>) — harmless once tags are stripped, but
// worth noting so a future reader isn't surprised the result doesn't
// start exactly where the regex group did.
export function extractDescription(html: string, config: DescriptionConfig): string | null {
  const match = html.match(config.pattern);
  const raw = match?.[1];
  if (!raw) return null;
  const text = stripTagsAndCollapse(raw);
  return text.length > 0 ? text : null;
}
