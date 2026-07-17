import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveCityId,
  cityById,
  cityIdFromRegionName,
  citiesWithEvents,
  slugify,
  matchCityByGeoName,
  matchesQuery,
  buildRegionMetaByCityId,
  groupCitiesByRegion,
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

test("matchCityByGeoName only confidently matches a well-established seed city — proxy.ts has no live event data to check against", () => {
  assert.equal(matchCityByGeoName("Santiago"), "santiago");
  assert.equal(matchCityByGeoName("VALPARAISO"), "valparaiso");
  assert.equal(matchCityByGeoName("Las Condes"), DEFAULT_CITY_ID, "a real but non-seed comuna still defaults safely");
  assert.equal(matchCityByGeoName(undefined), DEFAULT_CITY_ID);
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
