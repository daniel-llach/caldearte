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
  assert.equal(esCL.headerSummary(0, 0), "Descubre el arte que hay en");
});

test("headerSummary abbreviates to inau(s)/expo(s) when abbreviate is true — mobile header, less horizontal room", () => {
  assert.equal(esCL.headerSummary(1, 2, true), "1 inau y 2 expos que visitar en");
  assert.equal(esCL.headerSummary(3, 0, true), "3 inaus que visitar en");
  assert.equal(esCL.headerSummary(0, 1, true), "1 expo que visitar en");
});

test("todaySuffix/thisWeekSuffix — Header's Día/Semana dropdown copy", () => {
  assert.equal(esCL.todaySuffix, "hoy");
  assert.equal(esCL.thisWeekSuffix, "esta semana");
});

test("emptyWithNextEvent takes the mode's suffix as a parameter, so one function serves both Día and Semana", () => {
  assert.equal(
    esCL.emptyWithNextEvent("Santiago", esCL.todaySuffix, "14 jul", "Muestra X"),
    "No hay nada que mostrar hoy en Santiago. La próxima es el 14 jul — Muestra X.",
  );
  assert.equal(
    esCL.emptyWithNextEvent("Santiago", esCL.thisWeekSuffix, "14 jul", "Muestra X"),
    "No hay nada que mostrar esta semana en Santiago. La próxima es el 14 jul — Muestra X.",
  );
});
