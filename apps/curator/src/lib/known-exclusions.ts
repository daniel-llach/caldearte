import { stripAccents } from "./locations.js";

// Hand-curated list of known out-of-scope events — ART_SCOPE_POLICY
// already excludes conventional theater/concert/dance festivals by rule,
// but Haiku keeps getting specific, well-known ones wrong on thin/vague
// source text (e.g. "Festival Santiago a Mil" approved via generic
// "celebra el arte, lenguaje universal" reasoning despite being a
// well-known conventional theater festival, sourced from a single
// Instagram reel with barely any real description to judge format from).
// Grows by hand as real misses are found — same pattern as
// known-sources.ts's manually-reviewed list.
export const KNOWN_OUT_OF_SCOPE_EVENTS = [
  "festival santiago a mil",
  "la florida es teatro",
];

export function matchesKnownExclusion(title: string): boolean {
  const normalized = stripAccents(title.toLowerCase());
  return KNOWN_OUT_OF_SCOPE_EVENTS.some((name) => normalized.includes(name));
}
