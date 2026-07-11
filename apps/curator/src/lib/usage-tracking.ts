import { getSupabaseClient } from "./supabase-client.js";
import { estimateCostUsd, type ModelId, type Usage } from "./pricing.js";

export type Purpose = "venue_discovery" | "event_crawl";

export interface RecordUsageInput {
  purpose: Purpose;
  model: ModelId;
  usage: Usage;
  regionId?: string;
  venueId?: string;
}

export async function recordUsage(input: RecordUsageInput): Promise<void> {
  const estimatedCostUsd = estimateCostUsd(input.model, input.usage);

  const { error } = await getSupabaseClient()
    .from("api_usage_log")
    .insert({
      purpose: input.purpose,
      model: input.model,
      region_id: input.regionId ?? null,
      venue_id: input.venueId ?? null,
      input_tokens: input.usage.inputTokens,
      output_tokens: input.usage.outputTokens,
      cache_creation_input_tokens: input.usage.cacheCreationInputTokens ?? 0,
      cache_read_input_tokens: input.usage.cacheReadInputTokens ?? 0,
      web_search_requests: input.usage.webSearchRequests ?? 0,
      estimated_cost_usd: estimatedCostUsd,
    });

  if (error) {
    throw new Error(`Failed to record API usage: ${error.message}`);
  }
}

function startOfCurrentUtcMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export async function getCurrentMonthSpend(): Promise<number> {
  const { data, error } = await getSupabaseClient()
    .from("api_usage_log")
    .select("estimated_cost_usd")
    .gte("created_at", startOfCurrentUtcMonth());

  if (error) {
    throw new Error(`Failed to read API usage: ${error.message}`);
  }

  return (data ?? []).reduce((sum, row) => sum + Number(row.estimated_cost_usd), 0);
}

export async function getConfigNumber(key: string): Promise<number> {
  const { data, error } = await getSupabaseClient()
    .from("system_config")
    .select("value")
    .eq("key", key)
    .single();

  if (error) {
    throw new Error(`Failed to read system_config["${key}"]: ${error.message}`);
  }

  const parsed = Number(data.value);
  if (Number.isNaN(parsed)) {
    throw new Error(`system_config["${key}"] = "${data.value}" is not a number`);
  }

  return parsed;
}

// Blocks new region activation only (Venue Discovery) — the Event Crawler's
// daily crawl of already-known venues keeps running regardless of this check.
export async function isOverBudget(): Promise<boolean> {
  const [spend, budget] = await Promise.all([
    getCurrentMonthSpend(),
    getConfigNumber("monthly_budget_usd"),
  ]);

  return spend >= budget;
}

// Secondary sanity check, not the primary control — catches runaway growth
// (e.g. a bug) independent of dollar spend.
export async function isOverRegionCap(): Promise<boolean> {
  const [{ count, error }, maxTotalRegions] = await Promise.all([
    getSupabaseClient().from("regions").select("id", { count: "exact", head: true }).neq(
      "status",
      "excluded",
    ),
    getConfigNumber("max_total_regions"),
  ]);

  if (error) {
    throw new Error(`Failed to count regions: ${error.message}`);
  }

  return (count ?? 0) >= maxTotalRegions;
}
