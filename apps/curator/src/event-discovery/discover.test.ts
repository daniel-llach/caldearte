import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyKnownExclusionsFilter,
  applyLocationFilter,
  buildQueries,
  currentMonthLabel,
  enforceSourceUrlInvariant,
  filterImageCandidates,
  filterKnownExclusions,
  firstOfMonthIso,
  isCurrentOrUpcoming,
  normalizeTitle,
  nullifyAggregatorSourceUrls,
  searchUnit,
  curate,
  type EventCandidate,
  type MessagesClient,
  type RawResult,
} from "./discover.js";
import type { FetchLike } from "../lib/tavily.js";

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
    { ...baseCandidate, location: "Valparaíso, Chile" },
    { ...baseCandidate, title: "Foránea", location: "Madrid, España" },
  ];
  const client: MessagesClient = {
    messages: {
      create: async () => ({
        content: [{ type: "text", text: "```json\n" + JSON.stringify(candidates) + "\n```" }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    },
  };

  const { candidates: parsed, usage } = await curate(client, "system", "block");

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].status, "approved");
  assert.equal(parsed[1].status, "rejected");
  assert.equal(usage.inputTokens, 100);
  assert.equal(usage.outputTokens, 50);
});

test("curate converts Haiku's plain Chile-local openingDatetime to a real UTC instant (real bug, found 2026-07-20: was written through unconverted)", async () => {
  const candidates = [{ ...baseCandidate, openingDatetime: "2026-07-26T12:30" }];
  const client: MessagesClient = {
    messages: {
      create: async () => ({
        content: [{ type: "text", text: "```json\n" + JSON.stringify(candidates) + "\n```" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    },
  };

  const { candidates: parsed } = await curate(client, "system", "block");

  // 12:30 Chile (winter, UTC-4) = 16:30 UTC.
  assert.equal(parsed[0].openingDatetime, "2026-07-26T16:30:00.000Z");
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

  const { candidates: parsed } = await curate(client, "system", "block");

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
