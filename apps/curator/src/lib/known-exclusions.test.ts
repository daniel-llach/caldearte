import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesKnownExclusion, matchesKnownLowQualityDomain } from "./known-exclusions.js";

test("matchesKnownExclusion matches a known excluded event regardless of edition/year suffix, accent/case-insensitive", () => {
  assert.equal(matchesKnownExclusion("Festival Santiago a Mil - XXXIII edición"), true);
  assert.equal(matchesKnownExclusion("FESTIVAL SANTIAGO A MIL 2027"), true);
  assert.equal(matchesKnownExclusion("festival santiago a mil"), true);
});

test("matchesKnownExclusion matches 'La Florida Es Teatro', a community theater festival wrongly approved as intervencion_no_tradicional", () => {
  assert.equal(matchesKnownExclusion("La Florida Es Teatro 2026"), true);
  assert.equal(matchesKnownExclusion("la florida es teatro"), true);
});

test("matchesKnownExclusion returns false for unrelated titles", () => {
  assert.equal(matchesKnownExclusion("Exposición Colectiva Sala FEM 2026"), false);
  assert.equal(matchesKnownExclusion("Muestra Poética de las aguas"), false);
});

test("matchesKnownLowQualityDomain matches infobae.com's multi-country agenda-cultura pages, with or without www", () => {
  assert.equal(
    matchesKnownLowQualityDomain(
      "https://www.infobae.com/cultura/agenda-cultura/2026/07/17/guia-de-arte-y-cultura-semana-del-17-al-24-de-julio-de-2026",
    ),
    true,
  );
  assert.equal(matchesKnownLowQualityDomain("https://infobae.com/some-other-path"), true);
});

test("matchesKnownLowQualityDomain returns false for unrelated domains, and for unparseable URLs", () => {
  assert.equal(matchesKnownLowQualityDomain("https://www.mnba.gob.cl/cartelera"), false);
  assert.equal(matchesKnownLowQualityDomain("not-a-real-url"), false);
});
