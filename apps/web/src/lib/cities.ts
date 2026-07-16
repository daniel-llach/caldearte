// City derivation: `events.region_id` (resolved by the curator at write
// time — see apps/curator/src/lib/locations.ts's matchRegionId) gives an
// exact region name for rows that have it; events.ts resolves that name
// against KNOWN_CITIES here. Older/unmatched rows have no region_id, so we
// fall back to the original heuristic: take freeform_location's trailing
// comma-segment (same technique as the curator's own Chile/foreign-country
// check) and match it against the same known, hardcoded list. Unmatched
// locations fall into "otro".

// Type-only import from events.ts, which itself imports values from this
// file — a runtime import here would be circular, but `import type` is
// erased at compile time so there's no actual cycle.
import type { CityCounts } from "./events";

export interface City {
  id: string;
  name: string;
}

// Originally matched supabase/migrations/20260711190000_seed_initial_chile_regions.sql
// 1:1 (5 cities). Since then, real Gran Santiago comunas have been added
// directly to `regions` as their own independent search units (a pilot for
// the eventual ~346-comuna rollout, docs/region-discovery.md) — this list
// has to be updated by hand to match whenever a new region row is added,
// same "hardcoded duplicate, kept in sync manually" tradeoff as before.
export const KNOWN_CITIES: City[] = [
  { id: "santiago", name: "Santiago" },
  { id: "valparaiso", name: "Valparaíso" },
  { id: "concepcion", name: "Concepción" },
  { id: "antofagasta", name: "Antofagasta" },
  { id: "arica", name: "Arica" },
  { id: "providencia", name: "Providencia" },
  { id: "nunoa", name: "Ñuñoa" },
  { id: "recoleta", name: "Recoleta" },
  { id: "la-reina", name: "La Reina" },
  { id: "independencia", name: "Independencia" },
  { id: "puente-alto", name: "Puente Alto" },
  { id: "la-florida", name: "La Florida" },
  { id: "maipu", name: "Maipú" },
  { id: "renca", name: "Renca" },
  { id: "frutillar", name: "Frutillar" },
];

export const OTHER_CITY: City = { id: "otro", name: "Otro" };

export const DEFAULT_CITY_ID = "santiago";

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalize(text: string): string {
  return stripAccents(text.toLowerCase()).trim();
}

function matchCityName(name: string): string | null {
  const normalized = normalize(name);
  const match = KNOWN_CITIES.find((city) => normalize(city.name) === normalized);
  return match?.id ?? null;
}

// Returns a known city id, or OTHER_CITY.id when the trailing segment of
// freeform_location doesn't match any known city.
export function deriveCityId(freeformLocation: string): string {
  const segments = freeformLocation.split(",").map((s) => s.trim());
  const lastSegment = segments[segments.length - 1] ?? "";
  return matchCityName(lastSegment) ?? OTHER_CITY.id;
}

// A region name straight from `regions.name` (via events.region_id) is
// already the exact city — no comma-segment guessing needed. Returns null
// (caller falls back to deriveCityId) when the name isn't one of today's 5
// known cities, e.g. a region added later that isn't in KNOWN_CITIES yet.
export function cityIdFromRegionName(regionName: string): string | null {
  return matchCityName(regionName);
}

export function cityById(id: string): City {
  return KNOWN_CITIES.find((c) => c.id === id) ?? OTHER_CITY;
}

function hasEvents(counts: CityCounts | undefined): boolean {
  return (counts?.inauguraciones ?? 0) > 0 || (counts?.exposActuales ?? 0) > 0;
}

// "Muestra lo que hay": a city with nothing to show today isn't a real
// destination — filtered out of both the city picker and the "Arte en
// todas partes" carousel. `alwaysIncludeCityId` (the currently-selected
// city, in the picker's case) is a UX safety net, not a data override — a
// city always passes if it's you, even at zero, so opening the picker
// while viewing a currently-empty city never makes your own city vanish.
export function citiesWithEvents(
  cityCounts: Record<string, CityCounts>,
  options: { excludeCityId?: string; alwaysIncludeCityId?: string } = {},
): City[] {
  return KNOWN_CITIES.filter((c) => {
    if (c.id === options.excludeCityId) return false;
    if (c.id === options.alwaysIncludeCityId) return true;
    return hasEvents(cityCounts[c.id]);
  });
}

// Vercel's IP geolocation returns a plain city name (casing/accents not
// guaranteed to match our list exactly) — match leniently, default to
// DEFAULT_CITY_ID when there's no match (also covers localhost in dev,
// where geolocation() returns no city at all — see docs/architecture.md's
// documented limitation).
export function matchCityByGeoName(geoCity: string | undefined): string {
  if (!geoCity) return DEFAULT_CITY_ID;
  const normalized = normalize(geoCity);
  const match = KNOWN_CITIES.find((city) => normalize(city.name) === normalized);
  return match?.id ?? DEFAULT_CITY_ID;
}
