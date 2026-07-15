// V1 city derivation: events have no structured city column, only
// `freeform_location` free text. We take the trailing comma-segment
// (same technique as apps/curator/src/lib/locations.ts's Chile/foreign-
// country check) and match it against the known, hardcoded region list —
// no live query, `regions` has no public RLS policy. Unmatched locations
// fall into "otro". A real `city`/`region_id` column is a possible later
// backend change, not part of this build.

export interface City {
  id: string;
  name: string;
}

// Matches supabase/migrations/20260711190000_seed_initial_chile_regions.sql.
export const KNOWN_CITIES: City[] = [
  { id: "santiago", name: "Santiago" },
  { id: "valparaiso", name: "Valparaíso" },
  { id: "concepcion", name: "Concepción" },
  { id: "antofagasta", name: "Antofagasta" },
  { id: "arica", name: "Arica" },
];

export const OTHER_CITY: City = { id: "otro", name: "Otro" };

export const DEFAULT_CITY_ID = "santiago";

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalize(text: string): string {
  return stripAccents(text.toLowerCase()).trim();
}

// Returns a known city id, or OTHER_CITY.id when the trailing segment of
// freeform_location doesn't match any known city.
export function deriveCityId(freeformLocation: string): string {
  const segments = freeformLocation.split(",").map((s) => normalize(s));
  const lastSegment = segments[segments.length - 1] ?? "";

  const match = KNOWN_CITIES.find((city) => normalize(city.name) === lastSegment);
  return match?.id ?? OTHER_CITY.id;
}

export function cityById(id: string): City {
  return KNOWN_CITIES.find((c) => c.id === id) ?? OTHER_CITY;
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
