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

import type { CityCounts, RegionMeta } from "./events";

export interface City {
  id: string;
  name: string;
}

export const OTHER_CITY: City = { id: "otro", name: "Otro" };

export const DEFAULT_CITY_ID = "santiago";

// Fallback display names only — NOT a gate on which cities are navigable.
// Used only when a city has no event of its own right now to derive a
// properly-cased/accented name from (e.g. DEFAULT_CITY_ID on a fresh empty
// DB). Real observed data (cityNamesFromEvents) always takes priority over
// this when both are available.
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

// Accent/case-insensitive substring match — same normalization slugify
// already uses, exported so the city picker's search box filters
// consistently with how ids themselves are derived (typing "valparaiso"
// matches "Valparaíso" either way).
export function matchesQuery(text: string, query: string): boolean {
  return normalize(text).includes(normalize(query));
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

// Default-city resolution for a first-time visitor (no CITY_COOKIE yet),
// from Vercel's IP geolocation. Runs in page.tsx (a server component that
// already has live `regions`/`cityCounts` data), NOT the edge proxy —
// there's no whitelist here, any of the 346 real seeded comunas is a
// valid match, same "trust the real data" philosophy as the rest of this
// file. Real production gap this replaces (found 2026-07-17): the
// previous edge-only version (`matchCityByGeoName`, since removed) only
// recognized a fixed 5-city allowlist and had no country check at all —
// a visitor in any of the other ~341 comunas, or genuinely outside Chile,
// both silently landed on Santiago with no distinction between the two.
//
// Three tiers, in order: (1) outside Chile -> Santiago immediately, no
// point matching a city string that isn't Chilean; (2) own comuna, if
// it's real AND has events right now; (3) any other comuna in the same
// admin región that has events right now ("una cercana de la misma
// región"); (4) Santiago, if nothing above matched.
export function resolveDefaultCityId(
  geoCity: string | undefined,
  geoCountry: string | undefined,
  metaByCityId: Map<string, RegionMeta>,
  cityCounts: Record<string, CityCounts>,
): string {
  if (geoCountry && geoCountry !== "CL") return DEFAULT_CITY_ID;
  if (!geoCity) return DEFAULT_CITY_ID;

  const ownId = slugify(geoCity);
  const ownMeta = metaByCityId.get(ownId);
  if (ownMeta && hasEvents(cityCounts[ownId])) return ownId;

  if (ownMeta?.adminRegionName) {
    const regionMate = [...metaByCityId.entries()].find(
      ([id, meta]) => meta.adminRegionName === ownMeta.adminRegionName && hasEvents(cityCounts[id]),
    );
    if (regionMate) return regionMate[0];
  }

  return DEFAULT_CITY_ID;
}

// Keyed by the same slugified id every City already uses (cityIdFromRegionName),
// so it joins directly against citiesWithEvents' output with no extra
// lookup step.
export function buildRegionMetaByCityId(regions: RegionMeta[]): Map<string, RegionMeta> {
  return new Map(regions.map((r) => [slugify(r.name), r]));
}

export interface AdminRegionGroup {
  adminRegionName: string;
  adminRegionOrder: number;
  adminRegionNumeral: string | null;
  cities: City[];
}

export interface CountryGroup {
  country: string;
  regions: AdminRegionGroup[]; // sorted by adminRegionOrder, ascending (north to south in Chile)
  ungrouped: City[]; // comunas with no admin_region_name yet — see the migration's header comment
}

// City picker grouping: country -> macro-región (geographically ordered)
// -> comuna (alphabetical). Built ONLY from the `cities` array passed in
// (already "has events"-filtered, e.g. citiesWithEvents' output) — a
// región with zero qualifying comunas simply never gets an entry, which
// is exactly "only show regions with comunas that have events", for free,
// with no separate filtering pass. Grouping first by `country` (a real
// column already on every row) is the multi-country scalability hook:
// a second country's comunas fall into their own CountryGroup automatically,
// no code change needed when that day comes.
export function groupCitiesByRegion(cities: City[], metaByCityId: Map<string, RegionMeta>): CountryGroup[] {
  const byCountry = new Map<string, CountryGroup>();

  for (const city of cities) {
    const meta = metaByCityId.get(city.id);
    const country = meta?.country ?? "otro";
    if (!byCountry.has(country)) byCountry.set(country, { country, regions: [], ungrouped: [] });
    const group = byCountry.get(country)!;

    if (!meta || meta.adminRegionName === null || meta.adminRegionOrder === null) {
      group.ungrouped.push(city);
      continue;
    }

    let region = group.regions.find((r) => r.adminRegionName === meta.adminRegionName);
    if (!region) {
      region = {
        adminRegionName: meta.adminRegionName,
        adminRegionOrder: meta.adminRegionOrder,
        adminRegionNumeral: meta.adminRegionNumeral,
        cities: [],
      };
      group.regions.push(region);
    }
    region.cities.push(city);
  }

  for (const group of byCountry.values()) {
    group.regions.sort((a, b) => a.adminRegionOrder - b.adminRegionOrder);
    for (const region of group.regions) {
      region.cities.sort((a, b) => a.name.localeCompare(b.name, "es"));
    }
    group.ungrouped.sort((a, b) => a.name.localeCompare(b.name, "es"));
  }

  return [...byCountry.values()];
}
