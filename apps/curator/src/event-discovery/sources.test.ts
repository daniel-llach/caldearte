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
  openingTimeConfirmed: true,
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

test("fetchBrightSources dispatches an articleList-configured source to the registry parser, returning structured items", async () => {
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
  assert.equal(results[0].kind, "items");
  if (results[0].kind !== "items") throw new Error("unreachable");
  assert.equal(results[0].items.length, 1);
  assert.equal(results[0].items[0].title, "Muestra");
  assert.equal(results[0].items[0].sourceUrl, "https://sitio.cl/e/1");
});

test("fetchBrightSources falls back to a whole-page flatten (RawResult) when the configured extractor doesn't match the fetched markup", async () => {
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
  assert.equal(results[0].kind, "rawResult");
  if (results[0].kind !== "rawResult") throw new Error("unreachable");
  assert.match(results[0].result.content, /Contenido inesperado/);
});

test("fetchBrightSources falls back to a whole-page flatten (RawResult) for an html source with no extractor configured at all (today's auto-detected sources)", async () => {
  const source: BrightSource = { url: "https://sitio.cl/agenda", note: "sitio" }; // no type, no extractor — the shape an auto-detected row has
  const html = `<html><body><script>ignoreme()</script><p>Texto real del sitio.</p></body></html>`;

  const results = await withStubFetch(() => textResponse(html), () => fetchBrightSources([source]));

  assert.equal(results.length, 1);
  assert.equal(results[0].kind, "rawResult");
  if (results[0].kind !== "rawResult") throw new Error("unreachable");
  assert.match(results[0].result.content, /Texto real del sitio/);
  assert.doesNotMatch(results[0].result.content, /ignoreme/);
});

test("fetchBrightSources merges additionalPages into ONE result — items concatenated across pages (pagination, e.g. arteinformado.com page 2)", async () => {
  const source: BrightSource = {
    url: "https://sitio.cl/agenda",
    note: "sitio",
    extractor: {
      kind: "articleList",
      blockRegex: /<li class="ev">([\s\S]*?)<\/li>/g,
      titleLinkRegex: /<a href="([^"]+)">([^<]*)<\/a>/,
    },
    additionalPages: ["https://sitio.cl/agenda/2"],
  };
  const byUrl: Record<string, string> = {
    "https://sitio.cl/agenda": `<ul><li class="ev"><a href="/e/1">Página uno</a></li></ul>`,
    "https://sitio.cl/agenda/2": `<ul><li class="ev"><a href="/e/2">Página dos</a></li></ul>`,
  };

  const results = await withStubFetch(
    (async (url: string) => textResponse(byUrl[url])) as unknown as StubFetch,
    () => fetchBrightSources([source]),
  );

  // ONE result for the whole logical source, not one per page.
  assert.equal(results.length, 1);
  assert.equal(results[0].kind, "items");
  if (results[0].kind !== "items") throw new Error("unreachable");
  assert.equal(results[0].items.length, 2);
  assert.ok(results[0].items.some((i) => i.title === "Página uno"));
  assert.ok(results[0].items.some((i) => i.title === "Página dos"));
  // The result is still keyed by the source's own primary url — page URLs
  // are an implementation detail, not a separate bright source.
  assert.equal(results[0].source.url, "https://sitio.cl/agenda");
});

test("fetchBrightSources keeps the primary page's result even when an additional page fails — losing one extra page shouldn't drop the whole source", async () => {
  const source: BrightSource = {
    url: "https://sitio.cl/agenda",
    note: "sitio",
    extractor: {
      kind: "articleList",
      blockRegex: /<li class="ev">([\s\S]*?)<\/li>/g,
      titleLinkRegex: /<a href="([^"]+)">([^<]*)<\/a>/,
    },
    additionalPages: ["https://sitio.cl/agenda/2"],
  };
  const stub = (async (url: string) => {
    if (url === "https://sitio.cl/agenda/2") {
      return { ok: false, status: 500, text: async () => "", json: async () => ({}) };
    }
    return textResponse(`<ul><li class="ev"><a href="/e/1">Página uno</a></li></ul>`);
  }) as unknown as StubFetch;

  const results = await withStubFetch(stub, () => fetchBrightSources([source]));

  assert.equal(results.length, 1);
  assert.equal(results[0].kind, "items");
  if (results[0].kind !== "items") throw new Error("unreachable");
  assert.equal(results[0].items.length, 1);
  assert.equal(results[0].items[0].title, "Página uno");
});

test("fetchBrightSources dispatches a wordpressRestApi-configured source to the registry parser, returning structured items", async () => {
  const source: BrightSource = {
    url: "https://sitio.cl/wp-json/wp/v2/events",
    note: "sitio",
    type: "json-api",
    extractor: { kind: "wordpressRestApi", titleField: "title.rendered", linkField: "link", imageField: "image" },
  };
  const items = [{ title: { rendered: "Muestra API" }, link: "https://sitio.cl/e/1", image: "https://sitio.cl/img.jpg" }];

  const results = await withStubFetch(() => jsonResponse(items), () => fetchBrightSources([source]));

  assert.equal(results.length, 1);
  assert.equal(results[0].kind, "items");
  if (results[0].kind !== "items") throw new Error("unreachable");
  assert.equal(results[0].items.length, 1);
  assert.equal(results[0].items[0].imageUrl, "https://sitio.cl/img.jpg");
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
      <p class="mod-cal-result__item-days">Todos los días (excepto el lunes) del 11/07/2026 al 11/10/2026</p>
      <p class="mod-cal-result__item-placer">MAC Quinta Normal</p>
    </article>
  `;

  const results = await withStubFetch(() => textResponse(html), () => fetchBrightSources([{ url: uchile.url, note: uchile.note, extractor: config }]));

  assert.equal(results.length, 1);
  assert.equal(results[0].kind, "items");
  if (results[0].kind !== "items") throw new Error("unreachable");
  assert.equal(results[0].items[0].title, "Muestra Real");
  assert.equal(results[0].items[0].locationHint, "MAC Quinta Normal");
  assert.equal(results[0].items[0].imageUrl, "https://artes.uchile.cl/dam/uno.jpg");
  assert.equal(results[0].items[0].structuredStartDate, "2026-07-11", "dateRangeExtractor parses the real DD/MM/YYYY markup deterministically");
  assert.equal(results[0].items[0].structuredEndDate, "2026-10-11");
});

test("fetchBrightSources against the real KNOWN_SOURCES config for uchile.cl (root domain, cross-faculty) resolves relative hrefs against its own domain, not artes.uchile.cl (regression check against production config, real bug found 2026-07-20)", async () => {
  const uchile = KNOWN_SOURCES.find((s) => s.url === "https://uchile.cl/agenda/30dias/6");
  assert.ok(uchile?.extractor?.kind === "articleList");
  const config = uchile.extractor as ArticleListConfig;

  const html = `
    <article class="mod-cal-result__item">
      <figure><img src="/dam/foto.jpg" alt="Imagen"></figure>
      <h4 class="mod__item-title"><a href="/agenda/241838/exhibicion-alzar-curva-la-mirada-del-artista-francisco-belarmino">Exhibición Alzar curva la mirada</a></h4>
      <p class="mod-cal-result__item-days">Del 1 de julio al 28 de agosto</p>
      <p class="mod-cal-result__item-placer">Galería Micromedios</p>
    </article>
  `;

  const results = await withStubFetch(() => textResponse(html), () => fetchBrightSources([{ url: uchile.url, note: uchile.note, extractor: config }]));

  assert.equal(results.length, 1);
  assert.equal(results[0].kind, "items");
  if (results[0].kind !== "items") throw new Error("unreachable");
  assert.equal(results[0].items[0].title, "Exhibición Alzar curva la mirada");
  assert.equal(results[0].items[0].locationHint, "Galería Micromedios");
  assert.equal(
    results[0].items[0].sourceUrl,
    "https://uchile.cl/agenda/241838/exhibicion-alzar-curva-la-mirada-del-artista-francisco-belarmino",
  );
  assert.equal(results[0].items[0].imageUrl, "https://uchile.cl/dam/foto.jpg");
});

test("fetchBrightSources against the real KNOWN_SOURCES config for molinomachmar.cl extracts an exhibition even when it sits past the whole-page-flatten's char cutoff (regression check against production config, real bug found 2026-07-16)", async () => {
  const camm = KNOWN_SOURCES.find((s) => s.url.includes("molinomachmar.cl"));
  assert.ok(camm?.extractor?.kind === "articleList");
  const config = camm.extractor as ArticleListConfig;

  // Padding simulates the real page's nav/header/other-event bulk that
  // pushed exhibitions past sources.ts's 4000-char whole-page-flatten
  // cutoff — proves the dedicated extractor reads the WHOLE page, not
  // just a prefix.
  const padding = "x".repeat(5000);
  const html = `
    <div>${padding}</div>
    <article class="page-evento rpt-64 post-6328 camm_evento camm_tax_area-exposicion">
      <img src="/web/wp-content/uploads/2026/06/paloma.jpg" alt="Foto">
      <div class="evento-fecha ff-secondary rt-h1--2"><span>20 JUN</span><span>16 AGO</span></div>
      <p class="evento-ano ff-secondary rt-h1--2">2026</p>
      <h3 class="rtxl">UNA PALOMA EN EL MOLINO</h3>
      <a href="/cartelera/una-paloma-en-el-molino/" title="Leer: UNA PALOMA EN EL MOLINO" class="page-evento__enlace no-tooltip"></a>
    </article>
  `;

  const results = await withStubFetch(() => textResponse(html), () => fetchBrightSources([{ url: camm.url, note: camm.note, extractor: config }]));

  assert.equal(results.length, 1);
  assert.equal(results[0].kind, "items");
  if (results[0].kind !== "items") throw new Error("unreachable");
  assert.equal(results[0].items[0].title, "UNA PALOMA EN EL MOLINO");
  assert.equal(results[0].items[0].rawDateText, "20 JUN 16 AGO 2026");
  assert.equal(results[0].items[0].imageUrl, "https://www.molinomachmar.cl/web/wp-content/uploads/2026/06/paloma.jpg");
});

test("fetchBrightSources against the real KNOWN_SOURCES config for arteinformado.com extracts per-event links, not the aggregator page's own URL (regression check against production config, real bug found 2026-07-16)", async () => {
  const arteinformado = KNOWN_SOURCES.find((s) => s.url.includes("arteinformado.com"));
  assert.ok(arteinformado?.extractor?.kind === "articleList");
  const config = arteinformado.extractor as ArticleListConfig;

  // Real markup shape: NOT a per-event wrapper element — each event is two
  // sibling <div class="col-md-2..."> (image link) + <div class="col-md-4...">
  // (title/dates/place) columns in a row, back to back with the next event's
  // pair. Two events here to prove the blockRegex's lookahead boundary
  // correctly splits them instead of swallowing both into one block.
  const html = `
    <div class="row top30">
      <div class="col-md-2 col-sm-4 bottom30">
        <a href="https://www.arteinformado.com/agenda/f/existen-otros-mundos-243857" onclick="showEntity(event, this)">
          <img src="/docs/evento/57/f.uno.jpg" alt="Existen otros mundos">
        </a>
      </div>
      <div class="col-md-4 col-sm-8 bottom30">
        <h3><a href="https://www.arteinformado.com/agenda/f/existen-otros-mundos-243857" onclick="showEntity(event, this)">Existen otros mundos, pero están en este</a></h3>
        <div class="min-alto-agenda">
          <span class="txt-date txt-gris">25 abr de 2026 - 23 ago de 2026</span>
          <div class="font17">MAC - Espacio Quinta Normal</div>
          <div class="font17 txt-gris">Avda. Matucana, 464, Santiago</div>
        </div>
      </div><div class="col-md-2 col-sm-4 bottom30">
        <a href="https://www.arteinformado.com/agenda/f/sin-tesis-999999" onclick="showEntity(event, this)">
          <img src="/docs/evento/99/f.dos.jpg" alt="Sín-tesis">
        </a>
      </div>
      <div class="col-md-4 col-sm-8 bottom30">
        <h3><a href="https://www.arteinformado.com/agenda/f/sin-tesis-999999" onclick="showEntity(event, this)">Sín-tesis</a></h3>
        <div class="min-alto-agenda">
          <span class="txt-date txt-gris">01 jul de 2026 - 15 ago de 2026</span>
          <div class="font17">Galeria NAC</div>
          <div class="font17 txt-gris">Américo Vespucio Norte #2878, Santiago</div>
        </div>
      </div>
    </div>
  `;

  const results = await withStubFetch(() => textResponse(html), () => fetchBrightSources([{ url: arteinformado.url, note: arteinformado.note, extractor: config }]));

  assert.equal(results.length, 1);
  assert.equal(results[0].kind, "items");
  if (results[0].kind !== "items") throw new Error("unreachable");
  assert.equal(results[0].items.length, 2);
  assert.equal(results[0].items[0].title, "Existen otros mundos, pero están en este");
  assert.equal(results[0].items[0].sourceUrl, "https://www.arteinformado.com/agenda/f/existen-otros-mundos-243857");
  assert.equal(results[0].items[1].title, "Sín-tesis");
  assert.equal(results[0].items[1].sourceUrl, "https://www.arteinformado.com/agenda/f/sin-tesis-999999");
  // The two events' own detail-page links, NOT the single aggregator page URL.
  assert.equal(results[0].items[0].imageUrl, "https://www.arteinformado.com/docs/evento/57/f.uno.jpg");
  assert.equal(results[0].items[1].imageUrl, "https://www.arteinformado.com/docs/evento/99/f.dos.jpg");
  // dateRangeExtractor deterministically parses this real date text —
  // real production regression, 2026-07-24: a live ~28-item batch left
  // to Haiku's own interpretation came back with every runStartDate/
  // runEndDate null despite text this unambiguous.
  assert.equal(results[0].items[0].structuredStartDate, "2026-04-25");
  assert.equal(results[0].items[0].structuredEndDate, "2026-08-23");
  assert.equal(results[0].items[1].structuredStartDate, "2026-07-01");
  assert.equal(results[0].items[1].structuredEndDate, "2026-08-15");
});

test("fetchBrightSources against the real KNOWN_SOURCES config for mnba.gob.cl reads the embedded machine-readable date directly, no month-name parsing needed (regression check against production config)", async () => {
  const mnba = KNOWN_SOURCES.find((s) => s.url.includes("mnba.gob.cl"));
  assert.ok(mnba?.extractor?.kind === "articleList");
  const config = mnba.extractor as ArticleListConfig;

  const html = `
    <article class="node node--evento">
      <h2 class="destacado__title"><a href="/cartelera/roberto-matta-abrir-la-mirada">Roberto Matta. Abrir la mirada</a></h2>
      <div class="field--name-field-fechas"><time datetime="2025-07-10T12:00:00Z">10/Julio/2025</time>
       hasta el <time datetime="2027-07-31T12:00:00Z">31/Julio/2027</time>
      </div>
      <div class="field--name-institucion"><a href="/espacios/sala-chile">Sala Chile</a></div>
    </article>
  `;

  const results = await withStubFetch(() => textResponse(html), () => fetchBrightSources([{ url: mnba.url, note: mnba.note, extractor: config }]));

  assert.equal(results.length, 1);
  assert.equal(results[0].kind, "items");
  if (results[0].kind !== "items") throw new Error("unreachable");
  assert.equal(results[0].items[0].title, "Roberto Matta. Abrir la mirada");
  assert.equal(results[0].items[0].structuredStartDate, "2025-07-10");
  assert.equal(results[0].items[0].structuredEndDate, "2027-07-31");
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

test("detectNewBrightSources domain-matches consistently with knownSourceDomain (real production bug, 2026-07-17): a 'www.' host in existingDomains correctly excludes a candidate whose sourceUrl is also 'www.'-prefixed", () => {
  // run.ts builds existingDomains via knownSourceDomain(), which does NOT
  // strip "www." — this function used to strip it internally, so
  // "www.arteinformado.com" in existingDomains never matched this
  // function's own "arteinformado.com", and an ALREADY-known source kept
  // getting flagged "new" every run, eventually crashing on
  // detected_sources' unique constraint on url.
  const candidates: EventCandidate[] = [
    { ...completeCandidate, title: "Uno", sourceUrl: "https://www.arteinformado.com/agenda/f/uno" },
    { ...completeCandidate, title: "Dos", sourceUrl: "https://www.arteinformado.com/agenda/f/dos" },
  ];
  const detected = detectNewBrightSources(candidates, NOW, ["www.arteinformado.com"]);
  assert.equal(detected.length, 0, "already-known www.-prefixed domain must not be re-detected as new");
});
