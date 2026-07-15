import { test } from "node:test";
import assert from "node:assert/strict";
import { matchRegionId } from "./locations.js";

const REGIONS = [
  { id: "r-santiago", name: "Santiago" },
  { id: "r-valpo", name: "Valparaíso" },
];

test("matchRegionId matches the trailing comma-segment, accent/case-insensitive", () => {
  assert.equal(matchRegionId("GAM, Santiago", REGIONS), "r-santiago");
  assert.equal(matchRegionId("Plaza Sotomayor, valparaiso", REGIONS), "r-valpo");
  assert.equal(matchRegionId("SANTIAGO", REGIONS), "r-santiago");
});

test("matchRegionId returns null when unmatched (the 'otro' case)", () => {
  assert.equal(matchRegionId("Providencia, Santiago, Chile", REGIONS), null, "'Chile' alone doesn't match any region name");
  assert.equal(matchRegionId("Rancagua", REGIONS), null);
});

test("matchRegionId ignores which search unit produced the candidate — matches the candidate's own reported location only", () => {
  // A candidate found while searching Providencia can genuinely be in Las
  // Condes (docs/region-discovery.md's own documented case) — the match
  // must come from the location text, never a passed-in search-unit id.
  assert.equal(matchRegionId("Centro Cultural Recoleta, Buenos Aires, Argentina", REGIONS), null);
});
