// City derivation: `events.region_id` (resolved by the curator at write
// time — see apps/curator/src/lib/locations.ts's matchRegionId) gives an
// exact region name for rows that have it; events.ts resolves that name
// against a city id here. Older/unmatched rows have no region_id, so we
// fall back to the original heuristic: take freeform_location's trailing
// comma-segment (same technique as the curator's own Chile/foreign-country
// check).
//
// No hardcoded whitelist: city ids are derived by slugifying whatever real
// comuna name reaches this file — never looked up against a fixed list.
// Real production gap (found 2026-07-17): a static ~15-entry KNOWN_CITIES
// array used to gate BOTH which cities were navigable AND which counted in
// countByCity — any event tagged to one of the (now 346, previously
// unseeded) other Chilean comunas silently fell into "otro" and was
// invisible everywhere in the UI, even though the curator had already
// correctly resolved and validated its region_id. Since the curator's own
// matchRegionId only ever assigns region_id against a name already present
// in the seeded `regions` table (all 346 official comunas as of
// 2026-07-17, see docs/region-discovery.md), any regionName reaching this
// file is already a real, validated Chilean comuna — trusting it directly
// is safe, no separate frontend whitelist needed.

import type { CityCounts } from "./events";

export interface City {
  id: string;
  name: string;
}

export const OTHER_CITY: City = { id: "otro", name: "Otro" };

export const DEFAULT_CITY_ID = "santiago";

// Fallback display names only — NOT a gate on which cities are navigable.
// Used only when a city has no event of its own right now to derive a
// properly-cased/accented name from (e.g. DEFAULT_CITY_ID on a fresh
// empty DB, or IP-geolocation matching in proxy.ts, which has no access
// to live event data at all). Real observed data (cityNamesFromEvents)
// always takes priority over this when both are available.
const SEED_CITY_NAMES: Record<string, string> = {
  santiago: "Santiago",
  valparaiso: "Valparaíso",
  concepcion: "Concepción",
  antofagasta: "Antofagasta",
  arica: "Arica",
};

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalize(text: string): string {
  return stripAccents(text.toLowerCase()).trim();
}

// A stable, deterministic id for any comuna/city name — spaces and
// punctuation become hyphens, e.g. "Puerto Varas" -> "puerto-varas",
// "Cabo de Hornos" -> "cabo-de-hornos".
export function slugify(name: string): string {
  return normalize(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// A region name straight from `regions.name` (via events.region_id) is
// already the exact, curator-validated comuna — always navigable, no
// whitelist to fall outside of.
export function cityIdFromRegionName(regionName: string): string {
  return slugify(regionName);
}

// Fallback for rows with no region_id (pre-migration rows, or a location
// whose text didn't match any seeded comuna at write time) — same
// trailing-comma-segment heuristic as before, no longer restricted to a
// hardcoded whitelist.
export function deriveCityId(freeformLocation: string): string {
  const segments = freeformLocation.split(",").map((s) => s.trim());
  const lastSegment = segments[segments.length - 1];
  return lastSegment ? slugify(lastSegment) : OTHER_CITY.id;
}

// `cityNames` is real data observed from actual events (built by
// events.ts's cityNamesFromEvents) — SEED_CITY_NAMES is only a fallback
// for a city with zero events of its own right now, and `id` itself is
// the last resort (an unrecognized/never-seen id still renders as
// *something* readable rather than crashing).
export function cityById(id: string, cityNames: Record<string, string>): City {
  if (id === OTHER_CITY.id) return OTHER_CITY;
  return { id, name: cityNames[id] ?? SEED_CITY_NAMES[id] ?? id };
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
//
// Built entirely from `cityCounts`' own keys, not a static list —
// `countByCity` (events.ts) only ever creates an entry for a city that
// has at least one real event right now, so this naturally offers
// exactly "the cities with something to show", whichever those are.
export function citiesWithEvents(
  cityCounts: Record<string, CityCounts>,
  cityNames: Record<string, string>,
  options: { excludeCityId?: string; alwaysIncludeCityId?: string } = {},
): City[] {
  const ids = new Set(Object.keys(cityCounts));
  if (options.alwaysIncludeCityId) ids.add(options.alwaysIncludeCityId);
  return [...ids]
    .filter((id) => id !== options.excludeCityId)
    .filter((id) => id === options.alwaysIncludeCityId || hasEvents(cityCounts[id]))
    .map((id) => cityById(id, cityNames))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

// Vercel's IP geolocation returns a plain city name (casing/accents not
// guaranteed to match exactly) — proxy.ts runs at the edge with no access
// to live event data, so this only ever confidently lands someone on one
// of the handful of well-established SEED_CITY_NAMES entries; anything
// else defaults to DEFAULT_CITY_ID rather than silently landing on an
// unrecognized/never-seen slug (Vercel's geolocation granularity for
// Chilean comunas below city-level is unreliable anyway).
export function matchCityByGeoName(geoCity: string | undefined): string {
  if (!geoCity) return DEFAULT_CITY_ID;
  const slug = slugify(geoCity);
  return slug in SEED_CITY_NAMES ? slug : DEFAULT_CITY_ID;
}
