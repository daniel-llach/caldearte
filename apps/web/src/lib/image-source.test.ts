import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveImageSource, resolveCardImage } from "./image-source";

test("deriveImageSource recognizes instagram.com", () => {
  assert.deepEqual(deriveImageSource("https://www.instagram.com/p/abc123/"), { kind: "instagram", domain: null });
});

test("deriveImageSource recognizes facebook.com", () => {
  assert.deepEqual(deriveImageSource("https://www.facebook.com/events/123"), { kind: "facebook", domain: null });
});

test("deriveImageSource falls back to web + root domain, stripping www.", () => {
  assert.deepEqual(deriveImageSource("https://www.uchile.cl/eventos/x"), { kind: "web", domain: "uchile.cl" });
});

test("deriveImageSource: null sourceUrl -> web with no domain", () => {
  assert.deepEqual(deriveImageSource(null), { kind: "web", domain: null });
});

test("deriveImageSource: unparseable URL -> web with no domain, doesn't throw", () => {
  assert.deepEqual(deriveImageSource("not a url"), { kind: "web", domain: null });
});

test("resolveCardImage: real imageUrl wins regardless of source", () => {
  assert.deepEqual(
    resolveCardImage({ imageUrl: "https://cdn.example.com/x.jpg", sourceUrl: "https://instagram.com/p/x" }),
    { type: "photo", url: "https://cdn.example.com/x.jpg" },
  );
});

test("resolveCardImage: no imageUrl -> placeholder derived from sourceUrl", () => {
  assert.deepEqual(resolveCardImage({ imageUrl: null, sourceUrl: "https://facebook.com/events/1" }), {
    type: "placeholder",
    source: "facebook",
    domain: null,
  });
});
