import { test } from "node:test";
import assert from "node:assert/strict";
import { curateVenuePage, buildTextSystemPrompt, type MessagesClient, type ImageFetcher } from "./curate.js";
import type { ImageCandidate } from "./extract-images.js";

function textResponse(candidates: unknown[], usage: Partial<{ input_tokens: number; output_tokens: number }> = {}) {
  return {
    content: [{ type: "text", text: "```json\n" + JSON.stringify(candidates) + "\n```" }],
    usage: { input_tokens: usage.input_tokens ?? 100, output_tokens: usage.output_tokens ?? 50 },
  };
}

function visionResponse(verdict: "APPROVE" | "REJECT") {
  return {
    content: [{ type: "text", text: verdict }],
    usage: { input_tokens: 200, output_tokens: 5 },
  };
}

function queuedClient(responses: unknown[]): MessagesClient & { calls: Record<string, unknown>[] } {
  const queue = [...responses];
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    messages: {
      async create(params) {
        calls.push(params);
        const next = queue.shift();
        if (!next) throw new Error("queuedClient: no more stubbed responses");
        return next as never;
      },
    },
  };
}

const stubImageFetcher: ImageFetcher = {
  async fetch() {
    return { base64: "ZmFrZQ==", mediaType: "image/jpeg" };
  },
};

const baseCandidate = {
  title: "Nueva muestra",
  description: "Una exhibición de pintura",
  artist: "Artista X",
  openingDatetime: "2026-08-01T19:00:00-04:00",
  openingDateConfidence: "alta",
  mediumType: "tradicional",
  sensitivityTags: [],
  curationReasoning: "Sin contenido problemático.",
  imageUrl: null,
};

test("curateVenuePage: passes through rejected/pending_review without a vision call", async () => {
  const client = queuedClient([
    textResponse([
      { ...baseCandidate, title: "A", status: "rejected" },
      { ...baseCandidate, title: "B", status: "pending_review" },
    ]),
  ]);

  const result = await curateVenuePage("Test Venue", "<html></html>", [], client, stubImageFetcher);

  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].status, "rejected");
  assert.equal(result.candidates[1].status, "pending_review");
  assert.equal(result.usage.length, 1);
  assert.equal(client.calls.length, 1);
});

test("curateVenuePage: approves provisionally_approved with no image, skipping the vision call", async () => {
  const client = queuedClient([
    textResponse([{ ...baseCandidate, status: "provisionally_approved", imageUrl: null }]),
  ]);

  const result = await curateVenuePage("Test Venue", "<html></html>", [], client, stubImageFetcher);

  assert.equal(result.candidates[0].status, "approved");
  assert.equal(result.usage.length, 1);
  assert.equal(client.calls.length, 1);
});

test("curateVenuePage: runs a vision check and approves when the image isn't explicit", async () => {
  const client = queuedClient([
    textResponse([
      { ...baseCandidate, status: "provisionally_approved", imageUrl: "https://example.cl/art.jpg" },
    ]),
    visionResponse("APPROVE"),
  ]);

  const result = await curateVenuePage("Test Venue", "<html></html>", [], client, stubImageFetcher);

  assert.equal(result.candidates[0].status, "approved");
  assert.equal(result.usage.length, 2);
  assert.equal(client.calls.length, 2);
});

test("curateVenuePage: runs a vision check and rejects when the image is explicit", async () => {
  const client = queuedClient([
    textResponse([
      { ...baseCandidate, status: "provisionally_approved", imageUrl: "https://example.cl/art.jpg" },
    ]),
    visionResponse("REJECT"),
  ]);

  const result = await curateVenuePage("Test Venue", "<html></html>", [], client, stubImageFetcher);

  assert.equal(result.candidates[0].status, "rejected");
});

test("curateVenuePage: throws a clear error when no fenced JSON block is present", async () => {
  const client = queuedClient([
    { content: [{ type: "text", text: "no json here" }], usage: { input_tokens: 1, output_tokens: 1 } },
  ]);

  await assert.rejects(
    curateVenuePage("Test Venue", "<html></html>", [], client, stubImageFetcher),
    /no fenced JSON block/,
  );
});

test("buildTextSystemPrompt: lists image candidates by URL and alt text", () => {
  const images: ImageCandidate[] = [{ src: "https://example.cl/a.jpg", alt: "Obra principal", width: 800, height: 600 }];
  const prompt = buildTextSystemPrompt("Test Venue", images);
  assert.match(prompt, /https:\/\/example\.cl\/a\.jpg/);
  assert.match(prompt, /Obra principal/);
});

test("buildTextSystemPrompt: notes when there are no image candidates", () => {
  const prompt = buildTextSystemPrompt("Test Venue", []);
  assert.match(prompt, /no image candidates found/);
});

test("buildTextSystemPrompt: includes the four-axis curation policy and escalation signals", () => {
  const prompt = buildTextSystemPrompt("Test Venue", []);
  assert.match(prompt, /default-exclusion policy across four axes/);
  assert.match(prompt, /pending_review/);
});

test("buildTextSystemPrompt: includes the art-scope filter excluding theater plays, concerts and gigs", () => {
  const prompt = buildTextSystemPrompt("Test Venue", []);
  assert.match(prompt, /conventional theater plays/);
  assert.match(prompt, /concerts, gigs/);
  assert.match(prompt, /genuine artistic intervention/);
});
