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

// Hand-curated list of source domains whose per-event extraction is
// unreliable enough to exclude outright, rather than try to fix candidate
// by candidate. Real case: infobae.com's weekly "agenda-cultura" roundup
// (guia-de-arte-y-cultura-semana-del-...) bundles many events from
// MULTIPLE countries (Chile and Argentina both appeared) into one
// tangled page — the opposite of the "one page = one event" assumption
// filterKnownExclusions's title-matching relies on for regular per-unit
// search results. Two different weeks of this same URL pattern each
// produced a bad candidate (one wrongly-approved Buenos Aires exhibition,
// one Santiago exhibition with a broken image — an HTML-encoded '&amp;'
// literally embedded in the stored image URL's query string, suggesting
// the page's own markup/rendering is what's actually tangled, not just a
// one-off Haiku mistake). Domain-level, not path-specific — Infobae's
// agenda-cultura format is consistently multi-country/multi-event, so
// future weeks' guides are excluded the same way.
export const KNOWN_LOW_QUALITY_SOURCE_DOMAINS = ["infobae.com"];

export function matchesKnownLowQualityDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return KNOWN_LOW_QUALITY_SOURCE_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false; // unparseable URL — not our problem to filter here
  }
}
