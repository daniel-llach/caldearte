import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverVenues, type MessagesClient } from "./discover.js";

function stubClient(text: string, usage: Partial<Record<string, number>> = {}): MessagesClient {
  return {
    messages: {
      async create() {
        return {
          content: [{ type: "text", text }],
          usage: {
            input_tokens: usage.input_tokens ?? 100,
            output_tokens: usage.output_tokens ?? 50,
            cache_creation_input_tokens: usage.cache_creation_input_tokens ?? null,
            cache_read_input_tokens: usage.cache_read_input_tokens ?? null,
          },
        };
      },
    },
  };
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

test("discoverVenues: parses a fenced JSON block into candidates", async () => {
  const text = [
    "I searched for galleries and cultural centers.",
    "```json",
    JSON.stringify([
      {
        name: "Galería Cerro Norte",
        address: "Calle X 123, Arica",
        websiteOrSocial: "https://instagram.com/galeriacerronorte",
        contactEmail: null,
        category: "art_space",
      },
    ]),
    "```",
  ].join("\n");

  const result = await discoverVenues(region, stubClient(text));

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].name, "Galería Cerro Norte");
  assert.equal(result.candidates[0].category, "art_space");
});

test("discoverVenues: returns an empty array when the model finds nothing", async () => {
  const text = "```json\n[]\n```";
  const result = await discoverVenues(region, stubClient(text));
  assert.deepEqual(result.candidates, []);
});

test("discoverVenues: maps usage fields, treating missing cache fields as undefined", async () => {
  const text = "```json\n[]\n```";
  const result = await discoverVenues(
    region,
    stubClient(text, { input_tokens: 1234, output_tokens: 567 }),
  );

  assert.equal(result.usage.inputTokens, 1234);
  assert.equal(result.usage.outputTokens, 567);
  assert.equal(result.usage.cacheCreationInputTokens, undefined);
  assert.equal(result.usage.cacheReadInputTokens, undefined);
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
