import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverEvents, buildSystemPrompt, type MessagesClient } from "./discover.js";
import type { ImageFetcher } from "../lib/vision-check.js";

interface StubOptions {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  web_search_requests?: number;
}

function textResponse(text: string, usage: StubOptions = {}) {
  return {
    content: [{ type: "text", text }],
    usage: {
      input_tokens: usage.input_tokens ?? 100,
      output_tokens: usage.output_tokens ?? 50,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? null,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? null,
      server_tool_use:
        usage.web_search_requests !== undefined ? { web_search_requests: usage.web_search_requests } : null,
    },
  };
}

function visionResponse(verdict: "APPROVE" | "REJECT") {
  return {
    content: [{ type: "text", text: verdict }],
    usage: { input_tokens: 200, output_tokens: 5 },
  };
}

function queuedClient(responses: unknown[]): MessagesClient & { lastParams?: Record<string, unknown>; calls: Record<string, unknown>[] } {
  const queue = [...responses];
  const calls: Record<string, unknown>[] = [];
  const client: MessagesClient & { lastParams?: Record<string, unknown>; calls: Record<string, unknown>[] } = {
    calls,
    messages: {
      async create(params) {
        calls.push(params);
        client.lastParams = params;
        const next = queue.shift();
        if (!next) throw new Error("queuedClient: no more stubbed responses");
        return next as never;
      },
    },
  };
  return client;
}

const stubImageFetcher: ImageFetcher = {
  async fetch() {
    return { base64: "ZmFrZQ==", mediaType: "image/jpeg" };
  },
};

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

const baseEventFields = {
  description: "Una exhibición de pintura",
  artist: "Artista X",
  openingDatetime: "2026-08-01T19:00:00-04:00",
  openingDateConfidence: "alta",
  mediumType: "tradicional",
  sensitivityTags: [],
  curationReasoning: "Sin contenido problemático.",
  imageUrl: null,
  venueAddress: null,
  venueWebsiteOrSocial: null,
  sourceUrl: null,
  sourceType: null,
  contactEmail: null,
};

test("discoverEvents: parses a fenced JSON block into candidates with venue info", async () => {
  const client = queuedClient([
    textResponse(
      "```json\n" +
        JSON.stringify([
          {
            title: "Residuos al borde",
            ...baseEventFields,
            venueName: "Casa Cultural Yanulaque",
            venueCategory: "art_space",
            freeformLocation: null,
            status: "approved",
          },
        ]) +
        "\n```",
    ),
  ]);

  const result = await discoverEvents(region, client, [], FIXED_NOW, stubImageFetcher);

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].title, "Residuos al borde");
  assert.equal(result.candidates[0].venueName, "Casa Cultural Yanulaque");
  assert.equal(result.candidates[0].status, "approved");
});

test("discoverEvents: parses a freeform candidate with no venue", async () => {
  const client = queuedClient([
    textResponse(
      "```json\n" +
        JSON.stringify([
          {
            title: "Intervención en la plaza",
            ...baseEventFields,
            venueName: null,
            venueCategory: null,
            freeformLocation: "Plaza de Armas, Antofagasta",
            status: "approved",
          },
        ]) +
        "\n```",
    ),
  ]);

  const result = await discoverEvents(region, client, [], FIXED_NOW, stubImageFetcher);

  assert.equal(result.candidates[0].venueName, null);
  assert.equal(result.candidates[0].freeformLocation, "Plaza de Armas, Antofagasta");
});

test("discoverEvents: passes through rejected/pending_review without a vision call", async () => {
  const client = queuedClient([
    textResponse(
      "```json\n" +
        JSON.stringify([
          { title: "A", ...baseEventFields, venueName: null, venueCategory: null, freeformLocation: null, status: "rejected" },
          { title: "B", ...baseEventFields, venueName: null, venueCategory: null, freeformLocation: null, status: "pending_review" },
        ]) +
        "\n```",
    ),
  ]);

  const result = await discoverEvents(region, client, [], FIXED_NOW, stubImageFetcher);

  assert.equal(result.candidates[0].status, "rejected");
  assert.equal(result.candidates[1].status, "pending_review");
  assert.equal(result.usage.length, 1);
  assert.equal(client.calls.length, 1);
});

test("discoverEvents: approves provisionally_approved with no image, skipping the vision call", async () => {
  const client = queuedClient([
    textResponse(
      "```json\n" +
        JSON.stringify([
          { title: "A", ...baseEventFields, venueName: null, venueCategory: null, freeformLocation: null, status: "provisionally_approved" },
        ]) +
        "\n```",
    ),
  ]);

  const result = await discoverEvents(region, client, [], FIXED_NOW, stubImageFetcher);

  assert.equal(result.candidates[0].status, "approved");
  assert.equal(result.usage.length, 1);
});

test("discoverEvents: runs a vision check and rejects when the image is explicit", async () => {
  const client = queuedClient([
    textResponse(
      "```json\n" +
        JSON.stringify([
          {
            title: "A",
            ...baseEventFields,
            imageUrl: "https://example.cl/art.jpg",
            venueName: null,
            venueCategory: null,
            freeformLocation: null,
            status: "provisionally_approved",
          },
        ]) +
        "\n```",
    ),
    visionResponse("REJECT"),
  ]);

  const result = await discoverEvents(region, client, [], FIXED_NOW, stubImageFetcher);

  assert.equal(result.candidates[0].status, "rejected");
  assert.equal(result.usage.length, 2);
});

test("discoverEvents: throws a clear error when no fenced JSON block is present", async () => {
  const client = queuedClient([{ content: [{ type: "text", text: "no json here" }], usage: { input_tokens: 1, output_tokens: 1 } }]);
  await assert.rejects(discoverEvents(region, client, [], FIXED_NOW, stubImageFetcher), /no fenced JSON block/);
});

test("discoverEvents: uses claude-haiku-4-5 with allowed_callers direct", async () => {
  const client = queuedClient([textResponse("```json\n[]\n```")]);
  await discoverEvents(region, client, [], FIXED_NOW, stubImageFetcher);

  assert.equal(client.lastParams?.model, "claude-haiku-4-5");
  const tools = client.lastParams?.tools as Array<Record<string, unknown>>;
  assert.equal(tools[0].max_uses, 8);
  assert.deepEqual(tools[0].allowed_callers, ["direct"]);
});

test("buildSystemPrompt: explains that a venue is optional, with concrete examples", () => {
  const prompt = buildSystemPrompt(region, ["query one"], FIXED_NOW);
  assert.match(prompt, /A fixed venue is optional/);
  assert.match(prompt, /street corner/);
  assert.match(prompt, /someone's home/);
  assert.match(prompt, /school/);
});

test("buildSystemPrompt: clarifies venueName means the institution, not the exhibition title", () => {
  const prompt = buildSystemPrompt(region, ["query one"], FIXED_NOW);
  assert.match(prompt, /never the exhibition or intervention's own title/);
});

test("buildSystemPrompt: includes the full curation policy (art scope, four axes, escalation)", () => {
  const prompt = buildSystemPrompt(region, ["query one"], FIXED_NOW);
  assert.match(prompt, /conventional theater plays/);
  assert.match(prompt, /default-exclusion policy across four axes/);
  assert.match(prompt, /pending_review/);
});

test("buildSystemPrompt: includes source classification instructions", () => {
  const prompt = buildSystemPrompt(region, ["query one"], FIXED_NOW);
  assert.match(prompt, /"oficial"/);
  assert.match(prompt, /"difusion"/);
});

test("buildSystemPrompt: states today's date and a 2-month cutoff", () => {
  const prompt = buildSystemPrompt(region, ["query one"], FIXED_NOW);
  assert.match(prompt, /Today's date is 2026-07-11/);
  assert.match(prompt, /2026-09-11/);
});

test("buildSystemPrompt: lists existing venues without telling the model to skip them entirely", () => {
  const prompt = buildSystemPrompt(region, ["query one"], FIXED_NOW, ["Galería A"]);
  assert.match(prompt, /Galería A/);
  assert.match(prompt, /no need to re-verify these are legitimate/);
});
