import { test } from "node:test";
import assert from "node:assert/strict";
import { detectNewBrightSources, fetchBrightSources, isCompleteEvent, mergeBrightSources, type BrightSource } from "./sources.js";
import { KNOWN_SOURCES } from "../lib/known-sources.js";
import type { ArticleListConfig } from "./extractors.js";
import type { EventCandidate } from "./discover.js";

const completeCandidate: EventCandidate = {
  title: "Expo real",
  description: null, // deliberately null — description is NOT required
  artist: null,
  runStartDate: "2026-07-05",
  runEndDate: null,
  openingDatetime: null,
  mediumType: "tradicional",
  sensitivityTags: [],
  curationReasoning: "ok",
  imageUrl: "https://nuevositio.cl/obra.jpg",
  status: "approved",
  location: "Santiago, Chile",
  placeName: null,
  sourceUrl: "https://nuevositio.cl/expo-1",
};

const NOW = new Date(2026, 6, 12); // July 12, 2026

// extractImgTags/filterKnownSourceImages/extractArticleList/
// extractWordpressItems have their own direct coverage in
// extractors.test.ts — these tests cover fetchBrightSources's dispatch
// logic instead: does it pick the right extractor, and does it degrade
// correctly when there isn't one.
type StubFetch = () => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;

async function withStubFetch<T>(stub: StubFetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = stub as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

function jsonResponse(body: unknown): ReturnType<StubFetch> {
  return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body });
}

function textResponse(body: string): ReturnType<StubFetch> {
  return Promise.resolve({ ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) });
}

test("fetchBrightSources dispatches an articleList-configured source to the registry parser", async () => {
  const source: BrightSource = {
    url: "https://sitio.cl/agenda",
    note: "sitio",
    extractor: {
      kind: "articleList",
      blockRegex: /<li class="ev">([\s\S]*?)<\/li>/g,
      titleLinkRegex: /<a href="([^"]+)">([^<]*)<\/a>/,
    },
  };
  const html = `<ul><li class="ev"><a href="/e/1">Muestra</a></li></ul>`;

  const results = await withStubFetch(() => textResponse(html), () => fetchBrightSources([source]));

  assert.equal(results.length, 1);
  assert.equal(results[0].content, '- "Muestra" (fecha no indicada). Lugar: no indicado. Más info: https://sitio.cl/e/1');
});

test("fetchBrightSources falls back to a whole-page flatten when the configured extractor doesn't match the fetched markup", async () => {
  const source: BrightSource = {
    url: "https://sitio.cl/agenda",
    note: "sitio",
    extractor: {
      kind: "articleList",
      blockRegex: /<li class="ev">([\s\S]*?)<\/li>/g,
      titleLinkRegex: /<a href="([^"]+)">([^<]*)<\/a>/,
    },
  };
  // Real markup for this fetch doesn't have any "ev" blocks at all.
  const html = `<html><body><p>Contenido inesperado, sin la estructura configurada.</p></body></html>`;

  const results = await withStubFetch(() => textResponse(html), () => fetchBrightSources([source]));

  assert.equal(results.length, 1);
  assert.match(results[0].content, /Contenido inesperado/);
});

test("fetchBrightSources falls back to a whole-page flatten for an html source with no extractor configured at all (today's auto-detected sources)", async () => {
  const source: BrightSource = { url: "https://sitio.cl/agenda", note: "sitio" }; // no type, no extractor — the shape an auto-detected row has
  const html = `<html><body><script>ignoreme()</script><p>Texto real del sitio.</p></body></html>`;

  const results = await withStubFetch(() => textResponse(html), () => fetchBrightSources([source]));

  assert.equal(results.length, 1);
  assert.match(results[0].content, /Texto real del sitio/);
  assert.doesNotMatch(results[0].content, /ignoreme/);
});

test("fetchBrightSources dispatches a wordpressRestApi-configured source to the registry parser", async () => {
  const source: BrightSource = {
    url: "https://sitio.cl/wp-json/wp/v2/events",
    note: "sitio",
    type: "json-api",
    extractor: { kind: "wordpressRestApi", titleField: "title.rendered", linkField: "link", imageField: "image" },
  };
  const items = [{ title: { rendered: "Muestra API" }, link: "https://sitio.cl/e/1", image: "https://sitio.cl/img.jpg" }];

  const results = await withStubFetch(() => jsonResponse(items), () => fetchBrightSources([source]));

  assert.equal(results.length, 1);
  assert.deepEqual(results[0].images, [{ url: "https://sitio.cl/img.jpg", description: "Imagen de la exposición: Muestra API" }]);
});

test("fetchBrightSources logs and skips (doesn't crash the run) a json-api source with no extractor configured", async () => {
  const source: BrightSource = { url: "https://sitio.cl/wp-json/wp/v2/events", note: "sitio", type: "json-api" };

  const results = await withStubFetch(() => jsonResponse([{ title: { rendered: "x" } }]), () => fetchBrightSources([source]));

  assert.equal(results.length, 0);
});

test("fetchBrightSources against the real KNOWN_SOURCES config for uchile.cl parses per-event structure (regression check against production config)", async () => {
  const uchile = KNOWN_SOURCES.find((s) => s.url.includes("artes.uchile.cl"));
  assert.ok(uchile?.extractor?.kind === "articleList");
  const config = uchile.extractor as ArticleListConfig;

  const html = `
    <article class="mod-cal-result__item">
      <figure><img src="/dam/uno.jpg" alt="Imagen"></figure>
      <h4 class="mod__item-title"><a href="/agenda/evento-uno">Muestra Real</a></h4>
      <p class="mod-cal-result__item-days">Del 1 al 20 de julio</p>
      <p class="mod-cal-result__item-placer">MAC Quinta Normal</p>
    </article>
  `;

  const results = await withStubFetch(() => textResponse(html), () => fetchBrightSources([{ url: uchile.url, note: uchile.note, extractor: config }]));

  assert.equal(results.length, 1);
  assert.match(results[0].content, /Muestra Real.*MAC Quinta Normal/);
  assert.equal(results[0].images[0]?.url, "https://artes.uchile.cl/dam/uno.jpg");
});

test("mergeBrightSources dedups by domain with the hand-curated list winning", () => {
  const merged = mergeBrightSources([
    // Same domain as a KNOWN_SOURCES entry — must not appear twice.
    { url: "https://artes.uchile.cl/otra-pagina", note: "auto" },
    { url: "https://otro.cl/agenda", note: "auto" },
  ]);

  const uchile = merged.filter((s) => s.url.includes("artes.uchile.cl"));
  assert.equal(uchile.length, 1);
  assert.notEqual(uchile[0].note, "auto"); // the curated entry won
  assert.ok(merged.some((s) => s.url === "https://otro.cl/agenda"));
});

test("isCompleteEvent requires image + title + a date in the current month, but NOT a description", () => {
  assert.equal(isCompleteEvent(completeCandidate, NOW), true);
  assert.equal(isCompleteEvent({ ...completeCandidate, imageUrl: null }, NOW), false);
  assert.equal(isCompleteEvent({ ...completeCandidate, runStartDate: "2026-08-05" }, NOW), false); // next month
  assert.equal(
    isCompleteEvent({ ...completeCandidate, runStartDate: null, openingDatetime: "2026-07-20T19:00:00-04:00" }, NOW),
    true, // openingDatetime works as the date when runStartDate is missing
  );
});

test("detectNewBrightSources promotes a domain at 2+ complete events, excluding social and known domains", () => {
  const candidates: EventCandidate[] = [
    completeCandidate,
    { ...completeCandidate, title: "Expo dos", sourceUrl: "https://nuevositio.cl/expo-2" },
    // Social platform with 2 complete events — must never qualify.
    { ...completeCandidate, title: "Insta 1", sourceUrl: "https://www.instagram.com/p/abc" },
    { ...completeCandidate, title: "Insta 2", sourceUrl: "https://www.instagram.com/p/def" },
    // Already-known domain — excluded.
    { ...completeCandidate, title: "Conocida", sourceUrl: "https://conocida.cl/x" },
    // Only 1 complete event — under the threshold.
    { ...completeCandidate, title: "Solo una", sourceUrl: "https://solouna.cl/x" },
    // 2 events but incomplete (no image) — don't count.
    { ...completeCandidate, title: "Sin imagen 1", imageUrl: null, sourceUrl: "https://sinimagen.cl/1" },
    { ...completeCandidate, title: "Sin imagen 2", imageUrl: null, sourceUrl: "https://sinimagen.cl/2" },
  ];

  const detected = detectNewBrightSources(candidates, NOW, ["conocida.cl"]);

  assert.equal(detected.length, 1);
  assert.equal(detected[0].url, "https://nuevositio.cl/expo-1");
  assert.match(detected[0].note, /2 eventos completos/);
});

test("detectNewBrightSources ignores rejected candidates", () => {
  const detected = detectNewBrightSources(
    [
      { ...completeCandidate, status: "rejected" },
      { ...completeCandidate, title: "Otra", status: "rejected", sourceUrl: "https://nuevositio.cl/expo-2" },
    ],
    NOW,
    [],
  );
  assert.equal(detected.length, 0);
});
