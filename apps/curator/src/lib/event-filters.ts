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

// Generic art-event vocabulary, stripped before comparing titles for
// similarity — shared only because two DIFFERENT events happen to both be
// "una exposición" or "de 2026", not because they're the same event. Kept
// deliberately small/conservative: better to miss a fuzzy duplicate than to
// silently merge two genuinely different events over generic word overlap.
const GENERIC_TITLE_WORDS = new Set([
  "exposicion", "expo", "muestra", "arte", "artistica", "artistico",
  "artisticas", "artisticos", "inauguracion", "obra", "obras", "galeria",
  "centro", "cultural", "museo", "intervencion",
]);

// Used by run.ts's cross-run dedup as a fallback signal, for the case none
// of the three exact-match keys (title, sourceUrl, location+datetime) catch
// a real duplicate — e.g. two different social posts about the same real
// opening, reporting slightly different exact hours ("19:00" vs "19:30"),
// with meaningfully different title wording too. Requires BOTH high
// word-overlap (Jaccard >= 0.6) AND at least 2 shared significant words —
// either alone is too weak (a single shared generic-sounding word, or a
// borderline Jaccard score on very short titles, both risk merging two
// genuinely different events at the same venue on the same day, which is a
// worse outcome than an occasional missed duplicate).
export function isLikelySameTitle(a: string, b: string): boolean {
  const tokenize = (title: string) =>
    new Set(
      stripAccents(title.toLowerCase())
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2 && !/^\d+$/.test(w) && !GENERIC_TITLE_WORDS.has(w)),
    );
  const wordsA = tokenize(a);
  const wordsB = tokenize(b);
  if (wordsA.size === 0 || wordsB.size === 0) return false;

  const shared = [...wordsA].filter((w) => wordsB.has(w));
  const union = new Set([...wordsA, ...wordsB]).size;
  const jaccard = shared.length / union;
  return shared.length >= 2 && jaccard >= 0.6;
}
