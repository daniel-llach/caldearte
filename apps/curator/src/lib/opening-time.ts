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
  // groups: day, month (Spanish 3-letter lowercase abbreviation), year
  // (optional — see extractOpeningDatetime's referenceDate param for
  // sources, like uchile.cl, that never publish one at all), hour
  // (optional — see OpeningTimeResult.timeConfirmed for sources, like
  // arteinformado.com's "Sín-tesis", that confirm a date but not a time),
  // minute (optional, defaults to "00" when hour is present but minute
  // isn't).
  pattern: RegExp;
}

export interface OpeningTimeResult {
  iso: string;
  // false when the source confirms an inauguración DATE but never states
  // an hour — the date is still real, confirmed information (worth
  // showing under "Inauguraciones", not just "Expos Actuales"), it's only
  // the hour that's unknown. `iso` is still a full instant in this case
  // (midnight Santiago time, via the same santiagoWallTimeToUtcIso this
  // module already uses for real hours) — never displayed to a visitor
  // when timeConfirmed is false (see apps/web's EventCardBase), just a
  // deterministic placeholder so `iso` always parses as a valid instant.
  timeConfirmed: boolean;
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
export function santiagoWallTimeToUtcIso(year: number, month0: number, day: number, hour: number, minute: number): string {
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

// Inverse of santiagoWallTimeToUtcIso — a UTC instant back to its
// America/Santiago wall-clock date parts. No guess-correct pass needed
// here (unlike the forward direction): formatting an already-known instant
// into a timezone is direct, the two-pass correction above only exists
// because santiagoWallTimeToUtcIso starts from wall-clock parts with no
// instant yet. Used by page-fetch.ts's generic hour recovery to read back
// the day/month/year Haiku already confirmed, for cross-checking against
// a separately-extracted hour (see extractGenericInauguracionHour below).
export function utcIsoToSantiagoDateParts(iso: string): { year: number; month0: number; day: number } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? NaN);
  const year = get("year");
  const month0 = get("month") - 1;
  const day = get("day");
  if ([year, month0, day].some((n) => Number.isNaN(n))) return null;
  return { year, month0, day };
}

// Converts a plain "YYYY-MM-DDTHH:mm" (Chile wall-clock, no offset/"Z" —
// see event-discovery/discover.ts's buildSystemPrompt, which instructs
// Haiku to report exactly this format) into a real UTC ISO instant, via the
// same DST-safe conversion this module already uses for the deterministic
// regex path. Real bug, found 2026-07-20: Haiku's raw openingDatetime
// string used to be written straight to the DB with zero conversion — an
// event confirmed at "12:30" (Chile local) rendered as "08:30" on the
// card, since the frontend always reads opening_datetime as a UTC instant
// and converts back to America/Santiago for display. Returns null (never
// throws) for anything that doesn't match, so a malformed Haiku output
// degrades to "no confirmed opening time" rather than a wrong one.
const LOCAL_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;
export function parseLocalDatetimeToUtcIso(localDatetime: string): string | null {
  const match = localDatetime.match(LOCAL_DATETIME_PATTERN);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  const h = Number(hour);
  const mi = Number(minute);
  if ([y, mo, d, h, mi].some((n) => Number.isNaN(n))) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return santiagoWallTimeToUtcIso(y, mo - 1, d, h, mi);
}

// When a source never publishes the year at all (real example: uchile.cl's
// "Los esperamos este miércoles 01 de julio a las 18.00h" — implicitly
// "this year," since it's a rolling near-term agenda, not an archive),
// infer it from referenceDate's year, rolling forward to next year only if
// that would place the date more than PAST_TOLERANCE_DAYS in the past —
// handles a December-published page actually meaning next January without
// second-guessing the overwhelmingly common case (a recent/upcoming date
// in the current year).
const PAST_TOLERANCE_DAYS = 60;
function inferYear(month0: number, day: number, referenceDate: Date): number {
  const year = referenceDate.getUTCFullYear();
  const candidateMs = Date.UTC(year, month0, day);
  const toleranceMs = PAST_TOLERANCE_DAYS * 24 * 60 * 60 * 1000;
  return candidateMs < referenceDate.getTime() - toleranceMs ? year + 1 : year;
}

// Pure (referenceDate defaults to the real clock only at the call site, not
// hidden inside), never throws — null on no match or an unrecognized month
// abbreviation, same defensive posture as extractors.ts's parsers.
export function extractOpeningDatetime(html: string, config: OpeningTimeConfig, referenceDate: Date = new Date()): OpeningTimeResult | null {
  const text = collapseWhitespace(html);
  const match = text.match(config.pattern);
  if (!match?.groups) return null;

  const { day, month, year, hour, minute } = match.groups;
  const month0 = ES_MONTH_ABBR[month?.toLowerCase() ?? ""];
  if (month0 === undefined) return null;

  const dayNum = Number(day);
  if (Number.isNaN(dayNum)) return null;

  const yearNum = year ? Number(year) : inferYear(month0, dayNum, referenceDate);
  if (Number.isNaN(yearNum)) return null;

  // A malformed hour (matched but not a real number) is bad data, same as
  // a malformed day — genuinely absent (no hour group in the pattern at
  // all) is different: that's a real "date confirmed, time unknown" case.
  const timeConfirmed = hour !== undefined;
  const hourNum = timeConfirmed ? Number(hour) : 0;
  const minuteNum = timeConfirmed && minute ? Number(minute) : 0;
  if ([hourNum, minuteNum].some((n) => Number.isNaN(n))) return null;

  return { iso: santiagoWallTimeToUtcIso(yearNum, month0, dayNum, hourNum, minuteNum), timeConfirmed };
}

export interface GenericHourMatch {
  day: number;
  month0: number;
  hour: number;
  minute: number;
}

// Generic (not tied to any one domain's markup) fallback for recovering
// just the HOUR when Haiku already confirmed the date itself — unlike
// OpeningTimeConfig's per-domain patterns above, this one is deliberately
// loose about surrounding markup, matched against ANY fetched page. Found
// via manual sampling of 15 real production sourceUrls (2026-07-21, see
// docs/region-discovery.md): both real examples of a recoverable hour used
// this same shape — "Inauguración: [día,] D de MES[,] HH[:MM] h/hrs/horas"
// (Michel Taverne: "Inauguración: 4 de junio, 19 hrs"; Centex: "Inauguración:
// sábado 11 de julio, 12:00 horas"). Deliberately does NOT resolve a final
// date/instant itself (unlike extractOpeningDatetime) — a generic pattern
// run against an arbitrary page can find a day/month/hour that has nothing
// to do with THIS event (a venue's opening hours, another listed event on
// the same page). The caller (page-fetch.ts) must cross-check the returned
// day/month against the date Haiku already confirmed before trusting the
// hour — this function only reports what it found, not whether it's safe
// to use.
// "de" between day and month is optional — real production gap, found
// 2026-07-21 running Event Discovery for real: "Inauguración 10 julio
// 12:00 hrs" (Quilpué, Instagram) has no "de" at all, unlike every example
// in the original 15-URL sample. Missed because that sample happened not
// to include this phrasing.
const GENERIC_INAUGURACION_HOUR_PATTERN =
  /inaugur\w*:?[^.]{0,40}?(?<day>\d{1,2})\s+(?:de\s+)?(?<month>[a-zé]{3})[a-zé]*\.?,?\s*(?<hour>\d{1,2})(?::(?<minute>\d{2}))?\s*h(?:rs?)?\.?/i;

export function extractGenericInauguracionHour(html: string): GenericHourMatch | null {
  const text = collapseWhitespace(html);
  const match = text.match(GENERIC_INAUGURACION_HOUR_PATTERN);
  if (!match?.groups) return null;

  const { day, month, hour, minute } = match.groups;
  const month0 = ES_MONTH_ABBR[month?.toLowerCase() ?? ""];
  if (month0 === undefined) return null;

  const dayNum = Number(day);
  const hourNum = Number(hour);
  const minuteNum = minute ? Number(minute) : 0;
  if ([dayNum, hourNum, minuteNum].some((n) => Number.isNaN(n))) return null;

  return { day: dayNum, month0, hour: hourNum, minute: minuteNum };
}
