import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveCityId, cityById, cityIdFromRegionName, citiesWithEvents, slugify, matchCityByGeoName, OTHER_CITY, DEFAULT_CITY_ID } from "./cities";
import type { CityCounts } from "./events";

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
