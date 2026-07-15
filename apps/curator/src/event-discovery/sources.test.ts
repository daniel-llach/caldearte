import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectNewBrightSources,
  extractEventArticles,
  extractImgTags,
  filterKnownSourceImages,
  isCompleteEvent,
  mergeBrightSources,
} from "./sources.js";
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

test("extractImgTags pulls src/alt pairs and treats empty alt as null", () => {
  const html = `<div><img src="/a.jpg" alt="obra"> <img src="/b.jpg" alt=""> <img alt="no src"></div>`;
  const images = extractImgTags(html);
  assert.deepEqual(images, [
    { url: "/a.jpg", description: "obra" },
    { url: "/b.jpg", description: null },
  ]);
});

test("filterKnownSourceImages resolves relative URLs, drops chrome, nulls 'vacio' alts", () => {
  const images = [
    { url: " /dam/expo-prev.jpg", description: "vacio" },
    { url: "/logos/site-logo.png", description: "Universidad" },
    { url: "https://cdn.cl/real.jpg", description: "afiche" },
    { url: "https://cdn.cl/real.jpg", description: "duplicada" },
  ];
  const out = filterKnownSourceImages(images, "https://artes.uchile.cl/agenda/30dias/6");
  assert.deepEqual(out, [
    { url: "https://artes.uchile.cl/dam/expo-prev.jpg", description: null },
    { url: "https://cdn.cl/real.jpg", description: "afiche" },
  ]);
});

test("extractEventArticles pairs each event with its own image and text, handling the item-place/item-placer typo", () => {
  const html = `
    <article class="mod-cal-result__item">
      <figure><img src="/dam/uno.jpg" alt="Imagen 1"></figure>
      <h4 class="mod__item-title"><a href="/agenda/evento-uno">Muestra Uno</a></h4>
      <p class="mod-cal-result__item-days">Del 1 al 20 de julio</p>
      <p class="mod-cal-result__item-place">Sala Juan Egenau</p>
    </article>
    <article class="mod-cal-result__item">
      <figure><img src="/dam/dos.jpg" alt="Imagen 2"></figure>
      <h4 class="mod__item-title"><a href="/agenda/evento-dos">Muestra Dos</a></h4>
      <p class="mod-cal-result__item-days">Del 5 al 30 de julio</p>
      <p class="mod-cal-result__item-placer">Galería Central</p>
    </article>
  `;

  const result = extractEventArticles(html, "https://artes.uchile.cl/agenda/30dias/6");
  assert.ok(result);
  assert.equal(result.images.length, 2);
  assert.deepEqual(result.images[0], {
    url: "https://artes.uchile.cl/dam/uno.jpg",
    description: "Imagen de la exposición: Muestra Uno",
  });
  assert.deepEqual(result.images[1], {
    url: "https://artes.uchile.cl/dam/dos.jpg",
    description: "Imagen de la exposición: Muestra Dos",
  });

  const lines = result.content.split("\n");
  assert.equal(lines.length, 2);
  assert.equal(
    lines[0],
    '- "Muestra Uno" (Del 1 al 20 de julio). Lugar: Sala Juan Egenau. Más info: https://artes.uchile.cl/agenda/evento-uno',
  );
  assert.equal(
    lines[1],
    '- "Muestra Dos" (Del 5 al 30 de julio). Lugar: Galería Central. Más info: https://artes.uchile.cl/agenda/evento-dos',
  );
});

test("extractEventArticles falls back to placeholder text when days/place are missing, but skips an article with no title link", () => {
  const html = `
    <article class="mod-cal-result__item">
      <h4 class="mod__item-title"><a href="/agenda/evento-tres">Muestra Tres</a></h4>
    </article>
    <article class="mod-cal-result__item">
      <p class="mod-cal-result__item-days">Todo julio</p>
    </article>
  `;

  const result = extractEventArticles(html, "https://artes.uchile.cl/agenda/30dias/6");
  assert.ok(result);
  assert.equal(result.content, '- "Muestra Tres" (fecha no indicada). Lugar: no indicado. Más info: https://artes.uchile.cl/agenda/evento-tres');
});

test("extractEventArticles returns null when the page has no matching <article> blocks (fallback signal)", () => {
  assert.equal(extractEventArticles("<div>algo distinto</div>", "https://otra.cl"), null);
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
