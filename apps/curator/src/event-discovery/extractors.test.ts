import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractArticleList,
  extractImgTags,
  extractWordpressItems,
  filterKnownSourceImages,
  type ArticleListConfig,
  type WordpressRestConfig,
} from "./extractors.js";

test("extractImgTags pulls src/alt pairs and treats empty alt as null", () => {
  const html = `<div><img src="/a.jpg" alt="obra"> <img src="/b.jpg" alt=""> <img alt="no src"></div>`;
  const images = extractImgTags(html);
  assert.deepEqual(images, [
    { url: "/a.jpg", description: "obra" },
    { url: "/b.jpg", description: null },
  ]);
});

test("extractImgTags decodes HTML entities in src (e.g. Drupal's correctly-escaped '&amp;' in image-style query strings)", () => {
  const html = `<img src="/img.jpg?h=abc123&amp;itok=xyz789" alt="foto">`;
  assert.deepEqual(extractImgTags(html), [{ url: "/img.jpg?h=abc123&itok=xyz789", description: "foto" }]);
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

// Matches artes.uchile.cl's real markup — the same config known-sources.ts
// gives uchile in production.
const UCHILE_CONFIG: ArticleListConfig = {
  kind: "articleList",
  blockRegex: /<article class="mod-cal-result__item">([\s\S]*?)<\/article>/g,
  titleLinkRegex: /<h4 class="mod__item-title"><a href="([^"]+)">([^<]*)<\/a><\/h4>/,
  daysRegex: /class="mod-cal-result__item-days"[^>]*>([\s\S]*?)<\/p>/,
  placeRegex: /class="mod-cal-result__item-place[a-z]*"[^>]*>([\s\S]*?)<\/p>/,
};

test("extractArticleList pairs each event with its own structured title/link/image/date/place, handling the item-place/item-placer typo", () => {
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

  const items = extractArticleList(html, "https://artes.uchile.cl/agenda/30dias/6", UCHILE_CONFIG);
  assert.ok(items);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    title: "Muestra Uno",
    sourceUrl: "https://artes.uchile.cl/agenda/evento-uno",
    imageUrl: "https://artes.uchile.cl/dam/uno.jpg",
    description: null,
    locationHint: "Sala Juan Egenau",
    rawDateText: "Del 1 al 20 de julio",
    structuredStartDate: null,
    structuredEndDate: null,
  });
  assert.deepEqual(items[1], {
    title: "Muestra Dos",
    sourceUrl: "https://artes.uchile.cl/agenda/evento-dos",
    imageUrl: "https://artes.uchile.cl/dam/dos.jpg",
    description: null,
    locationHint: "Galería Central",
    rawDateText: "Del 5 al 30 de julio",
    structuredStartDate: null,
    structuredEndDate: null,
  });
});

test("extractArticleList falls back to placeholder date text when days/place are missing, but skips a block with no title link", () => {
  const html = `
    <article class="mod-cal-result__item">
      <h4 class="mod__item-title"><a href="/agenda/evento-tres">Muestra Tres</a></h4>
    </article>
    <article class="mod-cal-result__item">
      <p class="mod-cal-result__item-days">Todo julio</p>
    </article>
  `;

  const items = extractArticleList(html, "https://artes.uchile.cl/agenda/30dias/6", UCHILE_CONFIG);
  assert.ok(items);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Muestra Tres");
  assert.equal(items[0].sourceUrl, "https://artes.uchile.cl/agenda/evento-tres");
  assert.equal(items[0].rawDateText, "fecha no indicada");
  assert.equal(items[0].locationHint, null);
});

test("extractArticleList returns null when the page has no matching blocks (fallback signal)", () => {
  assert.equal(extractArticleList("<div>algo distinto</div>", "https://otra.cl", UCHILE_CONFIG), null);
});

test("extractArticleList is genuinely config-driven: a different site's markup works with only a different config, no code change", () => {
  // A hypothetical second html bright source with completely different
  // class names/tag structure — proves this isn't uchile-specific code
  // with the site name changed.
  const otherSiteConfig: ArticleListConfig = {
    kind: "articleList",
    blockRegex: /<li class="event-card">([\s\S]*?)<\/li>/g,
    titleLinkRegex: /<a class="event-card__link" href="([^"]+)">([^<]*)<\/a>/,
    placeRegex: /<span class="venue">([\s\S]*?)<\/span>/,
    // no daysRegex configured for this site — must still work (optional field).
  };
  const html = `<ul><li class="event-card"><a class="event-card__link" href="/e/1">Otra Muestra</a><span class="venue">MAVI</span></li></ul>`;
  const items = extractArticleList(html, "https://otro-sitio.cl/agenda", otherSiteConfig);
  assert.ok(items);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Otra Muestra");
  assert.equal(items[0].sourceUrl, "https://otro-sitio.cl/e/1");
  assert.equal(items[0].locationHint, "MAVI");
  assert.equal(items[0].rawDateText, "fecha no indicada");
});

// Matches Parque Cultural Valparaíso's real WordPress meta-field names —
// the same config known-sources.ts gives it in production.
const PARQUE_CULTURAL_CONFIG: WordpressRestConfig = {
  kind: "wordpressRestApi",
  titleField: "title.rendered",
  linkField: "meta.link_al_evento",
  imageField: "meta.imagen_evento",
  descriptionField: "meta.extracto_corto",
  startDateField: "meta.fecha_de_inicio",
  endDateField: "meta.fecha_de_termino",
};

test("extractWordpressItems maps title/image/description/dates/link by configured dotted paths, resolving structured start/end dates directly", () => {
  const items = [
    {
      title: { rendered: "Expo A" },
      meta: {
        link_al_evento: "https://parquecultural.cl/expo-a",
        imagen_evento: "https://parquecultural.cl/img/a.jpg",
        extracto_corto: "Inauguración 20 de julio a las 19h.",
        fecha_de_inicio: "20260701",
        fecha_de_termino: "20260830",
      },
    },
  ];
  const result = extractWordpressItems(items, PARQUE_CULTURAL_CONFIG, "https://parquecultural.cl/agenda");
  assert.deepEqual(result, [
    {
      title: "Expo A",
      sourceUrl: "https://parquecultural.cl/expo-a",
      imageUrl: "https://parquecultural.cl/img/a.jpg",
      description: "Inauguración 20 de julio a las 19h.",
      locationHint: null,
      rawDateText: "Inauguración 20 de julio a las 19h.",
      structuredStartDate: "2026-07-01",
      structuredEndDate: "2026-08-30",
    },
  ]);
});

test("extractWordpressItems falls back gracefully: missing link uses fallbackUrl, missing dates are null (not a display placeholder), missing description is null", () => {
  const items = [{ title: { rendered: "Expo B" }, meta: {} }];
  const result = extractWordpressItems(items, PARQUE_CULTURAL_CONFIG, "https://parquecultural.cl/agenda");
  assert.deepEqual(result, [
    {
      title: "Expo B",
      sourceUrl: "https://parquecultural.cl/agenda",
      imageUrl: null,
      description: null,
      locationHint: null,
      rawDateText: "",
      structuredStartDate: null,
      structuredEndDate: null,
    },
  ]);
});

test("extractWordpressItems is genuinely config-driven: a different WordPress site's field names work with only a different config", () => {
  // A hypothetical second wordpressRestApi source using standard WP fields
  // instead of Parque Cultural's custom meta.* names — proves this isn't
  // hardcoded to one site's schema.
  const otherSiteConfig: WordpressRestConfig = {
    kind: "wordpressRestApi",
    titleField: "title.rendered",
    linkField: "link",
    imageField: "featured_image_url",
  };
  const items = [{ title: { rendered: "Otra Expo" }, link: "https://otro.cl/p/1", featured_image_url: "https://otro.cl/img.jpg" }];
  const result = extractWordpressItems(items, otherSiteConfig, "https://otro.cl/agenda");
  assert.equal(result.length, 1);
  assert.equal(result[0].title, "Otra Expo");
  assert.equal(result[0].sourceUrl, "https://otro.cl/p/1");
  assert.equal(result[0].imageUrl, "https://otro.cl/img.jpg");
  assert.equal(result[0].structuredStartDate, null);
});
