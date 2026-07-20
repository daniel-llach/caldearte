import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveCityId,
  cityById,
  cityIdFromRegionName,
  citiesWithEvents,
  slugify,
  resolveDefaultCityId,
  matchesQuery,
  buildRegionMetaByCityId,
  groupCitiesByRegion,
  narrowCitiesByRegion,
  OTHER_CITY,
  DEFAULT_CITY_ID,
} from "./cities";
import type { CityCounts, RegionMeta } from "./events";

function regionMeta(overrides: Partial<RegionMeta> = {}): RegionMeta {
  return {
    id: "id",
    name: "Santiago",
    country: "Chile",
    adminRegionName: "Región Metropolitana de Santiago",
    adminRegionOrder: 7, // RM's real geographic slot: between V Valparaíso (6) and VI O'Higgins (8)
    adminRegionNumeral: "RM",
    ...overrides,
  };
}

test("slugify normalizes accents, case, and punctuation into a hyphenated id", () => {
  assert.equal(slugify("Valparaíso"), "valparaiso");
  assert.equal(slugify("VALPARAISO"), "valparaiso");
  assert.equal(slugify("Puerto Varas"), "puerto-varas");
  assert.equal(slugify("Cabo de Hornos"), "cabo-de-hornos");
});

test("deriveCityId matches the trailing comma-segment, slugified", () => {
  assert.equal(deriveCityId("Sala El Farol, Valparaíso"), "valparaiso");
  assert.equal(deriveCityId("Balmaceda Arte Joven, Concepción"), "concepcion");
  assert.equal(deriveCityId("Centro Cultural La Moneda, Santiago"), "santiago");
});

test("deriveCityId is accent/case-insensitive", () => {
  assert.equal(deriveCityId("Galería X, valparaiso"), "valparaiso");
  assert.equal(deriveCityId("Galería X, VALPARAÍSO"), "valparaiso");
});

test("deriveCityId: any real, previously-unseeded comuna is still navigable, not just a fixed list (real gap, fixed 2026-07-17)", () => {
  assert.equal(deriveCityId("Plaza Central, Rancagua"), "rancagua");
  assert.equal(deriveCityId("Galería NAC, Las Condes"), "las-condes");
});

test("deriveCityId falls back to 'otro' only when there's no trailing segment at all", () => {
  assert.equal(deriveCityId("Un lugar sin coma"), "un-lugar-sin-coma");
  assert.equal(deriveCityId(""), "otro");
});

test("cityIdFromRegionName always succeeds — no whitelist to fall outside of, since a regionName reaching this file is already curator-validated", () => {
  assert.equal(cityIdFromRegionName("Valparaíso"), "valparaiso");
  assert.equal(cityIdFromRegionName("VALPARAISO"), "valparaiso");
  assert.equal(cityIdFromRegionName("Rancagua"), "rancagua");
  assert.equal(cityIdFromRegionName("Las Condes"), "las-condes");
});

test("cityById prefers real observed cityNames, falls back to a seed name, then the id itself", () => {
  assert.equal(cityById("nope", {}).name, "nope");
  assert.equal(cityById("santiago", {}).name, "Santiago"); // seed fallback, no observed data
  assert.equal(cityById("santiago", { santiago: "Santiago (real)" }).name, "Santiago (real)"); // observed wins
  assert.deepEqual(cityById(OTHER_CITY.id, {}), OTHER_CITY);
});

test("citiesWithEvents drops a city with zero inauguraciones and zero exposActuales — 'muestra lo que hay'", () => {
  const counts: Record<string, CityCounts> = {
    santiago: { inauguraciones: 1, exposActuales: 0 },
    valparaiso: { inauguraciones: 0, exposActuales: 0 },
    concepcion: { inauguraciones: 0, exposActuales: 3 },
  };
  const result = citiesWithEvents(counts, {}).map((c) => c.id);
  assert.ok(result.includes("santiago"));
  assert.ok(result.includes("concepcion"));
  assert.ok(!result.includes("valparaiso"));
});

test("citiesWithEvents is built entirely from cityCounts' own keys — any comuna with real events is offered, not just a fixed list", () => {
  const counts: Record<string, CityCounts> = { "las-condes": { inauguraciones: 0, exposActuales: 2 } };
  const result = citiesWithEvents(counts, { "las-condes": "Las Condes" });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], { id: "las-condes", name: "Las Condes" });
});

test("citiesWithEvents: an empty counts map offers nothing", () => {
  const result = citiesWithEvents({}, {});
  assert.equal(result.length, 0);
});

test("citiesWithEvents: excludeCityId always drops that city, even if it has events (the carousel's 'don't show the city you're already viewing' case)", () => {
  const counts: Record<string, CityCounts> = { santiago: { inauguraciones: 2, exposActuales: 0 } };
  const result = citiesWithEvents(counts, {}, { excludeCityId: "santiago" });
  assert.ok(!result.some((c) => c.id === "santiago"));
});

test("citiesWithEvents: alwaysIncludeCityId keeps that city even at zero counts (the picker's 'don't make my own city vanish' safety net)", () => {
  const result = citiesWithEvents({}, {}, { alwaysIncludeCityId: "santiago" });
  assert.ok(result.some((c) => c.id === "santiago"));
  assert.equal(result.length, 1); // every other zero-count city still dropped
});

test("resolveDefaultCityId: own comuna wins when it's real and has events today", () => {
  const metaByCityId = buildRegionMetaByCityId([regionMeta({ name: "Las Condes" })]);
  const cityCounts: Record<string, CityCounts> = { "las-condes": { inauguraciones: 1, exposActuales: 0 } };
  assert.equal(resolveDefaultCityId("Las Condes", "CL", metaByCityId, cityCounts), "las-condes");
});

test("resolveDefaultCityId: own comuna has no events today -> falls back to a comuna in the same región that does", () => {
  const metaByCityId = buildRegionMetaByCityId([
    regionMeta({ name: "Las Condes", adminRegionName: "Región Metropolitana de Santiago" }),
    regionMeta({ name: "Santiago", adminRegionName: "Región Metropolitana de Santiago" }),
  ]);
  const cityCounts: Record<string, CityCounts> = { santiago: { inauguraciones: 0, exposActuales: 2 } };
  assert.equal(resolveDefaultCityId("Las Condes", "CL", metaByCityId, cityCounts), "santiago");
});

test("resolveDefaultCityId: unrecognized geo city string falls back to Santiago", () => {
  assert.equal(resolveDefaultCityId("Nonexistent Place", "CL", new Map(), {}), DEFAULT_CITY_ID);
});

test("resolveDefaultCityId: country outside Chile falls back to Santiago immediately, without inspecting the city at all", () => {
  const metaByCityId = buildRegionMetaByCityId([regionMeta({ name: "Santiago" })]);
  const cityCounts: Record<string, CityCounts> = { santiago: { inauguraciones: 1, exposActuales: 0 } };
  // Even though "Santiago" would otherwise match with events, a non-CL
  // country short-circuits before any city matching happens.
  assert.equal(resolveDefaultCityId("Santiago", "AR", metaByCityId, cityCounts), DEFAULT_CITY_ID);
});

test("resolveDefaultCityId: missing geo headers (e.g. localhost) fall back to Santiago", () => {
  assert.equal(resolveDefaultCityId(undefined, undefined, new Map(), {}), DEFAULT_CITY_ID);
});

test("resolveDefaultCityId: own comuna has no events and no región-mate has events either -> Santiago", () => {
  const metaByCityId = buildRegionMetaByCityId([regionMeta({ name: "Las Condes", adminRegionName: "Región Metropolitana de Santiago" })]);
  assert.equal(resolveDefaultCityId("Las Condes", "CL", metaByCityId, {}), DEFAULT_CITY_ID);
});

test("matchesQuery is accent/case-insensitive substring matching", () => {
  assert.ok(matchesQuery("Valparaíso", "valpara"));
  assert.ok(matchesQuery("Valparaíso", "VALPARAISO"));
  assert.ok(!matchesQuery("Valparaíso", "santiago"));
});

test("buildRegionMetaByCityId keys by the same slugified id City.id already uses", () => {
  const map = buildRegionMetaByCityId([regionMeta({ name: "Las Condes" })]);
  assert.ok(map.has("las-condes"));
  assert.equal(map.get("las-condes")?.name, "Las Condes");
});

test("groupCitiesByRegion groups by country then macro-región (geographic order), comunas alphabetical within each región", () => {
  const meta = [
    regionMeta({ name: "Valparaíso", adminRegionName: "Valparaíso", adminRegionOrder: 6 }),
    regionMeta({ name: "Arica", adminRegionName: "Arica y Parinacota", adminRegionOrder: 1 }),
    regionMeta({ name: "Vitacura", adminRegionName: "Región Metropolitana de Santiago", adminRegionOrder: 16 }),
    regionMeta({ name: "Las Condes", adminRegionName: "Región Metropolitana de Santiago", adminRegionOrder: 16 }),
  ];
  const metaByCityId = buildRegionMetaByCityId(meta);
  const cities = [
    { id: "vitacura", name: "Vitacura" },
    { id: "arica", name: "Arica" },
    { id: "las-condes", name: "Las Condes" },
    { id: "valparaiso", name: "Valparaíso" },
  ];
  const groups = groupCitiesByRegion(cities, metaByCityId);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].country, "Chile");
  assert.deepEqual(
    groups[0].regions.map((r) => r.adminRegionName),
    ["Arica y Parinacota", "Valparaíso", "Región Metropolitana de Santiago"],
    "regions come out in geographic north-to-south order, not insertion order",
  );
  const rm = groups[0].regions.find((r) => r.adminRegionName === "Región Metropolitana de Santiago")!;
  assert.deepEqual(
    rm.cities.map((c) => c.name),
    ["Las Condes", "Vitacura"],
    "comunas alphabetical within their región",
  );
});

test("groupCitiesByRegion passes adminRegionNumeral through onto each región group — used for the city picker's numeral pill", () => {
  const metaByCityId = buildRegionMetaByCityId([regionMeta({ name: "Arica", adminRegionName: "Arica y Parinacota", adminRegionOrder: 1, adminRegionNumeral: "XV" })]);
  const groups = groupCitiesByRegion([{ id: "arica", name: "Arica" }], metaByCityId);
  assert.equal(groups[0].regions[0].adminRegionNumeral, "XV");
});

test("groupCitiesByRegion puts comunas with no admin_region_name into an 'ungrouped' bucket, not dropped", () => {
  const metaByCityId = buildRegionMetaByCityId([regionMeta({ name: "Nueva Comuna", adminRegionName: null, adminRegionOrder: null })]);
  const groups = groupCitiesByRegion([{ id: "nueva-comuna", name: "Nueva Comuna" }], metaByCityId);
  assert.equal(groups[0].regions.length, 0);
  assert.deepEqual(groups[0].ungrouped, [{ id: "nueva-comuna", name: "Nueva Comuna" }]);
});

test("groupCitiesByRegion groups a comuna with no RegionMeta at all into a fallback 'otro' country bucket", () => {
  const groups = groupCitiesByRegion([{ id: "unknown", name: "Unknown" }], new Map());
  assert.equal(groups.length, 1);
  assert.equal(groups[0].country, "otro");
  assert.deepEqual(groups[0].ungrouped, [{ id: "unknown", name: "Unknown" }]);
});

// narrowCitiesByRegion — real gap found 2026-07-20: with all 346 comunas
// seeded, "Arte en todas partes" scrolled far too long. RM sits at
// adminRegionOrder 7 (see regionMeta's own comment); V Valparaíso is 6,
// VI O'Higgins is 8 — used below to test the "widen to neighbors" case.
function city(name: string): { id: string; name: string } {
  return { id: slugify(name), name };
}

function countsFor(cities: { id: string; name: string }[], eventsEach = 1): Record<string, CityCounts> {
  return Object.fromEntries(cities.map((c) => [c.id, { inauguraciones: eventsEach, exposActuales: 0 }]));
}

test("narrowCitiesByRegion keeps only the current comuna's own admin región when that alone already reaches the minimum", () => {
  const rmCities = ["Las Condes", "Vitacura", "Ñuñoa", "Providencia", "Maipú", "Puente Alto"].map(city);
  const valpoCity = city("Viña del Mar");
  const meta = buildRegionMetaByCityId([
    regionMeta({ name: "Santiago" }), // the current city itself — adminRegionOrder 7 (RM), needed to resolve currentOrder
    ...rmCities.map((c) => regionMeta({ name: c.name })), // adminRegionOrder 7 (RM), from the default
    regionMeta({ name: valpoCity.name, adminRegionName: "Valparaíso", adminRegionOrder: 6 }),
  ]);
  const cities = [...rmCities, valpoCity];
  const result = narrowCitiesByRegion(cities, meta, "santiago", countsFor(cities));
  assert.deepEqual(
    result.map((c) => c.id),
    rmCities.map((c) => c.id).sort((a, b) => a.localeCompare(b, "es")),
    "Valparaíso never appears — RM alone already has 6",
  );
});

test("narrowCitiesByRegion widens to the nearest neighboring región when the current one alone doesn't reach the minimum", () => {
  const rmCities = ["Las Condes", "Vitacura"].map(city); // only 2, below the min of 6
  const valpoCities = ["Viña del Mar", "Valparaíso", "Quilpué", "Concón"].map(city); // order 6, adjacent
  const ohigginsCities = ["Rancagua", "Rengo"].map(city); // order 8, also adjacent
  const araucaniaCity = city("Temuco"); // order much further south — never pulled in
  const meta = buildRegionMetaByCityId([
    regionMeta({ name: "Santiago" }), // the current city itself — adminRegionOrder 7 (RM), needed to resolve currentOrder
    ...rmCities.map((c) => regionMeta({ name: c.name })),
    ...valpoCities.map((c) => regionMeta({ name: c.name, adminRegionName: "Valparaíso", adminRegionOrder: 6 })),
    ...ohigginsCities.map((c) => regionMeta({ name: c.name, adminRegionName: "O'Higgins", adminRegionOrder: 8 })),
    regionMeta({ name: araucaniaCity.name, adminRegionName: "Araucanía", adminRegionOrder: 10 }),
  ]);
  const cities = [...rmCities, ...valpoCities, ...ohigginsCities, araucaniaCity];
  const result = narrowCitiesByRegion(cities, meta, "santiago", countsFor(cities));

  assert.ok(result.length >= 6, "reaches the minimum by widening one step (order 7 ± 1 = regions 6 and 8)");
  assert.ok(!result.some((c) => c.id === araucaniaCity.id), "a further-away región is never pulled in once the minimum is already met");
});

test("narrowCitiesByRegion trims down to the busiest comunas (by total events) when the qualifying pool exceeds the maximum, then re-sorts alphabetically", () => {
  // 11 candidates; "Recoleta" is first alphabetically-irrelevant to its
  // count (deliberately given the LOWEST positional/alphabetical
  // standing among a hand-picked low scorer) so surviving the trim can
  // only be explained by its count, not by name or array order.
  const names = ["Las Condes", "Vitacura", "Ñuñoa", "Providencia", "Maipú", "Puente Alto", "San Bernardo", "La Florida", "Santiago", "Peñalolén", "Recoleta"];
  const cities = names.map(city);
  const meta = buildRegionMetaByCityId(cities.map((c) => regionMeta({ name: c.name })));
  // Every comuna gets 1 event except "Recoleta" (99, the clear winner) and
  // "Vitacura" (0, the clear loser) — Vitacura is the one that must be
  // dropped to go from 11 down to the max of 10.
  const counts: Record<string, CityCounts> = Object.fromEntries(
    cities.map((c) => [c.id, { inauguraciones: c.name === "Recoleta" ? 99 : c.name === "Vitacura" ? 0 : 1, exposActuales: 0 }]),
  );
  const result = narrowCitiesByRegion(cities, meta, "santiago", counts, { min: 6, max: 10 });
  const expectedNames = names.filter((n) => n !== "Vitacura").sort((a, b) => a.localeCompare(b, "es"));
  assert.deepEqual(result.map((c) => c.name), expectedNames);
});

test("narrowCitiesByRegion doesn't narrow at all when the current comuna's admin región is unknown", () => {
  const cities = ["A", "B", "C"].map(city);
  const result = narrowCitiesByRegion(cities, new Map(), "santiago", countsFor(cities));
  assert.deepEqual(result, cities, "no adminRegionOrder for the current city -> safe fallback, unchanged list");
});
