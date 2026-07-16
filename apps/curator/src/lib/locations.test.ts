import { test } from "node:test";
import assert from "node:assert/strict";
import { matchRegionId } from "./locations.js";

const REGIONS = [
  { id: "r-santiago", name: "Santiago" },
  { id: "r-valpo", name: "Valparaíso" },
  { id: "r-concepcion", name: "Concepción" },
  { id: "r-arica", name: "Arica" },
];

test("matchRegionId matches the trailing comma-segment, accent/case-insensitive", () => {
  assert.equal(matchRegionId("GAM, Santiago", REGIONS), "r-santiago");
  assert.equal(matchRegionId("Plaza Sotomayor, valparaiso", REGIONS), "r-valpo");
  assert.equal(matchRegionId("SANTIAGO", REGIONS), "r-santiago");
});

test("matchRegionId also matches a LEADING segment — real production bug: sources cite 'Ciudad, Nombre-oficial-de-la-región', not just 'barrio, Ciudad'", () => {
  // Real production rows (2026-07-15) that landed in "otro" before this
  // fix, even though Concepción/Arica are both seeded regions — the
  // trailing segment was the region's official administrative name, not
  // the city itself.
  assert.equal(matchRegionId("Concepción, Bío Bío", REGIONS), "r-concepcion");
  assert.equal(matchRegionId("Arica, Región de Arica y Parinacota", REGIONS), "r-arica");
});

test("matchRegionId doesn't over-match a genuinely different comuna just because it's nearby — Viña del Mar stays unmatched, not silently merged into Valparaíso", () => {
  assert.equal(matchRegionId("Viña del Mar", REGIONS), null);
  assert.equal(matchRegionId("Sala Viña del Mar, Viña del Mar", REGIONS), null);
});

test("matchRegionId returns null when unmatched (the 'otro' case)", () => {
  assert.equal(matchRegionId("un lugar cualquiera, Chile", REGIONS), null, "'Chile' alone doesn't match any region name");
  assert.equal(matchRegionId("Rancagua", REGIONS), null);
});

test("matchRegionId matches via a middle segment too, e.g. a trailing ', Chile' doesn't block a match found earlier in the string", () => {
  assert.equal(matchRegionId("Providencia, Santiago, Chile", REGIONS), "r-santiago");
});

test("matchRegionId ignores which search unit produced the candidate — matches the candidate's own reported location only", () => {
  // A candidate found while searching Providencia can genuinely be in Las
  // Condes (docs/region-discovery.md's own documented case) — the match
  // must come from the location text, never a passed-in search-unit id.
  assert.equal(matchRegionId("Centro Cultural Recoleta, Buenos Aires, Argentina", REGIONS), null);
});
