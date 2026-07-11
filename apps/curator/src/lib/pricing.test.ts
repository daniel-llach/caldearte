import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateCostUsd } from "./pricing.js";

test("estimateCostUsd: plain input/output tokens, no cache", () => {
  const cost = estimateCostUsd("claude-haiku-4-5", {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
  });
  // $1/Mtok input + $5/Mtok output
  assert.equal(cost, 6);
});

test("estimateCostUsd: cache read is 0.1x the input rate", () => {
  const cost = estimateCostUsd("claude-haiku-4-5", {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 1_000_000,
  });
  assert.equal(cost, 0.1);
});

test("estimateCostUsd: cache write is 1.25x the input rate", () => {
  const cost = estimateCostUsd("claude-sonnet-5", {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 1_000_000,
  });
  // Sonnet 5 intro pricing: $2/Mtok input * 1.25
  assert.equal(cost, 2.5);
});

test("estimateCostUsd: combines all four token types", () => {
  const cost = estimateCostUsd("claude-sonnet-5", {
    inputTokens: 500_000,
    outputTokens: 100_000,
    cacheCreationInputTokens: 200_000,
    cacheReadInputTokens: 2_000_000,
  });
  const expected = 0.5 * 2 + 0.1 * 10 + 0.2 * 2 * 1.25 + 2 * 2 * 0.1;
  assert.equal(cost, expected);
});

test("estimateCostUsd: throws on an unknown model", () => {
  assert.throws(() => {
    // @ts-expect-error deliberately invalid model id
    estimateCostUsd("claude-nonexistent", { inputTokens: 1, outputTokens: 1 });
  }, /No pricing configured/);
});
