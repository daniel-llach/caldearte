import { test } from "node:test";
import assert from "node:assert/strict";

// Integration test against local Supabase. Run `supabase start`, then export
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from `supabase status` before
// running this suite. Skips (doesn't fail) when those aren't set, so it
// doesn't break `pnpm test` in environments without local Supabase running.
const hasLocalSupabase = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
);

test(
  "usage-tracking integration (requires local Supabase)",
  { skip: !hasLocalSupabase && "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set" },
  async (t) => {
    const { recordUsage, getCurrentMonthSpend, getConfigNumber, isOverBudget, isOverRegionCap } =
      await import("./usage-tracking.js");
    const { getSupabaseClient } = await import("./supabase-client.js");

    await t.test("getConfigNumber reads the seeded monthly_budget_usd", async () => {
      assert.equal(await getConfigNumber("monthly_budget_usd"), 10);
    });

    await t.test("recordUsage inserts a row and getCurrentMonthSpend sums it", async () => {
      const before = await getCurrentMonthSpend();

      await recordUsage({
        purpose: "event_crawl",
        model: "claude-haiku-4-5",
        usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      });

      const after = await getCurrentMonthSpend();
      assert.ok(after >= before + 6 - 1e-9, `expected spend to grow by ~$6, got ${after - before}`);

      // Clean up so repeated local runs don't drift month-to-date totals.
      // Surgical (by this test's own distinctive token count), NOT by
      // purpose alone — test files run in parallel against the same local
      // DB, and a broad delete here can wipe another suite's freshly
      // written rows between its insert and its assertion (a real observed
      // flake with event-crawler/run.test.ts).
      await getSupabaseClient()
        .from("api_usage_log")
        .delete()
        .eq("purpose", "event_crawl")
        .eq("input_tokens", 1_000_000);
    });

    await t.test("isOverBudget flips true once month-to-date spend crosses the ceiling", async () => {
      const budget = await getConfigNumber("monthly_budget_usd");
      assert.equal(await isOverBudget(), false, "shouldn't be over budget before seeding a spike");

      const spikeInputTokens = (budget + 5) * 1_000_000;
      await recordUsage({
        purpose: "event_discovery",
        model: "claude-sonnet-5",
        usage: { inputTokens: spikeInputTokens, outputTokens: 0 },
      });

      assert.equal(await isOverBudget(), true);

      await getSupabaseClient()
        .from("api_usage_log")
        .delete()
        .eq("purpose", "event_discovery")
        .eq("input_tokens", spikeInputTokens);
      assert.equal(await isOverBudget(), false, "should clear after cleanup");
    });

    await t.test("isOverRegionCap compares seeded regions against max_total_regions", async () => {
      const maxTotalRegions = await getConfigNumber("max_total_regions");
      assert.ok(maxTotalRegions > 5, "the 5 seeded Chile regions shouldn't already be at the cap");
      assert.equal(await isOverRegionCap(), false);
    });
  },
);
