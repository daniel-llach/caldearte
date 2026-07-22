import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyKnownExclusionsFilter,
  applyLocationFilter,
  buildQueries,
  currentMonthLabel,
  enforceGroundedQuotes,
  enforceSourceUrlInvariant,
  filterImageCandidates,
  filterKnownExclusions,
  firstOfMonthIso,
  isCurrentOrUpcoming,
  logBareDomainSourceUrls,
  normalizeTitle,
  nullifyAggregatorSourceUrls,
  nullifyOpeningDatetimeForKnownSources,
  searchUnit,
  curate,
  type EventCandidate,
  type MessagesClient,
  type RawResult,
} from "./discover.js";
import type { FetchLike } from "../lib/tavily.js";

// Used as the `block` param for every curate(...) integration test below —
// real content, not a placeholder, since enforceGroundedQuotes now checks
// dateQuote/locationQuote against it.
const TEST_BLOCK = "### Muestra X\nhttps://example.cl/expo\nInauguración: 26 de julio a las 12:30 en Providencia, Santiago, Chile.";

const baseCandidate: EventCandidate = {
  title: "Muestra X",
  description: null,
  artist: null,
  runStartDate: "2026-07-05",
  runEndDate: null,
  openingDatetime: null,
  openingTimeConfirmed: true,
  mediumType: "tradicional",
  sensitivityTags: [],
  curationReasoning: "ok",
  imageUrl: null,
  status: "approved",
  location: "Providencia, Santiago, Chile",
  placeName: null,
  sourceUrl: "https://example.cl/expo",
  dateQuote: null,
  locationQuote: "Providencia, Santiago, Chile",
};

test("buildQueries produces the 3 validated templates with the month label, appending ', Chile' to disambiguate comuna-name collisions (e.g. La Reina / Reina Sofía)", () => {
  const queries = buildQueries("Providencia", new Date("2026-07-12T12:00:00Z"));
  assert.equal(queries.length, 3);
  assert.equal(queries[0], "inauguracion arte Providencia, Chile julio 2026");
  assert.equal(queries[1], "exposicion arte Providencia, Chile julio 2026");
  assert.equal(queries[2], "intervencion artistica Providencia, Chile julio 2026");
});

test("firstOfMonthIso and currentMonthLabel agree on the month", () => {
  const now = new Date(2026, 11, 31); // Dec 31, local time — no UTC drift
  assert.equal(firstOfMonthIso(now), "2026-12-01");
  assert.equal(currentMonthLabel(now), "diciembre 2026");
});

test("filterImageCandidates drops junk, requires a description, caps at 4", () => {
  const images = [
    { url: "https://x.cl/logo.png", description: "real desc" }, // junk by filename
    { url: "https://x.cl/a.svg", description: "real desc" }, // svg
    { url: "https://x.cl/obra1.jpg", description: null }, // no description
    { url: "https://x.cl/obra2.jpg", description: "afiche de la expo" },
    { url: "https://x.cl/obra3.jpg", description: "d3" },
    { url: "https://x.cl/obra4.jpg", description: "d4" },
    { url: "https://x.cl/obra5.jpg", description: "d5" },
    { url: "https://x.cl/obra6.jpg", description: "d6" }, // over the cap
  ];
  const kept = filterImageCandidates(images);
  assert.equal(kept.length, 4);
  assert.equal(kept[0].url, "https://x.cl/obra2.jpg");
});

test("applyLocationFilter rejects approved candidates outside Chile, including the Recoleta/Buenos Aires collision", () => {
  const filtered = applyLocationFilter([
    { ...baseCandidate, location: "Centro Cultural Recoleta, Buenos Aires, Argentina" },
    { ...baseCandidate, title: "Otra", location: "Recoleta, Santiago, Chile" },
    { ...baseCandidate, title: "Sin lugar", location: "un lugar cualquiera" },
    { ...baseCandidate, title: "Ya rechazada", status: "rejected", location: "Lima" },
  ]);

  assert.equal(filtered[0].status, "rejected");
  assert.match(filtered[0].curationReasoning, /FILTRO DE CÓDIGO/);
  assert.equal(filtered[1].status, "approved");
  assert.equal(filtered[2].status, "rejected");
  // Already-rejected candidates pass through untouched.
  assert.doesNotMatch(filtered[3].curationReasoning, /FILTRO DE CÓDIGO/);
});

test("applyLocationFilter does not false-positive on a Chilean place that contains a foreign country's name", () => {
  // Real production bug (first live run): "Parque Ecuador" is a real,
  // well-known park in Concepción, Chile — a naive substring check against
  // "ecuador" rejected it. The override only fires on an exact trailing
  // "..., <country>" segment now, not anywhere in the string.
  const filtered = applyLocationFilter([
    { ...baseCandidate, location: "Concepción, Parque Ecuador" },
  ]);
  assert.equal(filtered[0].status, "approved");
});

test("enforceGroundedQuotes keeps a candidate whose dateQuote and locationQuote both appear literally in the block", () => {
  const block = "### Muestra X\nInauguración: 4 de junio, 19 hrs. Providencia, Santiago, Chile.";
  const filtered = enforceGroundedQuotes(
    [{ ...baseCandidate, openingDatetime: "2026-06-04T19:00:00.000Z", dateQuote: "4 de junio, 19 hrs" }],
    block,
  );
  assert.equal(filtered[0].status, "approved");
  assert.ok(filtered[0].openingDatetime);
});

// Reproduces the real case found 2026-07-22: "Inauguración de arte
// visual" (Curacautín) was curated with "Inauguración: 09 de julio del
// 2026 a las 19:00 horas" cited as confirmed — a phrase that never
// appeared anywhere in the real source text, which was actually about a
// different exhibition closing (not opening) in a different city.
test("enforceGroundedQuotes nulls openingDatetime (keeps the candidate) when dateQuote doesn't appear in the block — fabricated date, real production case", () => {
  const block = "### Muestra X\nLa exposición estará en Espacio Cultural La Merced hasta el tres de julio. Providencia, Santiago, Chile.";
  const filtered = enforceGroundedQuotes(
    [
      {
        ...baseCandidate,
        openingDatetime: "2026-07-09T23:00:00.000Z",
        dateQuote: "Inauguración: 09 de julio del 2026 a las 19:00 horas",
      },
    ],
    block,
  );
  assert.equal(filtered[0].status, "approved", "rest of the candidate survives — it may still be a valid expo");
  assert.equal(filtered[0].openingDatetime, null);
  assert.equal(filtered[0].openingTimeConfirmed, false);
});

test("enforceGroundedQuotes nulls openingDatetime when dateQuote is missing entirely", () => {
  const filtered = enforceGroundedQuotes([{ ...baseCandidate, openingDatetime: "2026-07-09T23:00:00.000Z", dateQuote: null }], TEST_BLOCK);
  assert.equal(filtered[0].openingDatetime, null);
});

// Reproduces the real case found 2026-07-22: "Intervención artística de
// Víctor García Cuevas" was curated with a Chilean comuna as its
// location — the real post was about an exhibition in Jaén, Spain, which
// the source text never disputes being outside Chile because it never
// claims Chile at all.
test("enforceGroundedQuotes rejects the whole candidate when locationQuote doesn't appear in the block — fabricated location, real production case", () => {
  const block = "### Intervención\nEl próximo sábado vuelvo a habitar el refugio antiaéreo de la Guerra Civil de Jaén.";
  const filtered = enforceGroundedQuotes([{ ...baseCandidate, location: "Corral, Los Ríos, Chile", locationQuote: "Corral, Los Ríos, Chile" }], block);
  assert.equal(filtered[0].status, "rejected");
});

test("enforceGroundedQuotes rejects the whole candidate when locationQuote is missing entirely", () => {
  const filtered = enforceGroundedQuotes([{ ...baseCandidate, locationQuote: null }], TEST_BLOCK);
  assert.equal(filtered[0].status, "rejected");
});

test("enforceGroundedQuotes leaves already-rejected candidates untouched", () => {
  const filtered = enforceGroundedQuotes([{ ...baseCandidate, status: "rejected", locationQuote: null }], TEST_BLOCK);
  assert.equal(filtered[0].status, "rejected");
});

test("enforceGroundedQuotes normalizes whitespace/case — doesn't false-reject on trivial formatting differences", () => {
  const block = "### Muestra X\n  Providencia,   SANTIAGO,\nChile  ";
  const filtered = enforceGroundedQuotes([{ ...baseCandidate, locationQuote: "Providencia, Santiago, Chile" }], block);
  assert.equal(filtered[0].status, "approved");
});

// Real production gap, found 2026-07-22 (first run after this filter
// shipped): checking a quote against the WHOLE block let Haiku cite real
// text from a DIFFERENT result in the same batch and misattribute it to
// an unrelated candidate. Two confirmed cases: "Instalación País: Chile
// 2026" (a plain photo post, no date at all) got a fabricated Cerrillos
// venue/date; "Expo Noah Bliazi" got an inauguración quote that was real
// text from an unrelated Puente Alto workshops post. This reproduces that
// exact shape: two results in one block, a candidate citing the OTHER
// result's real text as if it were its own.
test("enforceGroundedQuotes checks a candidate's quotes only against its OWN result section — a quote that's real but belongs to a different result doesn't count", () => {
  const block = [
    "## Resultados",
    "",
    "### Instalación País: Chile 2026\nhttps://www.instagram.com/p/DWz9QRfkfhr\nUna de las fotos de la selección de Chile. Urban Installations, 1993-2026.",
    "### Otra exposición\nhttps://example.cl/otra-expo\nInauguración: 9 de julio en Cerrillos, Santiago.",
  ].join("\n\n");

  const filtered = enforceGroundedQuotes(
    [
      {
        ...baseCandidate,
        sourceUrl: "https://www.instagram.com/p/DWz9QRfkfhr", // its OWN section has no date/venue at all
        openingDatetime: "2026-07-09T00:00:00.000Z",
        dateQuote: "9 de julio", // real text, but from the OTHER result
        locationQuote: "Cerrillos, Santiago", // real text, but from the OTHER result
      },
    ],
    block,
  );

  assert.equal(filtered[0].status, "rejected", "the location quote isn't in this candidate's own section, even though it's real text elsewhere in the block");
});

test("enforceGroundedQuotes still grounds correctly when quotes genuinely belong to the candidate's own section, in a multi-result block", () => {
  const block = [
    "## Resultados",
    "",
    "### Instalación País: Chile 2026\nhttps://www.instagram.com/p/DWz9QRfkfhr\nUna de las fotos de la selección de Chile. Urban Installations, 1993-2026.",
    "### Otra exposición\nhttps://example.cl/otra-expo\nInauguración: 9 de julio en Cerrillos, Santiago.",
  ].join("\n\n");

  const filtered = enforceGroundedQuotes(
    [{ ...baseCandidate, sourceUrl: "https://example.cl/otra-expo", openingDatetime: "2026-07-09T00:00:00.000Z", dateQuote: "9 de julio", locationQuote: "Cerrillos, Santiago" }],
    block,
  );

  assert.equal(filtered[0].status, "approved");
  assert.ok(filtered[0].openingDatetime);
});

test("enforceGroundedQuotes falls back to checking the whole block when a candidate's sourceUrl doesn't match any result section (e.g. an aggregator URL)", () => {
  const block = "### Muestra X\nhttps://example.cl/expo\nInauguración: 26 de julio a las 12:30 en Providencia, Santiago, Chile.";
  const filtered = enforceGroundedQuotes(
    [{ ...baseCandidate, sourceUrl: "https://agenda.cl/listado-general", locationQuote: "Providencia, Santiago, Chile" }],
    block,
  );
  assert.equal(filtered[0].status, "approved");
});

test("nullifyAggregatorSourceUrls nulls sourceUrl when 2+ approved candidates share it (a listing page, not an event page), but leaves a uniquely-sourced one alone", () => {
  const listing = "https://agenda.cl/listado";
  const candidates = [
    { ...baseCandidate, title: "Uno", sourceUrl: listing },
    { ...baseCandidate, title: "Dos", sourceUrl: listing },
    { ...baseCandidate, title: "Tres", sourceUrl: "https://sitio.cl/evento-tres" },
  ];
  const result = nullifyAggregatorSourceUrls(candidates);
  assert.equal(result[0].sourceUrl, null);
  assert.equal(result[1].sourceUrl, null);
  assert.equal(result[2].sourceUrl, "https://sitio.cl/evento-tres");
});

test("nullifyAggregatorSourceUrls ignores rejected candidates and null sourceUrls when counting", () => {
  const shared = "https://agenda.cl/listado";
  const candidates = [
    { ...baseCandidate, title: "Aprobada", sourceUrl: shared },
    { ...baseCandidate, title: "Rechazada", status: "rejected" as const, sourceUrl: shared },
    { ...baseCandidate, title: "Sin URL", sourceUrl: null },
  ];
  const result = nullifyAggregatorSourceUrls(candidates);
  // Only one APPROVED candidate actually has this URL — not shared, stays.
  assert.equal(result[0].sourceUrl, shared);
  assert.equal(result[1].sourceUrl, shared, "rejected candidates pass through untouched");
  assert.equal(result[2].sourceUrl, null);
});

test("enforceSourceUrlInvariant forces approved events without sourceUrl to rejected (Haiku prompt violation)", () => {
  const candidates = [
    { ...baseCandidate, title: "Aprobado con URL", status: "approved" as const, sourceUrl: "https://x.cl" },
    { ...baseCandidate, title: "Aprobado sin URL (invariante violado)", status: "approved" as const, sourceUrl: null },
    { ...baseCandidate, title: "Rechazado sin URL (ok)", status: "rejected" as const, sourceUrl: null },
  ];
  const result = enforceSourceUrlInvariant(candidates);
  assert.equal(result[0].status, "approved", "approved with sourceUrl passes through");
  assert.equal(result[1].status, "rejected", "approved without sourceUrl is forced to rejected");
  assert.match(result[1].curationReasoning, /invariante/);
  assert.equal(result[2].status, "rejected", "rejected without sourceUrl is unchanged");
});

test("logBareDomainSourceUrls logs a warning for an approved candidate whose sourceUrl is a bare domain root, but does NOT change its status — real audit finding (2026-07-20): 2 approved events had sourceUrl pointing only to a homepage, not the actual event page; a hard rejection risks false-rejecting a small comuna's genuinely single-page site", () => {
  const candidates = [
    { ...baseCandidate, title: "Bare root", status: "approved" as const, sourceUrl: "https://culturacopiapo.cl" },
    { ...baseCandidate, title: "Bare root with trailing slash", status: "approved" as const, sourceUrl: "https://museoregionalaysen.gob.cl/" },
    { ...baseCandidate, title: "Specific page", status: "approved" as const, sourceUrl: "https://example.cl/agenda/mi-expo" },
  ];
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);
  try {
    const result = logBareDomainSourceUrls(candidates);
    assert.deepEqual(result, candidates, "candidates and their status are never modified");
    assert.equal(logs.length, 2);
    assert.match(logs[0], /Bare root".*culturacopiapo\.cl/);
    assert.match(logs[1], /Bare root with trailing slash/);
  } finally {
    console.log = originalLog;
  }
});

test("logBareDomainSourceUrls ignores rejected candidates and candidates with no sourceUrl or an unparseable one", () => {
  const candidates = [
    { ...baseCandidate, status: "rejected" as const, sourceUrl: "https://bare-root-but-rejected.cl" },
    { ...baseCandidate, status: "approved" as const, sourceUrl: null },
    { ...baseCandidate, status: "approved" as const, sourceUrl: "not a url" },
  ];
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);
  try {
    logBareDomainSourceUrls(candidates);
    assert.equal(logs.length, 0);
  } finally {
    console.log = originalLog;
  }
});

test("nullifyOpeningDatetimeForKnownSources nulls a fabricated openingDatetime for mavi.uc.cl and uc.cl/agenda sources — real bugs, found 2026-07-20: two MAVI-sourced events got the identical fabricated hour, a third had a visita-mediada time stored as an inauguración", () => {
  const candidates = [
    { ...baseCandidate, title: "Bare MAVI domain", sourceUrl: "https://mavi.uc.cl", openingDatetime: "2026-07-22T19:00:00.000Z" },
    { ...baseCandidate, title: "UC agenda detail page", sourceUrl: "https://www.uc.cl/agenda/actividad/mavi-uc-conmemora-su-25-aniversario", openingDatetime: "2026-07-25T20:00:00.000Z" },
  ];
  const result = nullifyOpeningDatetimeForKnownSources(candidates);
  assert.equal(result[0].openingDatetime, null);
  assert.match(result[0].curationReasoning, /FILTRO DE CÓDIGO/);
  assert.equal(result[1].openingDatetime, null);
});

test("nullifyOpeningDatetimeForKnownSources leaves other domains, null openingDatetime, and null sourceUrl untouched", () => {
  const candidates = [
    { ...baseCandidate, title: "Different domain", sourceUrl: "https://example.cl/expo", openingDatetime: "2026-07-22T19:00:00.000Z" },
    { ...baseCandidate, title: "No date to begin with", sourceUrl: "https://mavi.uc.cl", openingDatetime: null },
    { ...baseCandidate, title: "No sourceUrl", sourceUrl: null, openingDatetime: "2026-07-22T19:00:00.000Z" },
  ];
  const result = nullifyOpeningDatetimeForKnownSources(candidates);
  assert.equal(result[0].openingDatetime, "2026-07-22T19:00:00.000Z");
  assert.equal(result[1].openingDatetime, null);
  assert.equal(result[2].openingDatetime, "2026-07-22T19:00:00.000Z");
});

test("nullifyOpeningDatetimeForKnownSources doesn't treat the general uc.cl domain outside /agenda as a known no-inauguración source", () => {
  const candidates = [{ ...baseCandidate, sourceUrl: "https://www.uc.cl/noticias/algo-completamente-distinto", openingDatetime: "2026-07-22T19:00:00.000Z" }];
  const result = nullifyOpeningDatetimeForKnownSources(candidates);
  assert.equal(result[0].openingDatetime, "2026-07-22T19:00:00.000Z");
});

test("filterKnownExclusions drops a raw search result whose own title matches a known out-of-scope event, before it ever reaches Haiku", () => {
  const results: RawResult[] = [
    { title: "Festival Santiago a Mil - XXXIII edición vuelve con todo", url: "https://x.cl/1", content: "c", score: 0.9, images: [] },
    { title: "Exposición Colectiva Sala FEM 2026", url: "https://x.cl/2", content: "c", score: 0.9, images: [] },
  ];
  const filtered = filterKnownExclusions(results);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].url, "https://x.cl/2");
});

test("filterKnownExclusions also drops results from known low-quality-extraction domains, regardless of title", () => {
  const results: RawResult[] = [
    {
      title: "Guía de arte y cultura: semana del 17 al 24 de julio de 2026",
      url: "https://www.infobae.com/cultura/agenda-cultura/2026/07/17/guia-de-arte-y-cultura-semana-del-17-al-24-de-julio-de-2026",
      content: "c",
      score: 0.9,
      images: [],
    },
    { title: "Exposición Colectiva Sala FEM 2026", url: "https://x.cl/2", content: "c", score: 0.9, images: [] },
  ];
  const filtered = filterKnownExclusions(results);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].url, "https://x.cl/2");
});

test("applyKnownExclusionsFilter forces a matching approved candidate to rejected with a reasoning note, but leaves rejected/unrelated candidates untouched", () => {
  const candidates = [
    { ...baseCandidate, title: "Festival Santiago a Mil - XXXIII edición", status: "approved" as const },
    { ...baseCandidate, title: "Festival Santiago a Mil ya rechazado", status: "rejected" as const },
    { ...baseCandidate, title: "Muestra sin relación", status: "approved" as const },
  ];
  const result = applyKnownExclusionsFilter(candidates);
  assert.equal(result[0].status, "rejected");
  assert.match(result[0].curationReasoning, /FILTRO DE CÓDIGO/);
  assert.doesNotMatch(result[1].curationReasoning, /FILTRO DE CÓDIGO/, "already-rejected candidates pass through untouched");
  assert.equal(result[2].status, "approved");
});

test("isCurrentOrUpcoming applies the month-level rule, not day-level", () => {
  const now = new Date(2026, 6, 12); // July 12, 2026, local time
  // Run ended earlier this same month but its date already passed → still current.
  assert.equal(isCurrentOrUpcoming({ ...baseCandidate, runStartDate: "2026-07-01", runEndDate: "2026-07-10" }, now), true);
  // Ended in a previous month → stale.
  assert.equal(isCurrentOrUpcoming({ ...baseCandidate, runStartDate: "2026-05-01", runEndDate: "2026-06-28" }, now), false);
  // Opens next month → valid (future event found incidentally).
  assert.equal(isCurrentOrUpcoming({ ...baseCandidate, runStartDate: "2026-08-09", runEndDate: null }, now), true);
  // Only an opening datetime, this month → valid.
  assert.equal(
    isCurrentOrUpcoming({ ...baseCandidate, runStartDate: null, openingDatetime: "2026-07-20T19:00:00-04:00" }, now),
    true,
  );
  // No date at all → unusable.
  assert.equal(isCurrentOrUpcoming({ ...baseCandidate, runStartDate: null, runEndDate: null, openingDatetime: null }, now), false);
});

test("normalizeTitle strips accents, quotes, and collapses whitespace", () => {
  assert.equal(normalizeTitle('Exposición "Poética de las aguas"'), "exposicion poetica de las aguas");
  assert.equal(normalizeTitle("  Poética   de las AGUAS "), "poetica de las aguas");
});

test("normalizeTitle collapses the title/subtitle separator (real bug: hyphen vs colon for the same event)", () => {
  const withHyphen = normalizeTitle("Una metáfora verde - arte, activismo y solidaridad");
  const withColon = normalizeTitle("Una metáfora verde: arte, activismo y solidaridad");
  assert.equal(withHyphen, withColon);
  assert.equal(withHyphen, "una metafora verde arte, activismo y solidaridad");
});

function stubTavilyFetch(responsesByQuery: Record<string, unknown>): FetchLike {
  return async (_url, init) => {
    const body = JSON.parse(init?.body ?? "{}") as { query: string };
    const payload = responsesByQuery[body.query] ?? { results: [] };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(payload),
      json: async () => payload,
    };
  };
}

test("searchUnit filters by score and dedups by URL across the 3 queries", async () => {
  const now = new Date(2026, 6, 12);
  const result = { url: "https://a.cl/1", title: "A", content: "c", score: 0.9, images: [] };
  const fetchStub = stubTavilyFetch({
    "inauguracion arte U, Chile julio 2026": { results: [result, { ...result, url: "https://low.cl", score: 0.05 }], usage: { credits: 2 } },
    "exposicion arte U, Chile julio 2026": { results: [result], usage: { credits: 2 } }, // same URL again
    "intervencion artistica U, Chile julio 2026": { results: [{ ...result, url: "https://b.cl/2" }], usage: { credits: 2 } },
  });

  const { results, credits } = await searchUnit("key", "U", now, [], fetchStub);

  assert.equal(credits, 6);
  assert.deepEqual(
    results.map((r) => r.url),
    ["https://a.cl/1", "https://b.cl/2"],
  );
});

test("curate parses the fenced JSON block and applies the location backstop", async () => {
  const candidates = [
    { ...baseCandidate, location: "Valparaíso, Chile", locationQuote: "Valparaíso, Chile" },
    { ...baseCandidate, title: "Foránea", location: "Madrid, España", locationQuote: "Madrid, España" },
  ];
  const client: MessagesClient = {
    messages: {
      create: async () => ({
        content: [{ type: "text", text: "```json\n" + JSON.stringify(candidates) + "\n```" }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    },
  };

  const { candidates: parsed, usage } = await curate(client, "system", "Evento en Valparaíso, Chile. Otro evento en Madrid, España.");

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].status, "approved");
  assert.equal(parsed[1].status, "rejected");
  assert.equal(usage.inputTokens, 100);
  assert.equal(usage.outputTokens, 50);
});

test("curate converts Haiku's plain Chile-local openingDatetime to a real UTC instant (real bug, found 2026-07-20: was written through unconverted)", async () => {
  const candidates = [{ ...baseCandidate, openingDatetime: "2026-07-26T12:30", dateQuote: "26 de julio a las 12:30" }];
  const client: MessagesClient = {
    messages: {
      create: async () => ({
        content: [{ type: "text", text: "```json\n" + JSON.stringify(candidates) + "\n```" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    },
  };

  const { candidates: parsed } = await curate(client, "system", TEST_BLOCK);

  // 12:30 Chile (winter, UTC-4) = 16:30 UTC.
  assert.equal(parsed[0].openingDatetime, "2026-07-26T16:30:00.000Z");
});

test("curate preserves openingTimeConfirmed: false from Haiku's own output (date confirmed, no hour) — real bug, found 2026-07-21: 7 production events with an inauguración confirmed in Haiku's own curationReasoning still lost the date entirely because only the hour was missing", async () => {
  const candidates = [
    { ...baseCandidate, openingDatetime: "2026-07-15T00:00", openingTimeConfirmed: false, dateQuote: "el 15 de julio" },
  ];
  const client: MessagesClient = {
    messages: {
      create: async () => ({
        content: [{ type: "text", text: "```json\n" + JSON.stringify(candidates) + "\n```" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    },
  };

  const { candidates: parsed } = await curate(
    client,
    "system",
    "Inauguración confirmada el 15 de julio, sin hora precisada. Providencia, Santiago, Chile.",
  );

  assert.ok(parsed[0].openingDatetime, "date is kept, not discarded, just because the hour is unconfirmed");
  assert.equal(parsed[0].openingTimeConfirmed, false);
});

test("curate defaults openingTimeConfirmed to true when Haiku's output omits it or sends a non-boolean — malformed output degrades safely rather than throwing", async () => {
  const { openingTimeConfirmed: _omit, ...withoutField } = baseCandidate;
  const candidates = [{ ...withoutField, openingDatetime: "2026-07-15T19:00", dateQuote: "el 15 de julio a las 19:00" }];
  const client: MessagesClient = {
    messages: {
      create: async () => ({
        content: [{ type: "text", text: "```json\n" + JSON.stringify(candidates) + "\n```" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    },
  };

  const { candidates: parsed } = await curate(
    client,
    "system",
    "Inauguración el 15 de julio a las 19:00. Providencia, Santiago, Chile.",
  );

  assert.equal(parsed[0].openingTimeConfirmed, true);
});

test("curate nulls out a malformed openingDatetime rather than storing a wrong instant", async () => {
  const candidates = [{ ...baseCandidate, openingDatetime: "26 de julio, 12:30" }];
  const client: MessagesClient = {
    messages: {
      create: async () => ({
        content: [{ type: "text", text: "```json\n" + JSON.stringify(candidates) + "\n```" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    },
  };

  const { candidates: parsed } = await curate(client, "system", TEST_BLOCK);

  assert.equal(parsed[0].openingDatetime, null);
});

test("curate throws a descriptive error when no JSON block is present", async () => {
  const client: MessagesClient = {
    messages: {
      create: async () => ({
        content: [{ type: "text", text: "no json here" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    },
  };

  await assert.rejects(() => curate(client, "s", "b"), /no fenced JSON block/);
});
