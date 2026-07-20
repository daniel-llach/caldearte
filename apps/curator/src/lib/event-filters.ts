// Used by event-discovery/run.ts to dedupe candidates against what's
// already stored.

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Accent/quote-insensitive: the same event routinely surfaces with
// slightly different punctuation across sources and re-runs ("Ejercicios
// de enlaces" vs "Exposición 'Ejercicios de enlaces'" was a real observed
// duplicate) — plain trim+lowercase missed it. Also collapses the
// title/subtitle separator itself: real bug (2026-07-18) — "Una metáfora
// verde - arte, activismo y solidaridad" vs "Una metáfora verde: arte,
// activismo y solidaridad", same event from two sources, one using a
// hyphen and the other a colon, evaded exact-match dedup.
export function normalizeTitle(title: string): string {
  return stripAccents(title.toLowerCase())
    .replace(/["'«»“”]/g, "")
    .replace(/\s*[-:–—|]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Used by run.ts's locationDateKey dedup fingerprint. Real bug (found
// 2026-07-20, via a user-requested Event Discovery audit): the same
// festival ("ARTEPUERTO 2026") got inserted 3 times in one run because 3
// different social posts about it reported the location as "Valparaíso,
// Chile" vs "Valparaíso" vs (via a different unit) just "Chile" appended
// differently — plain normalizeTitle-style whitespace/accent/case
// normalization still left those as different strings, so none of the 3
// dedup signals (title, sourceUrl, location+date) fired. `location` is
// documented as "la comuna/ciudad" (see discover.ts's buildSystemPrompt),
// so only the FIRST comma-segment is the actual signal — a trailing ",
// Chile"/", Región de ..." is noise that varies source-to-source for the
// same real place.
export function normalizeLocation(location: string): string {
  const firstSegment = location.split(",")[0];
  return normalizeTitle(firstSegment);
}
