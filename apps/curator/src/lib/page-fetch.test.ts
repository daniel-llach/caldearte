import { test } from "node:test";
import assert from "node:assert/strict";
import {
  enrichMissingImages,
  extractJsonLdImage,
  extractOgImage,
  extractTwitterImage,
  fetchOgImage,
  isSocialMediaUrl,
  type FetchLike,
} from "./page-fetch.js";

test("isSocialMediaUrl matches instagram.com and facebook.com on any path, including subdomains, but not lookalikes", () => {
  assert.equal(isSocialMediaUrl("https://instagram.com/museo/p/xyz/"), true);
  assert.equal(isSocialMediaUrl("https://www.facebook.com/museo/posts/123"), true);
  assert.equal(isSocialMediaUrl("https://m.facebook.com/evento"), true);
  assert.equal(isSocialMediaUrl("https://portaldisc.com/expo"), false);
  assert.equal(isSocialMediaUrl("https://notinstagram.com/expo"), false);
  assert.equal(isSocialMediaUrl("not a url"), true, "unparseable — never fetch it");
});

function stubFetch(html: string, ok = true): FetchLike {
  return async () => ({ ok, status: ok ? 200 : 404, text: async () => html });
}

test("fetchOgImage extracts content from a standard property-then-content og:image tag", async () => {
  const html = `<html><head><meta property="og:image" content="/img/afiche.jpg"></head></html>`;
  const result = await fetchOgImage("https://portaldisc.com/expo", stubFetch(html));
  assert.equal(result, "https://portaldisc.com/img/afiche.jpg");
});

test("fetchOgImage also matches the reversed content-then-property attribute order", async () => {
  const html = `<meta content="https://cdn.cl/afiche.jpg" property="og:image">`;
  const result = await fetchOgImage("https://biobiochile.cl/expo", stubFetch(html));
  assert.equal(result, "https://cdn.cl/afiche.jpg");
});

test("fetchOgImage returns null on a non-2xx response, missing tag, or social domain — never throws", async () => {
  assert.equal(await fetchOgImage("https://portaldisc.com/expo", stubFetch("<html></html>", false)), null);
  assert.equal(await fetchOgImage("https://portaldisc.com/expo", stubFetch("<html><head></head></html>")), null);
  assert.equal(
    await fetchOgImage("https://instagram.com/p/xyz", async () => {
      throw new Error("should never be called for a social URL");
    }),
    null,
  );
});

test("fetchOgImage degrades to null when the fetch itself throws", async () => {
  const failing: FetchLike = async () => {
    throw new Error("network down");
  };
  assert.equal(await fetchOgImage("https://portaldisc.com/expo", failing), null);
});

test("extractTwitterImage matches both attribute orders and the :src variant", () => {
  assert.equal(extractTwitterImage(`<meta name="twitter:image" content="/img/a.jpg">`), "/img/a.jpg");
  assert.equal(extractTwitterImage(`<meta content="/img/b.jpg" name="twitter:image">`), "/img/b.jpg");
  assert.equal(extractTwitterImage(`<meta name="twitter:image:src" content="/img/c.jpg">`), "/img/c.jpg");
  assert.equal(extractTwitterImage(`<html></html>`), null);
});

test("extractJsonLdImage reads a plain string image field, an array, and an ImageObject, skipping malformed blocks", () => {
  assert.equal(
    extractJsonLdImage(`<script type="application/ld+json">{"@type":"Event","image":"/img/a.jpg"}</script>`),
    "/img/a.jpg",
  );
  assert.equal(
    extractJsonLdImage(`<script type="application/ld+json">{"image":["/img/b.jpg","/img/c.jpg"]}</script>`),
    "/img/b.jpg",
  );
  assert.equal(
    extractJsonLdImage(`<script type="application/ld+json">{"image":{"@type":"ImageObject","url":"/img/d.jpg"}}</script>`),
    "/img/d.jpg",
  );
  assert.equal(
    extractJsonLdImage(`<script type="application/ld+json">{not valid json</script><script type="application/ld+json">{"image":"/img/e.jpg"}</script>`),
    "/img/e.jpg",
    "malformed block is skipped, not fatal",
  );
  assert.equal(extractJsonLdImage(`<html></html>`), null);
});

test("fetchOgImage chains strategies in order: og:image wins over twitter:image and JSON-LD when present", async () => {
  const html = `
    <meta property="og:image" content="/og.jpg">
    <meta name="twitter:image" content="/twitter.jpg">
    <script type="application/ld+json">{"image":"/jsonld.jpg"}</script>
  `;
  assert.equal(await fetchOgImage("https://portaldisc.com/expo", stubFetch(html)), "https://portaldisc.com/og.jpg");
});

test("fetchOgImage falls through to twitter:image, then JSON-LD, when earlier strategies find nothing", async () => {
  const twitterOnly = `<meta name="twitter:image" content="/twitter.jpg"><script type="application/ld+json">{"image":"/jsonld.jpg"}</script>`;
  assert.equal(await fetchOgImage("https://portaldisc.com/expo", stubFetch(twitterOnly)), "https://portaldisc.com/twitter.jpg");

  const jsonLdOnly = `<script type="application/ld+json">{"image":"/jsonld.jpg"}</script>`;
  assert.equal(await fetchOgImage("https://portaldisc.com/expo", stubFetch(jsonLdOnly)), "https://portaldisc.com/jsonld.jpg");
});

test("extractOgImage is exported directly and behaves the same as through fetchOgImage", () => {
  assert.equal(extractOgImage(`<meta property="og:image" content="/img.jpg">`), "/img.jpg");
});

test("enrichMissingImages fills imageUrl only for approved candidates with no image and a fetchable sourceUrl", async () => {
  const candidates = [
    { status: "approved" as const, imageUrl: null, sourceUrl: "https://portaldisc.com/expo-1" },
    { status: "approved" as const, imageUrl: "https://x.cl/ya-tiene.jpg", sourceUrl: "https://portaldisc.com/expo-2" },
    { status: "rejected" as const, imageUrl: null, sourceUrl: "https://portaldisc.com/expo-3" },
    { status: "approved" as const, imageUrl: null, sourceUrl: "https://instagram.com/p/expo-4" },
    { status: "approved" as const, imageUrl: null, sourceUrl: null },
  ];

  const fetchImpl: FetchLike = async (url) => ({
    ok: true,
    status: 200,
    text: async () => `<meta property="og:image" content="https://cdn.cl/recovered.jpg">`,
  });

  await enrichMissingImages(candidates, fetchImpl);

  assert.equal(candidates[0].imageUrl, "https://cdn.cl/recovered.jpg", "recovered for the eligible candidate");
  assert.equal(candidates[1].imageUrl, "https://x.cl/ya-tiene.jpg", "untouched — already had an image");
  assert.equal(candidates[2].imageUrl, null, "untouched — rejected");
  assert.equal(candidates[3].imageUrl, null, "untouched — social media sourceUrl");
  assert.equal(candidates[4].imageUrl, null, "untouched — no sourceUrl to fetch");
});
