import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeLocation, isLikelySameTitle } from "./event-filters.js";

test("normalizeLocation collapses a trailing ', Chile'/region suffix — real bug, found 2026-07-20: the same festival got inserted 3x in one run because 'Valparaíso, Chile' vs 'Valparaíso' produced different dedup fingerprints", () => {
  assert.equal(normalizeLocation("Valparaíso, Chile"), normalizeLocation("Valparaíso"));
  assert.equal(normalizeLocation("Valparaíso, Chile"), "valparaiso");
});

test("normalizeLocation only keeps the comuna/ciudad — a venue name in front of the comma doesn't leak in", () => {
  assert.equal(normalizeLocation("Mercado Puerto, Valparaíso"), "mercado puerto");
});

test("normalizeLocation is accent/case-insensitive, same as normalizeTitle", () => {
  assert.equal(normalizeLocation("COLBÚN"), normalizeLocation("colbun"));
});

// Real production bug, found 2026-07-22: insertCandidates computes this
// for every candidate, not just approved ones — a rejected candidate can
// legitimately have a null location, and this crashed the whole unit.
test("normalizeLocation returns an empty string for null/undefined rather than crashing", () => {
  assert.equal(normalizeLocation(null), "");
  assert.equal(normalizeLocation(undefined), "");
});

test("isLikelySameTitle flags real near-duplicate wording — two sources naming the same exhibition differently", () => {
  assert.equal(isLikelySameTitle("Inauguración de la muestra 'Raíces del Sur'", "Raíces del Sur: exposición fotográfica"), true);
});

test("isLikelySameTitle does NOT flag two different exhibitions that just share generic art-event vocabulary and a comuna name — a single shared word isn't enough", () => {
  assert.equal(isLikelySameTitle("Exposición de pintura en Copiapó", "Exposición de escultura en Copiapó"), false);
});

test("isLikelySameTitle requires real word overlap, not just a shared short/common word", () => {
  assert.equal(isLikelySameTitle("El color y la forma", "El agua y la tierra"), false);
});

test("isLikelySameTitle: the exact real trio from the ARTEPUERTO audit finding is NOT flagged by title alone — confirms that bug was actually a location-string-normalization gap (fixed separately), not something title similarity could or should paper over", () => {
  assert.equal(isLikelySameTitle("ARTEPUERTO 2026", "ARTEPUERTO+CASAPLAN"), false);
  assert.equal(isLikelySameTitle("ARTEPUERTO 2026", "Muestra gráfica en casa Bachmann - ARTEPUERTO 2026"), false);
});

test("isLikelySameTitle: identical titles are trivially similar", () => {
  assert.equal(isLikelySameTitle("Dejar Atrás", "Dejar Atrás"), true);
});
