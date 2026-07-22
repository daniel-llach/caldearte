import { test } from "node:test";
import assert from "node:assert/strict";
import { isChileanLocation, matchRegionId } from "./locations.js";
import { CHILE_COMUNAS_SNAPSHOT } from "./chile-comunas-snapshot.js";

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

// Real production bug, found 2026-07-22: a rejected candidate can
// legitimately have a null location (Haiku doesn't always fill it in for
// an event it's discarding), and insertCandidates calls matchRegionId on
// every candidate, not just approved ones — crashed the whole unit.
test("matchRegionId returns null for null/undefined rather than crashing", () => {
  assert.equal(matchRegionId(null, REGIONS), null);
  assert.equal(matchRegionId(undefined, REGIONS), null);
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

test("isChileanLocation recognizes Frutillar (real production bug: a legitimate art expo there was code-rejected as 'not Chilean' because CHILE_MARKERS didn't include it, even though Puerto Varas/Osorno/Valdivia — its neighbors — already did)", () => {
  assert.equal(isChileanLocation("Frutillar"), true);
  assert.equal(isChileanLocation("Teatro del Lago, Frutillar"), true);
});

test("isChileanLocation recognizes both the official (Coihaique) and legacy (Coyhaique) spellings", () => {
  assert.equal(isChileanLocation("Coihaique"), true);
  assert.equal(isChileanLocation("Coyhaique"), true);
});

test("isChileanLocation covers every comuna in the CHILE_COMUNAS_SNAPSHOT (regression guard for the whitelist-drift bug found 2026-07-20 — this is what would have caught Colbún & co. before a real run did)", () => {
  const missing = CHILE_COMUNAS_SNAPSHOT.filter((comuna) => !isChileanLocation(comuna));
  assert.deepEqual(
    missing,
    [],
    `${missing.length} comuna(s) from the snapshot aren't recognized by isChileanLocation — CHILE_MARKERS needs updating: ${missing.join(", ")}`,
  );
});

test("isChileanLocation returns false (not Chilean, doesn't throw) for null/undefined location — real production bug: Haiku returned status:'approved' with location:null, crashing the whole weekly batch run on `null.toLowerCase()`", () => {
  assert.equal(isChileanLocation(null), false);
  assert.equal(isChileanLocation(undefined), false);
  assert.equal(isChileanLocation(""), false);
});
