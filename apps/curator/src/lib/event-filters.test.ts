import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeLocation } from "./event-filters.js";

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
