// Deterministic (regex-only, no Haiku) extraction of a page's own stated
// publish date — used as a code-level backstop against Haiku assigning an
// old post to the current target month/year, the same "belt and
// suspenders" pattern already used for the Recoleta foreign-country
// filter (see docs/region-discovery.md's curation section).
//
// Found via manual sampling of 15 real production sourceUrls
// (2026-07-21, see docs/region-discovery.md): 7 of 15 had a real publish
// date that didn't match the month Haiku searched for, in TWO different
// shapes — standard `datePublished`/`article:published_time` metadata
// (most CMS-driven sites, e.g. prensaeventos.cl's 2023 article resurfacing
// in a July 2026 search) and Instagram's og:description caption byline
// ("<user> on <Month> <DD>, <YYYY>:", which Instagram emits instead of the
// standard meta tags above). Facebook was checked and found to expose
// neither via a plain fetch — not covered here.

const EN_MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

const JSON_LD_DATE_REGEX = /"datePublished"\s*:\s*"([^"]+)"/;
const ARTICLE_META_DATE_REGEX = /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i;
const INSTAGRAM_BYLINE_REGEX = /\bon ([A-Z][a-z]+) (\d{1,2}), (\d{4}):/;

// Never throws — null when no recognized signal is present, which is the
// common case (most sources carry none of these) and must NOT be treated
// as "stale," only as "unknown."
export function extractPublishedDate(html: string): Date | null {
  const isoMatch = html.match(JSON_LD_DATE_REGEX) ?? html.match(ARTICLE_META_DATE_REGEX);
  if (isoMatch) {
    const d = new Date(isoMatch[1]);
    if (!Number.isNaN(d.getTime())) return d;
  }

  const igMatch = html.match(INSTAGRAM_BYLINE_REGEX);
  if (igMatch) {
    const month0 = EN_MONTHS[igMatch[1].toLowerCase()];
    if (month0 !== undefined) {
      const day = Number(igMatch[2]);
      const year = Number(igMatch[3]);
      if (!Number.isNaN(day) && !Number.isNaN(year)) return new Date(Date.UTC(year, month0, day));
    }
  }

  return null;
}

// Deliberately conservative: only the YEAR is compared, not the month.
// Sampling found real, legitimate same-year gaps of 1-2 months (an
// exhibition announced ahead of its opening, or still running weeks after
// its own opening post) — a month-level check would risk rejecting those.
// Every stale case found in the sample had a different year from the
// target month's year; that's the one signal with zero observed false
// positives so far. A same-year-but-wrong-month case (found once: an
// April opening curated into a July run) is a known, documented gap, not
// covered by this check — revisit with more real data before tightening.
export function isStalePublishYear(publishedDate: Date, referenceDate: Date): boolean {
  return publishedDate.getUTCFullYear() !== referenceDate.getUTCFullYear();
}
