// Post-curation, deterministic (regex, not Haiku) extraction of an event's
// specific opening date+time from its own detail page — for sources whose
// LISTING page only gives a date range, never the exact "Inauguración"
// time (see known-sources.ts's openingTimeExtractor field and
// docs/region-discovery.md). Same "regex-only, no HTML-parsing library"
// convention as event-discovery/extractors.ts.

// Duplicated from event-discovery/extractors.ts rather than imported —
// lib/ files don't otherwise depend on event-discovery/ (known-sources.ts
// has the one existing type-only exception), and this is a two-line
// utility, not worth crossing that direction for.
function collapseWhitespace(text: string): string {
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export interface OpeningTimeConfig {
  // Matched against the detail page's collapsed-whitespace text (tags
  // stripped first, same as extractors.ts's own regexes) — named capture
  // groups: day, month (Spanish 3-letter lowercase abbreviation), year,
  // hour, minute (optional, defaults to "00" when absent).
  pattern: RegExp;
}

const ES_MONTH_ABBR: Record<string, number> = {
  ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5,
  jul: 6, ago: 7, sep: 8, oct: 9, nov: 10, dic: 11,
};

// Wall-clock time in America/Santiago -> absolute UTC ISO instant. No
// hardcoded UTC offset (Chile's DST rule has changed more than once in
// recent years) — standard two-pass Intl offset-correction: guess the
// instant by treating the wall-clock parts as if they were already UTC,
// see what Santiago's clock actually reads for that guess, then correct by
// the difference. One pass is enough since America/Santiago's offset is
// constant across the few minutes this correction spans.
function santiagoWallTimeToUtcIso(year: number, month0: number, day: number, hour: number, minute: number): string {
  const guess = new Date(Date.UTC(year, month0, day, hour, minute));

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(guess);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Intl can format midnight as hour "24" under hour12:false in some
  // environments — normalize back to 0 before feeding Date.UTC.
  const santiagoHour = get("hour") % 24;
  const santiagoAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), santiagoHour, get("minute"));

  const correctionMs = guess.getTime() - santiagoAsUtc;
  return new Date(guess.getTime() + correctionMs).toISOString();
}

// Pure, never throws — null on no match or an unrecognized month
// abbreviation, same defensive posture as extractors.ts's parsers.
export function extractOpeningDatetime(html: string, config: OpeningTimeConfig): string | null {
  const text = collapseWhitespace(html);
  const match = text.match(config.pattern);
  if (!match?.groups) return null;

  const { day, month, year, hour, minute } = match.groups;
  const month0 = ES_MONTH_ABBR[month?.toLowerCase() ?? ""];
  if (month0 === undefined) return null;

  const dayNum = Number(day);
  const yearNum = Number(year);
  const hourNum = Number(hour);
  const minuteNum = minute ? Number(minute) : 0;
  if ([dayNum, yearNum, hourNum, minuteNum].some((n) => Number.isNaN(n))) return null;

  return santiagoWallTimeToUtcIso(yearNum, month0, dayNum, hourNum, minuteNum);
}
