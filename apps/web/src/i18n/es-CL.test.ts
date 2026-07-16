import { test } from "node:test";
import assert from "node:assert/strict";
import { esCL } from "./es-CL.js";

test("cityStats shows only the nonzero part — 'muestra lo que hay'", () => {
  assert.equal(esCL.cityStats(0, 2), "2 exposiciones");
  assert.equal(esCL.cityStats(3, 0), "3 inauguraciones");
  assert.equal(esCL.cityStats(1, 1), "1 inauguración · 1 exposición");
  assert.equal(esCL.cityStats(0, 0), "");
});

test("headerSummary shows only the nonzero part, falls back to a countless phrase when both are zero", () => {
  assert.equal(esCL.headerSummary(0, 2), "2 exposiciones que visitar en");
  assert.equal(esCL.headerSummary(3, 0), "3 inauguraciones que visitar en");
  assert.equal(esCL.headerSummary(2, 5), "2 inauguraciones y 5 exposiciones que visitar en");
  assert.equal(esCL.headerSummary(0, 0), "Descubrí el arte que hay en");
});
