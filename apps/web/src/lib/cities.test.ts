import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveCityId, cityById, OTHER_CITY } from "./cities";

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

test("cityById returns OTHER_CITY for an unknown id", () => {
  assert.deepEqual(cityById("nope"), OTHER_CITY);
  assert.equal(cityById("santiago").name, "Santiago");
});
