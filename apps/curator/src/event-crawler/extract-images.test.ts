import { test } from "node:test";
import assert from "node:assert/strict";
import { extractImageCandidates } from "./extract-images.js";

test("extractImageCandidates: extracts src, alt, width, height", () => {
  const html = `<img src="/flyer.jpg" alt="Exhibition flyer" width="800" height="600">`;
  const [candidate] = extractImageCandidates(html, "https://example.cl/");

  assert.equal(candidate.src, "https://example.cl/flyer.jpg");
  assert.equal(candidate.alt, "Exhibition flyer");
  assert.equal(candidate.width, 800);
  assert.equal(candidate.height, 600);
});

test("extractImageCandidates: resolves relative URLs against the page URL", () => {
  const html = `<img src="images/pic.png" alt="art">`;
  const [candidate] = extractImageCandidates(html, "https://example.cl/agenda/");
  assert.equal(candidate.src, "https://example.cl/agenda/images/pic.png");
});

test("extractImageCandidates: filters out logo/icon/favicon-like images", () => {
  const html = `
    <img src="/site-logo.png" alt="logo" width="500" height="500">
    <img src="/favicon.ico">
    <img src="/artwork.jpg" alt="A real artwork" width="800" height="800">
  `;
  const candidates = extractImageCandidates(html, "https://example.cl/");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].src, "https://example.cl/artwork.jpg");
});

test("extractImageCandidates: skips data: URIs", () => {
  const html = `<img src="data:image/png;base64,abc123">`;
  assert.deepEqual(extractImageCandidates(html, "https://example.cl/"), []);
});

test("extractImageCandidates: ranks images with alt text and larger dimensions higher", () => {
  const html = `
    <img src="/small.jpg" width="100" height="100">
    <img src="/big-with-alt.jpg" alt="Main artwork" width="900" height="900">
  `;
  const candidates = extractImageCandidates(html, "https://example.cl/");
  assert.equal(candidates[0].src, "https://example.cl/big-with-alt.jpg");
});

test("extractImageCandidates: respects the limit parameter", () => {
  const html = Array.from({ length: 20 }, (_, i) => `<img src="/img${i}.jpg" alt="a" width="500" height="500">`).join(
    "\n",
  );
  const candidates = extractImageCandidates(html, "https://example.cl/", 5);
  assert.equal(candidates.length, 5);
});

test("extractImageCandidates: returns an empty array when there are no images", () => {
  assert.deepEqual(extractImageCandidates("<p>no images here</p>", "https://example.cl/"), []);
});
