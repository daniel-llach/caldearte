// Prices as of 2026-07 (platform.claude.com/docs/en/pricing). No API exposes
// this — update this table by hand if Anthropic changes pricing.
export type ModelId = "claude-haiku-4-5" | "claude-sonnet-5";

interface ModelPricing {
  inputPerMtok: number;
  outputPerMtok: number;
}

// Sonnet 5 intro pricing ($2/$10) applies through 2026-08-31, then reverts
// to $3/$15 — update inputPerMtok/outputPerMtok here when that happens.
const PRICING: Record<ModelId, ModelPricing> = {
  "claude-haiku-4-5": { inputPerMtok: 1, outputPerMtok: 5 },
  "claude-sonnet-5": { inputPerMtok: 2, outputPerMtok: 10 },
};

const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25; // 5-minute TTL cache writes

// Web search is billed separately from tokens: $10 per 1,000 searches,
// reported as response.usage.server_tool_use.web_search_requests. Missing
// this was a real bug — isOverBudget() was blind to roughly half of real
// Venue Discovery spend until this was added.
const WEB_SEARCH_COST_PER_REQUEST = 0.01;

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  webSearchRequests?: number;
}

export function estimateCostUsd(model: ModelId, usage: Usage): number {
  const pricing = PRICING[model];
  if (!pricing) {
    throw new Error(`No pricing configured for model "${model}" — update pricing.ts`);
  }

  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPerMtok;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPerMtok;
  const cacheWriteCost =
    ((usage.cacheCreationInputTokens ?? 0) / 1_000_000) *
    pricing.inputPerMtok *
    CACHE_WRITE_MULTIPLIER;
  const cacheReadCost =
    ((usage.cacheReadInputTokens ?? 0) / 1_000_000) * pricing.inputPerMtok * CACHE_READ_MULTIPLIER;
  const webSearchCost = (usage.webSearchRequests ?? 0) * WEB_SEARCH_COST_PER_REQUEST;

  return inputCost + outputCost + cacheWriteCost + cacheReadCost + webSearchCost;
}
