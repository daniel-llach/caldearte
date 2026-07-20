import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@caldearte/shared-types";
import { cityIdFromRegionName, deriveCityId, OTHER_CITY } from "./cities";
import { activeRange, anchorDateOnly, dateOnlyFromIso, isArchivableMonth, isCurrentOrUpcoming, rangesOverlap, type EventDates } from "./date";
import { matchesQuery } from "./cities";

// Which time window the visitor is viewing (Header's Día/Semana toggle) —
// a single day, or the current Monday-Sunday week. Shared type so
// page.tsx/CalendarView.tsx/Header.tsx all agree on the same two values.
export type WindowMode = "day" | "week";

export interface EventRecord extends EventDates {
  id: string;
  title: string;
  artist: string | null;
  description: string | null;
  freeformLocation: string;
  placeName: string | null;
  regionName: string | null;
  imageUrl: string | null;
  sensitivityTags: string[];
  sourceUrl: string | null;
  // false only when openingDatetime is a real, confirmed-date-but-unknown-
  // hour placeholder (midnight Santiago time) — see
  // apps/curator/src/lib/opening-time.ts's OpeningTimeResult. Meaningless
  // when openingDatetime is null. EventCardBase uses this to avoid
  // displaying a fabricated hour.
  openingTimeConfirmed: boolean;
}

// Postgres views don't propagate the underlying table's NOT NULL
// constraints, so the generated type marks every column nullable — these
// are genuinely guaranteed non-null on the real `events` table (id/title
// from their column definitions, freeform_location per
// supabase/migrations/20260713180000_retire_venues_and_event_crawler.sql,
// sensitivity_tags defaults to '{}' and is declared not null,
// opening_time_confirmed defaults to true and is declared not null).
type EventRow = Omit<
  Database["public"]["Views"]["events_public"]["Row"],
  "id" | "title" | "freeform_location" | "sensitivity_tags" | "opening_time_confirmed"
> & {
  id: string;
  title: string;
  freeform_location: string;
  sensitivity_tags: string[];
  opening_time_confirmed: boolean;
};

// Same nullable-view-type caveat — id/name/country are genuinely not null
// on the real `regions` table.
type RegionRow = Omit<Database["public"]["Views"]["regions_public"]["Row"], "id" | "name" | "country"> & {
  id: string;
  name: string;
  country: string;
};

function toEventRecord(row: EventRow, regionNameById: Map<string, string>): EventRecord {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    description: row.description,
    freeformLocation: row.freeform_location,
    placeName: row.place_name,
    regionName: row.region_id ? (regionNameById.get(row.region_id) ?? null) : null,
    imageUrl: row.image_url,
    openingDatetime: row.opening_datetime,
    runStartDate: row.run_start_date,
    runEndDate: row.run_end_date,
    sensitivityTags: row.sensitivity_tags,
    sourceUrl: row.source_url,
    openingTimeConfirmed: row.opening_time_confirmed,
  };
}

// One row per comuna (see cities.ts's header comment on the `regions`
// table's naming) — admin_region_name/admin_region_order are the Chilean
// administrative macro-region (I-XVI, Región Metropolitana) and its
// geographic north-to-south rank (RM sits at position 7, between V
// Valparaíso and VI O'Higgins — its real geographic slot, NOT its roman
// numeral); admin_region_numeral is the separate, non-geographic official
// numbering shown as a pill in the city picker ("II", "V", "RM", "XV"...).
// All three nullable so a future country's comunas can be seeded before
// this data exists for them (see groupCitiesByRegion in cities.ts for the
// fallback this enables).
export interface RegionMeta {
  id: string;
  name: string;
  country: string;
  adminRegionName: string | null;
  adminRegionOrder: number | null;
  adminRegionNumeral: string | null;
}

// Reads go through events_public/regions_public, not the base tables
// directly — see supabase/migrations/20260717050000_restrict_public_columns_via_views.sql.
// anon has no grant at all on the base `events`/`regions` tables anymore;
// the views bake in the curation_status='approved' filter and expose only
// the columns the frontend actually needs, keeping internal pipeline
// columns (curation_reasoning, regions.status/exclusion_reason/etc.) out
// of what's queryable via the (necessarily public) anon key. `regions` is
// fetched in full (not just the subset referenced by events) so the city
// picker can group EVERY comuna with events by its macro-región, not only
// ones that happen to also appear in regionNameById.
export async function fetchApprovedEvents(
  client: SupabaseClient<Database>,
): Promise<{ events: EventRecord[]; regions: RegionMeta[] }> {
  const [eventsRes, regionsRes] = await Promise.all([
    client.from("events_public").select("*"),
    client.from("regions_public").select("*"),
  ]);
  if (eventsRes.error) {
    throw new Error(`Failed to fetch events: ${eventsRes.error.message}`);
  }
  if (regionsRes.error) {
    throw new Error(`Failed to fetch regions: ${regionsRes.error.message}`);
  }
  // Same nullable-view-type caveat as EventRow above — id/name/country are
  // genuinely not null on the real `regions` table.
  const regionRows = (regionsRes.data ?? []) as RegionRow[];
  const regionNameById = new Map(regionRows.map((r) => [r.id, r.name]));
  const regions: RegionMeta[] = regionRows.map((r) => ({
    id: r.id,
    name: r.name,
    country: r.country,
    adminRegionName: r.admin_region_name,
    adminRegionOrder: r.admin_region_order,
    adminRegionNumeral: r.admin_region_numeral,
  }));
  const eventRows = (eventsRes.data ?? []) as EventRow[];
  return { events: eventRows.map((row) => toEventRecord(row, regionNameById)), regions };
}

// Prefers the curator's own region match (exact, resolved at write time)
// over the frontend's freeform_location guess — the guess only covers rows
// from before region_id existed, or whose location text didn't match any
// seeded region. cityIdFromRegionName always succeeds (no whitelist to
// fall outside of — see cities.ts), so regionName wins whenever present.
function resolveCityId(event: EventRecord): string {
  if (event.regionName) return cityIdFromRegionName(event.regionName);
  return deriveCityId(event.freeformLocation);
}

function displayNameForCity(event: EventRecord): string {
  if (event.regionName) return event.regionName;
  const segments = event.freeformLocation.split(",").map((s) => s.trim());
  return segments[segments.length - 1] || event.freeformLocation;
}

// id -> display name, built from real observed events (not a static
// list) — every city that has ever had at least one event (not just
// active-today) gets a proper name here, so directly navigating to a
// city via cookie still shows its real name even when it currently has
// zero active events. First name seen for a given id wins; in practice
// all events resolving to the same id share the same regionName anyway
// (both derive from the exact same seeded `regions.name`).
export function cityNamesFromEvents(events: EventRecord[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const e of events) {
    const id = resolveCityId(e);
    if (id === OTHER_CITY.id) continue;
    if (!(id in names)) names[id] = displayNameForCity(e);
  }
  return names;
}

export function filterFamilyMode(events: EventRecord[], familyModeOn: boolean): EventRecord[] {
  return familyModeOn ? events.filter((e) => e.sensitivityTags.length === 0) : events;
}

export function filterByCity(events: EventRecord[], cityId: string): EventRecord[] {
  return events.filter((e) => resolveCityId(e) === cityId);
}

export function eventsActiveInRange(events: EventRecord[], start: string, end: string): EventRecord[] {
  return events.filter((e) => {
    const range = activeRange(e);
    return range !== null && rangesOverlap(range.start, range.end, start, end);
  });
}

// The home page shows only what's visitable within the current window —
// nothing not yet started, nothing already ended (stricter than
// isCurrentOrUpcoming's month-level retention check, which is still used
// by findNextEvent's lookahead below). The window itself is either a
// single day (Día mode: start === end === today) or a Monday-Sunday week
// (Semana mode) — chosen by the Header's toggle, computed once in
// page.tsx. This is a thin wrapper because eventsActiveInRange is already
// generic over arbitrary ranges.
export function filterActiveInRange(events: EventRecord[], start: string, end: string): EventRecord[] {
  return eventsActiveInRange(events, start, end);
}

// Newest opening/start first — an exhibition that just opened outranks one
// that's been running for weeks.
export function sortByAnchorDesc(events: EventRecord[]): EventRecord[] {
  return [...events].sort((a, b) => {
    const aAnchor = anchorDateOnly(a) ?? "";
    const bAnchor = anchorDateOnly(b) ?? "";
    if (aAnchor === bAnchor) return 0;
    return aAnchor > bAnchor ? -1 : 1;
  });
}

export interface InauguracionesYExpos {
  inauguraciones: EventRecord[];
  exposActuales: EventRecord[];
}

// Intentionally OVERLAPPING, not mutually exclusive: an event with a
// confirmed opening within [start, end] is highlighted in "Inauguraciones"
// AND still shown in "Expos Actuales" — a visitor shouldn't have to guess
// which section a today-opening exhibition landed in. `exposActuales` is
// simply every event in the (already range-filtered) input; `inauguraciones`
// is the subset whose opening falls in the window. Caller must already
// have narrowed `events` to the active window (filterActiveInRange) — this
// only splits/highlights, doesn't filter.
export function splitInauguracionesYExpos(events: EventRecord[], start: string, end: string): InauguracionesYExpos {
  const inauguraciones = events.filter((e) => {
    if (e.openingDatetime === null) return false;
    const openingDate = dateOnlyFromIso(e.openingDatetime);
    return openingDate >= start && openingDate <= end;
  });
  return {
    inauguraciones: sortByAnchorDesc(inauguraciones),
    exposActuales: sortByAnchorDesc(events),
  };
}

export interface CityCounts {
  inauguraciones: number;
  exposActuales: number;
}

// Per-city counts for the "Arte en todas partes" carousel — run over the
// full (not city-filtered) active-in-range + family-mode-filtered set. Only
// ever creates an entry for a city with at least one real event in the
// current window — not seeded from any fixed list — so citiesWithEvents
// (cities.ts) naturally offers exactly "the cities with something to show",
// whichever real comunas those turn out to be. Overlap-counted, matching
// splitInauguracionesYExpos: an opening-in-range event increments BOTH
// tallies, since it's rendered in both sections.
export function countByCity(events: EventRecord[], start: string, end: string): Record<string, CityCounts> {
  const counts: Record<string, CityCounts> = {};
  for (const e of events) {
    const cityId = resolveCityId(e);
    if (cityId === OTHER_CITY.id) continue; // "otro" isn't shown in the carousel
    if (!(cityId in counts)) counts[cityId] = { inauguraciones: 0, exposActuales: 0 };
    counts[cityId].exposActuales += 1;
    const openingDate = e.openingDatetime !== null ? dateOnlyFromIso(e.openingDatetime) : null;
    if (openingDate !== null && openingDate >= start && openingDate <= end) {
      counts[cityId].inauguraciones += 1;
    }
  }
  return counts;
}

// One place that adds up {inauguraciones, exposActuales} pairs — used for
// both the región-level and Chile-level totals in the city picker, so a
// región's count is just sumCounts of its comunas' CityCounts, and the
// country total is sumCounts of every visible comuna's.
export function sumCounts(counts: CityCounts[]): CityCounts {
  return counts.reduce(
    (acc, c) => ({ inauguraciones: acc.inauguraciones + c.inauguraciones, exposActuales: acc.exposActuales + c.exposActuales }),
    { inauguraciones: 0, exposActuales: 0 },
  );
}

// Per-city preview thumbnails for the "Arte en todas partes" carousel — up
// to `maxPerCity` events, newest/soonest anchor date first (same
// sortByAnchorDesc ordering already used for inauguraciones/exposActuales
// display). Only ever keys a city that actually has a qualifying event —
// same "built from real data, not a fixed list" shape as countByCity.
export function thumbnailsByCity(events: EventRecord[], maxPerCity = 4): Record<string, EventRecord[]> {
  const byCity: Record<string, EventRecord[]> = {};
  for (const e of sortByAnchorDesc(events)) {
    const cityId = resolveCityId(e);
    if (cityId === OTHER_CITY.id) continue;
    if (!(cityId in byCity)) byCity[cityId] = [];
    if (byCity[cityId].length < maxPerCity) byCity[cityId].push(e);
  }
  return byCity;
}

// Cascading empty-state support: the earliest current-or-upcoming event
// (month-level, not window-exact) that falls AFTER the current window ends
// — so an empty section/page can say "the next one is on X" instead of
// just "nothing." Threshold is `> windowEnd` (today in Día mode, the
// week's Sunday in Semana mode), not `>= todayStr` — this is the
// empty-window fallback, so "next" must mean "after what we already tried
// to show," whichever window that was.
export function findNextEvent(events: EventRecord[], todayStr: string, windowEnd: string): EventRecord | null {
  const upcoming = events
    .filter((e) => isCurrentOrUpcoming(e, todayStr))
    .map((e) => ({ e, anchor: anchorDateOnly(e) }))
    .filter((x): x is { e: EventRecord; anchor: string } => x.anchor !== null && x.anchor > windowEnd)
    .sort((a, b) => (a.anchor > b.anchor ? 1 : a.anchor < b.anchor ? -1 : 0));
  return upcoming[0]?.e ?? null;
}

// --- "Expos anteriores" archive ---------------------------------------

export interface MonthKey {
  year: number;
  month: number; // 1-12
}

function monthKeyOf(dateStr: string): string {
  return dateStr.slice(0, 7); // "YYYY-MM"
}

// Every approved event with a resolvable anchor date, keyed to exactly one
// month — its own anchor's month — never repeated across the months a
// multi-month run happens to span. This is what keeps each archive page's
// content unique (no duplicate cards across pages, which would dilute
// SEO), per the confirmed "opening month is canonical" rule.
export function groupEventsByAnchorMonth(events: EventRecord[]): Map<string, EventRecord[]> {
  const groups = new Map<string, EventRecord[]>();
  for (const e of events) {
    const anchor = anchorDateOnly(e);
    if (!anchor) continue;
    const key = monthKeyOf(anchor);
    const bucket = groups.get(key);
    if (bucket) bucket.push(e);
    else groups.set(key, [e]);
  }
  return groups;
}

// Distinct past months (strictly before todayStr's Santiago month) that
// have at least one event, most-recent-first — the source list for both
// generateStaticParams and the sitemap.
export function listArchiveMonths(events: EventRecord[], todayStr: string): MonthKey[] {
  const groups = groupEventsByAnchorMonth(events);
  const months: MonthKey[] = [];
  for (const key of groups.keys()) {
    const [year, month] = key.split("-").map(Number);
    if (isArchivableMonth(year, month, todayStr)) months.push({ year, month });
  }
  return months.sort((a, b) => b.year * 12 + b.month - (a.year * 12 + a.month));
}

// Events anchored to exactly this year/month, earliest opening first — an
// archive page reads as a timeline of the month, unlike the home page's
// "newest first" ordering (sortByAnchorDesc).
export function eventsForMonth(events: EventRecord[], year: number, month: number): EventRecord[] {
  const key = `${year}-${String(month).padStart(2, "0")}`;
  const bucket = groupEventsByAnchorMonth(events).get(key) ?? [];
  return [...bucket].sort((a, b) => {
    const aAnchor = anchorDateOnly(a) ?? "";
    const bAnchor = anchorDateOnly(b) ?? "";
    return aAnchor < bAnchor ? -1 : aAnchor > bAnchor ? 1 : 0;
  });
}

// Free-text search over title/artist/placeName — accent-insensitive via
// cities.ts's matchesQuery, same normalization the city picker's search
// box already relies on.
export function searchEvents(events: EventRecord[], query: string): EventRecord[] {
  const trimmed = query.trim();
  if (!trimmed) return events;
  return events.filter(
    (e) => matchesQuery(e.title, trimmed) || (e.artist !== null && matchesQuery(e.artist, trimmed)) || (e.placeName !== null && matchesQuery(e.placeName, trimmed)),
  );
}

export function filterByPlaceName(events: EventRecord[], query: string): EventRecord[] {
  const trimmed = query.trim();
  if (!trimmed) return events;
  return events.filter((e) => e.placeName !== null && matchesQuery(e.placeName, trimmed));
}
