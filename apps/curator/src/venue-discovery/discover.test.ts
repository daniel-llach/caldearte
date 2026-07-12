import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverVenues, buildSystemPrompt, type MessagesClient } from "./discover.js";

interface StubOptions {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  web_search_requests?: number;
}

function stubClient(
  text: string,
  usage: StubOptions = {},
): MessagesClient & { lastParams?: Record<string, unknown> } {
  const client: MessagesClient & { lastParams?: Record<string, unknown> } = {
    messages: {
      async create(params) {
        client.lastParams = params;
        return {
          content: [{ type: "text", text }],
          usage: {
            input_tokens: usage.input_tokens ?? 100,
            output_tokens: usage.output_tokens ?? 50,
            cache_creation_input_tokens: usage.cache_creation_input_tokens ?? null,
            cache_read_input_tokens: usage.cache_read_input_tokens ?? null,
            server_tool_use:
              usage.web_search_requests !== undefined
                ? { web_search_requests: usage.web_search_requests }
                : null,
          },
        };
      },
    },
  };
  return client;
}

const region = {
  id: "region-1",
  name: "Arica",
  country: "Chile",
  language: "es",
  lat: -18.4783,
  lng: -70.3126,
  population: 250000,
  expansion_rank: null,
  status: "active",
  exclusion_reason: null,
  search_frequency: "weekly",
  consecutive_zero_yield_runs: 0,
  last_run_at: null,
  created_at: new Date().toISOString(),
} as const;

const FIXED_NOW = new Date("2026-07-11T12:00:00Z");

test("discoverVenues: parses a fenced JSON block into candidates", async () => {
  const text = [
    "I searched for current exhibitions.",
    "```json",
    JSON.stringify([
      {
        name: "Galería Cerro Norte",
        address: "Calle X 123, Arica",
        websiteOrSocial: "https://instagram.com/galeriacerronorte",
        sourceUrl: "https://galeriacerronorte.cl/exposiciones/obra-x/",
        sourceType: "oficial",
        contactEmail: null,
        category: "art_space",
      },
    ]),
    "```",
  ].join("\n");

  const result = await discoverVenues(region, stubClient(text));

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].name, "Galería Cerro Norte");
  assert.equal(result.candidates[0].sourceUrl, "https://galeriacerronorte.cl/exposiciones/obra-x/");
  assert.equal(result.candidates[0].sourceType, "oficial");
  assert.equal(result.candidates[0].category, "art_space");
});

test("discoverVenues: returns an empty array when the model finds nothing", async () => {
  const text = "```json\n[]\n```";
  const result = await discoverVenues(region, stubClient(text));
  assert.deepEqual(result.candidates, []);
});

test("discoverVenues: maps usage fields, treating missing cache/search fields as undefined", async () => {
  const text = "```json\n[]\n```";
  const result = await discoverVenues(
    region,
    stubClient(text, { input_tokens: 1234, output_tokens: 567 }),
  );

  assert.equal(result.usage.inputTokens, 1234);
  assert.equal(result.usage.outputTokens, 567);
  assert.equal(result.usage.cacheCreationInputTokens, undefined);
  assert.equal(result.usage.cacheReadInputTokens, undefined);
  assert.equal(result.usage.webSearchRequests, undefined);
});

test("discoverVenues: extracts web_search_requests from server_tool_use", async () => {
  const result = await discoverVenues(
    region,
    stubClient("```json\n[]\n```", { web_search_requests: 12 }),
  );
  assert.equal(result.usage.webSearchRequests, 12);
});

test("discoverVenues: throws a clear error when no fenced JSON block is present", async () => {
  const client = stubClient("I looked around but didn't format a JSON block.");
  await assert.rejects(discoverVenues(region, client), /no fenced JSON block/);
});

test("discoverVenues: falls back to English query templates for a non-es region", async () => {
  const enRegion = { ...region, language: "en", name: "Portland" };
  // No direct way to inspect the system prompt from the public API — this
  // just confirms the call succeeds end-to-end for a non-Spanish region
  // rather than throwing on an unrecognized language key.
  const result = await discoverVenues(enRegion, stubClient("```json\n[]\n```"));
  assert.deepEqual(result.candidates, []);
});

test("discoverVenues: caps the web_search tool at MAX_WEB_SEARCH_USES", async () => {
  const client = stubClient("```json\n[]\n```");
  await discoverVenues(region, client);

  const tools = client.lastParams?.tools as Array<Record<string, unknown>>;
  assert.equal(tools[0].max_uses, 8);
});

test("discoverVenues: sets allowed_callers to direct (Haiku doesn't support programmatic tool calling)", async () => {
  const client = stubClient("```json\n[]\n```");
  await discoverVenues(region, client);

  const tools = client.lastParams?.tools as Array<Record<string, unknown>>;
  assert.deepEqual(tools[0].allowed_callers, ["direct"]);
});

test("discoverVenues: uses claude-haiku-4-5", async () => {
  const client = stubClient("```json\n[]\n```");
  await discoverVenues(region, client);
  assert.equal(client.lastParams?.model, "claude-haiku-4-5");
});

test("buildSystemPrompt: lists existing venues without telling the model to skip them entirely", () => {
  const prompt = buildSystemPrompt(region, ["query one"], FIXED_NOW, ["Galería A", "Centro B"]);
  assert.match(prompt, /Galería A/);
  assert.match(prompt, /Centro B/);
  assert.match(prompt, /no need to re-verify these are legitimate/);
  assert.match(prompt, /still report it with its sourceUrl/);
});

test("buildSystemPrompt: omits the known-venues section when none are passed", () => {
  const prompt = buildSystemPrompt(region, ["query one"], FIXED_NOW, []);
  assert.doesNotMatch(prompt, /already known for this region/);
});

test("buildSystemPrompt: always includes the search-economy instruction", () => {
  const prompt = buildSystemPrompt(region, ["query one"], FIXED_NOW);
  assert.match(prompt, /Be economical with searches/);
});

test("buildSystemPrompt: instructs the model not to repeat a query", () => {
  const prompt = buildSystemPrompt(region, ["query one"], FIXED_NOW);
  assert.match(prompt, /[Nn]ever issue the same or a near-duplicate query/);
});

test("buildSystemPrompt: states today's date and a 2-month cutoff", () => {
  const prompt = buildSystemPrompt(region, ["query one"], FIXED_NOW);
  assert.match(prompt, /Today's date is 2026-07-11/);
  assert.match(prompt, /2026-09-11/);
  assert.match(prompt, /discard anything that has already ended/);
});

test("buildSystemPrompt: clarifies name means the institution, not the exhibition title", () => {
  const prompt = buildSystemPrompt(region, ["query one"], FIXED_NOW);
  assert.match(prompt, /never the exhibition or intervention's own title/);
  assert.match(prompt, /report that institution once, not once per exhibition/);
});

test("buildSystemPrompt: asks for sourceUrl in the output shape", () => {
  const prompt = buildSystemPrompt(region, ["query one"], FIXED_NOW);
  assert.match(prompt, /"sourceUrl"/);
});

test("buildSystemPrompt: includes source classification and consolidation instructions", () => {
  const prompt = buildSystemPrompt(region, ["query one"], FIXED_NOW);
  assert.match(prompt, /"oficial"/);
  assert.match(prompt, /"difusion"/);
  assert.match(prompt, /consolidate into a single candidate/);
  assert.match(prompt, /still report it/);
});

test("buildSystemPrompt: caps follow-up searches at a small explicit number", () => {
  const prompt = buildSystemPrompt(region, ["query one"], FIXED_NOW);
  assert.match(prompt, /at most 1-3 targeted follow-ups/);
});
