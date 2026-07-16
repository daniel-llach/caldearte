import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveComuna } from "./comuna";

test("deriveComuna finds a comuna name inside place_name", () => {
  assert.equal(deriveComuna("Santiago", "MAC - Museo de Arte Contemporáneo - Espacio Quinta Normal, Avda. Matucana 464"), "Quinta Normal");
});

test("deriveComuna finds a comuna name inside freeform_location when place_name doesn't have it", () => {
  assert.equal(deriveComuna("Cerrillos, Santiago", "Centro Nacional de Arte Contemporáneo (CNAC), Pedro Aguirre Cerda 6100"), "Cerrillos");
});

test("deriveComuna is accent/case-insensitive", () => {
  assert.equal(deriveComuna("Santiago", "Centro Cultural NUNOA"), "Ñuñoa");
  assert.equal(deriveComuna("Santiago", "sala en las condes"), "Las Condes");
});

test("deriveComuna returns null when neither field mentions a known comuna — the common case (bare street address or a landmark that isn't a comuna name)", () => {
  assert.equal(deriveComuna("Santiago", "Galeria NAC, Américo Vespucio Norte #2878"), null);
  assert.equal(deriveComuna("Santiago", "MAC Parque Forestal"), null, "Parque Forestal is a park, not a comuna");
  assert.equal(deriveComuna("Santiago", null), null);
});

test("deriveComuna never matches 'Santiago' itself as a comuna (it's the parent bucket, not a sub-area)", () => {
  assert.equal(deriveComuna("Santiago", "Algún lugar en Santiago"), null);
});
