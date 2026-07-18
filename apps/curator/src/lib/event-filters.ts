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
