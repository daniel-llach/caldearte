import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveCityId, cityById, cityIdFromRegionName, citiesWithEvents, OTHER_CITY } from "./cities";
import type { CityCounts } from "./events";

test("deriveCityId matches the trailing comma-segment against known cities", () => {
  assert.equal(deriveCityId("Sala El Farol, Valparaíso"), "valparaiso");
  assert.equal(deriveCityId("Balmaceda Arte Joven, Concepción"), "concepcion");
  assert.equal(deriveCityId("Centro Cultural La Moneda, Santiago"), "santiago");
});

test("deriveCityId is accent/case-insensitive", () => {
  assert.equal(deriveCityId("Galería X, valparaiso"), "valparaiso");
  assert.equal(deriveCityId("Galería X, VALPARAÍSO"), "valparaiso");
});

test("deriveCityId falls back to 'otro' for an unrecognized location", () => {
  assert.equal(deriveCityId("Plaza Central, Rancagua"), "otro");
  assert.equal(deriveCityId("Un lugar sin coma"), "otro");
});

test("cityIdFromRegionName matches an exact region name, accent/case-insensitive, and returns null otherwise", () => {
  assert.equal(cityIdFromRegionName("Valparaíso"), "valparaiso");
  assert.equal(cityIdFromRegionName("VALPARAISO"), "valparaiso");
  assert.equal(cityIdFromRegionName("Rancagua"), null);
});

test("cityById returns OTHER_CITY for an unknown id", () => {
  assert.deepEqual(cityById("nope"), OTHER_CITY);
  assert.equal(cityById("santiago").name, "Santiago");
});

test("citiesWithEvents drops a city with zero inauguraciones and zero exposActuales — 'muestra lo que hay'", () => {
  const counts: Record<string, CityCounts> = {
    santiago: { inauguraciones: 1, exposActuales: 0 },
    valparaiso: { inauguraciones: 0, exposActuales: 0 },
    concepcion: { inauguraciones: 0, exposActuales: 3 },
  };
  const result = citiesWithEvents(counts).map((c) => c.id);
  assert.ok(result.includes("santiago"));
  assert.ok(result.includes("concepcion"));
  assert.ok(!result.includes("valparaiso"));
});

test("citiesWithEvents treats a city missing from the counts map as zero (dropped), not as an error", () => {
  const result = citiesWithEvents({});
  assert.equal(result.length, 0);
});

test("citiesWithEvents: excludeCityId always drops that city, even if it has events (the carousel's 'don't show the city you're already viewing' case)", () => {
  const counts: Record<string, CityCounts> = { santiago: { inauguraciones: 2, exposActuales: 0 } };
  const result = citiesWithEvents(counts, { excludeCityId: "santiago" });
  assert.ok(!result.some((c) => c.id === "santiago"));
});

test("citiesWithEvents: alwaysIncludeCityId keeps that city even at zero counts (the picker's 'don't make my own city vanish' safety net)", () => {
  const result = citiesWithEvents({}, { alwaysIncludeCityId: "santiago" });
  assert.ok(result.some((c) => c.id === "santiago"));
  assert.equal(result.length, 1); // every other zero-count city still dropped
});
