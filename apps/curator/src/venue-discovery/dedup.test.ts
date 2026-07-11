import { test } from "node:test";
import assert from "node:assert/strict";
import { isDuplicate, extractDomain } from "./dedup.js";
import type { VenueCandidate } from "./discover.js";

function candidate(overrides: Partial<VenueCandidate> = {}): VenueCandidate {
  return {
    name: "Galería del Puerto",
    address: null,
    websiteOrSocial: null,
    contactEmail: null,
    category: "art_space",
    ...overrides,
  };
}

test("isDuplicate: same name, different casing/whitespace, is a duplicate", () => {
  const existing = [{ name: "  Galería   del Puerto ", source_domain: null }];
  assert.equal(isDuplicate(candidate({ name: "galería del puerto" }), existing), true);
});

test("isDuplicate: same domain, different path, is a duplicate", () => {
  const existing = [{ name: "Some Other Name", source_domain: "galeriadelpuerto.cl" }];
  const c = candidate({
    name: "Completely Different Name",
    websiteOrSocial: "https://www.galeriadelpuerto.cl/eventos/agosto",
  });
  assert.equal(isDuplicate(c, existing), true);
});

test("isDuplicate: a genuinely different venue is not a duplicate", () => {
  const existing = [{ name: "Centro Cultural Municipal", source_domain: "ccmarica.cl" }];
  const c = candidate({ name: "Galería del Puerto", websiteOrSocial: "https://otrodominio.cl" });
  assert.equal(isDuplicate(c, existing), false);
});

test("isDuplicate: no existing venues means never a duplicate", () => {
  assert.equal(isDuplicate(candidate(), []), false);
});

test("extractDomain: strips www and scheme, keeps bare host", () => {
  assert.equal(extractDomain("https://www.example.cl/foo"), "example.cl");
  assert.equal(extractDomain("example.cl"), "example.cl");
  assert.equal(extractDomain(null), null);
  assert.equal(extractDomain("not a url"), null);
});
