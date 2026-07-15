import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@caldearte/shared-types";
import { deriveCityId, KNOWN_CITIES } from "./cities";
import { activeRange, anchorDateOnly, dateOnlyFromIso, isCurrentOrUpcoming, rangesOverlap, type EventDates } from "./date";

export interface EventRecord extends EventDates {
  id: string;
  title: string;
  artist: string | null;
  description: string | null;
  freeformLocation: string;
  imageUrl: string | null;
  sensitivityTags: string[];
  sourceUrl: string | null;
}

type EventRow = Database["public"]["Tables"]["events"]["Row"];

function toEventRecord(row: EventRow): EventRecord {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    description: row.description,
    freeformLocation: row.freeform_location,
    imageUrl: row.image_url,
    openingDatetime: row.opening_datetime,
    runStartDate: row.run_start_date,
    runEndDate: row.run_end_date,
    sensitivityTags: row.sensitivity_tags,
    sourceUrl: row.source_url,
  };
}

// RLS already restricts anon reads to curation_status='approved' — see
// supabase/migrations/20260711171717_create_core_schema.sql.
export async function fetchApprovedEvents(client: SupabaseClient<Database>): Promise<EventRecord[]> {
  const { data, error } = await client.from("events").select("*");
  if (error) {
    throw new Error(`Failed to fetch events: ${error.message}`);
  }
  return (data ?? []).map(toEventRecord);
}

export function filterFamilyMode(events: EventRecord[], familyModeOn: boolean): EventRecord[] {
  return familyModeOn ? events.filter((e) => e.sensitivityTags.length === 0) : events;
}

export function filterByCity(events: EventRecord[], cityId: string): EventRecord[] {
  return events.filter((e) => deriveCityId(e.freeformLocation) === cityId);
}

export function eventsActiveInRange(events: EventRecord[], start: string, end: string): EventRecord[] {
  return events.filter((e) => {
    const range = activeRange(e);
    return range !== null && rangesOverlap(range.start, range.end, start, end);
  });
}

// The home page shows only what's visitable *today* — nothing not yet
// started, nothing already ended (stricter than isCurrentOrUpcoming's
// month-level retention check, which is still used by findNextEvent's
// lookahead below).
export function filterActiveToday(events: EventRecord[], todayStr: string): EventRecord[] {
  return eventsActiveInRange(events, todayStr, todayStr);
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

// Mutually exclusive by construction: an event with a confirmed opening
// night happening today is the priority "inauguración" tier; everything
// else active today (ongoing runs, or events with no confirmed opening at
// all) is an "expo actual". Caller must already have narrowed `events` to
// active-today (filterActiveToday) — this only splits, doesn't filter.
export function splitInauguracionesYExpos(events: EventRecord[], todayStr: string): InauguracionesYExpos {
  const inauguraciones: EventRecord[] = [];
  const exposActuales: EventRecord[] = [];
  for (const e of events) {
    const isInauguracion = e.openingDatetime !== null && dateOnlyFromIso(e.openingDatetime) === todayStr;
    (isInauguracion ? inauguraciones : exposActuales).push(e);
  }
  return {
    inauguraciones: sortByAnchorDesc(inauguraciones),
    exposActuales: sortByAnchorDesc(exposActuales),
  };
}

export interface CityCounts {
  inauguraciones: number;
  exposActuales: number;
}

// Per-city counts for the "Arte en todas partes" carousel — run over the
// full (not city-filtered) active-today + family-mode-filtered set, so a
// city with zero events today still doesn't need a live query to know that.
export function countByCity(events: EventRecord[], todayStr: string): Record<string, CityCounts> {
  const counts: Record<string, CityCounts> = {};
  for (const city of KNOWN_CITIES) {
    counts[city.id] = { inauguraciones: 0, exposActuales: 0 };
  }
  for (const e of events) {
    const cityId = deriveCityId(e.freeformLocation);
    if (!(cityId in counts)) continue; // "otro" isn't shown in the carousel
    const isInauguracion = e.openingDatetime !== null && dateOnlyFromIso(e.openingDatetime) === todayStr;
    counts[cityId][isInauguracion ? "inauguraciones" : "exposActuales"] += 1;
  }
  return counts;
}

// Cascading empty-state support: the earliest current-or-upcoming event
// (month-level, not "active today"), so an empty section/page can say "the
// next one is on X" instead of just "nothing."
export function findNextEvent(events: EventRecord[], todayStr: string): EventRecord | null {
  const upcoming = events
    .filter((e) => isCurrentOrUpcoming(e, todayStr))
    .map((e) => ({ e, anchor: anchorDateOnly(e) }))
    .filter((x): x is { e: EventRecord; anchor: string } => x.anchor !== null && x.anchor >= todayStr)
    .sort((a, b) => (a.anchor > b.anchor ? 1 : a.anchor < b.anchor ? -1 : 0));
  return upcoming[0]?.e ?? null;
}
