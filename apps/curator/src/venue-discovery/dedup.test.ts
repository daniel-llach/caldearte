import { test } from "node:test";
import assert from "node:assert/strict";
import { isDuplicate, extractDomain, deriveListingUrl, findMatchingVenue, type VenueIdentity } from "./dedup.js";

function identity(overrides: Partial<VenueIdentity> = {}): VenueIdentity {
  return {
    name: "Galería del Puerto",
    websiteOrSocial: null,
    sourceUrl: null,
    ...overrides,
  };
}

test("isDuplicate: same name, different casing/whitespace, is a duplicate", () => {
  const existing = [{ id: "v1", name: "  Galería   del Puerto ", source_domain: null }];
  assert.equal(isDuplicate(identity({ name: "galería del puerto" }), existing), true);
});

test("isDuplicate: same domain, different path, is a duplicate", () => {
  const existing = [{ id: "v1", name: "Some Other Name", source_domain: "galeriadelpuerto.cl" }];
  const c = identity({
    name: "Completely Different Name",
    websiteOrSocial: "https://www.galeriadelpuerto.cl/eventos/agosto",
  });
  assert.equal(isDuplicate(c, existing), true);
});

test("isDuplicate: a genuinely different venue is not a duplicate", () => {
  const existing = [{ id: "v1", name: "Centro Cultural Municipal", source_domain: "ccmarica.cl" }];
  const c = identity({ name: "Galería del Puerto", websiteOrSocial: "https://otrodominio.cl" });
  assert.equal(isDuplicate(c, existing), false);
});

test("isDuplicate: no existing venues means never a duplicate", () => {
  assert.equal(isDuplicate(identity(), []), false);
});

test("extractDomain: strips www and scheme, keeps bare host", () => {
  assert.equal(extractDomain("https://www.example.cl/foo"), "example.cl");
  assert.equal(extractDomain("example.cl"), "example.cl");
  assert.equal(extractDomain(null), null);
  assert.equal(extractDomain("not a url"), null);
});

test("deriveListingUrl: strips the last path segment (the GAM case)", () => {
  assert.equal(
    deriveListingUrl("https://gam.cl/es/que-hacer-en-gam/artesvisuales/mundo-pepo/"),
    "https://gam.cl/es/que-hacer-en-gam/artesvisuales/",
  );
});

test("deriveListingUrl: works without a trailing slash on the source", () => {
  assert.equal(
    deriveListingUrl("https://venue.cl/artesvisuales/mundo-pepo"),
    "https://venue.cl/artesvisuales/",
  );
});

test("deriveListingUrl: a single-segment path falls back to the domain root", () => {
  assert.equal(deriveListingUrl("https://venue.cl/mundo-pepo/"), "https://venue.cl/");
});

test("deriveListingUrl: the bare root stays the root", () => {
  assert.equal(deriveListingUrl("https://venue.cl/"), "https://venue.cl/");
});

test("deriveListingUrl: returns null for an unparseable URL", () => {
  assert.equal(deriveListingUrl("not a url at all"), null);
});

test("findMatchingVenue: matches by name and returns the existing row", () => {
  const existing = [{ id: "v1", name: "Galería del Puerto", source_domain: null, listing_url: null }];
  const match = findMatchingVenue(identity({ name: "galería del puerto" }), existing);
  assert.equal(match?.id, "v1");
});

test("findMatchingVenue: matches by domain extracted from sourceUrl when websiteOrSocial is absent", () => {
  const existing = [{ id: "v1", name: "Some Other Name", source_domain: "gam.cl", listing_url: null }];
  const c = identity({
    name: "Completely Different Name",
    sourceUrl: "https://gam.cl/es/que-hacer-en-gam/artesvisuales/mundo-pepo/",
  });
  assert.equal(findMatchingVenue(c, existing)?.id, "v1");
});

test("findMatchingVenue: returns null when nothing matches", () => {
  const existing = [{ id: "v1", name: "Centro Cultural Municipal", source_domain: "ccmarica.cl" }];
  const c = identity({ name: "Galería del Puerto", websiteOrSocial: "https://otrodominio.cl" });
  assert.equal(findMatchingVenue(c, existing), null);
});
