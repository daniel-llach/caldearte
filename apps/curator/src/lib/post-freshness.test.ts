import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPublishedDate, isStalePublishYear } from "./post-freshness.js";

test("extractPublishedDate reads a JSON-LD datePublished field", () => {
  const html = `<script type="application/ld+json">{"@type":"Article","datePublished":"2023-07-12T14:03:53+00:00"}</script>`;
  const date = extractPublishedDate(html);
  assert.equal(date?.getUTCFullYear(), 2023);
});

test("extractPublishedDate reads an article:published_time meta tag", () => {
  const html = `<meta property="article:published_time" content="2023-02-20T18:23:46-03:00">`;
  const date = extractPublishedDate(html);
  assert.equal(date?.getUTCFullYear(), 2023);
});

// Real production shape (2026-07-21): Instagram doesn't emit either of the
// standard tags above — the only publish-date signal is the caption byline
// inside og:description, e.g. "91 likes, 13 comments - locaintuicion on
// August 14, 2025: "Hoy fue la inauguración..."
test("extractPublishedDate reads an Instagram og:description caption byline", () => {
  const html = `<meta property="og:description" content="91 likes, 13 comments - locaintuicion on August 14, 2025: &quot;Hoy fue la inauguración...&quot;">`;
  const date = extractPublishedDate(html);
  assert.equal(date?.getUTCFullYear(), 2025);
  assert.equal(date?.getUTCMonth(), 7); // August, 0-indexed
  assert.equal(date?.getUTCDate(), 14);
});

test("extractPublishedDate returns null when no recognized signal is present — most sources carry none", () => {
  assert.equal(extractPublishedDate("<html><body>Sin metadata de fecha</body></html>"), null);
});

test("isStalePublishYear compares only the year, not the month — same-year gaps are a known, documented, unhandled case", () => {
  const referenceDate = new Date("2026-07-15T00:00:00Z");
  assert.equal(isStalePublishYear(new Date("2025-08-14T00:00:00Z"), referenceDate), true, "different year — stale");
  assert.equal(isStalePublishYear(new Date("2026-04-29T00:00:00Z"), referenceDate), false, "same year, different month — not flagged by design");
  assert.equal(isStalePublishYear(new Date("2026-07-01T00:00:00Z"), referenceDate), false, "same year, same month");
});
