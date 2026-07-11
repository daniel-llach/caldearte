import { test } from "node:test";
import assert from "node:assert/strict";

// Integration test against local Supabase. Run `supabase start`, then export
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this suite.
// discoverVenues is always stubbed via runRegion's `deps.discover` — this
// never calls the real Anthropic API, so ANTHROPIC_API_KEY isn't needed.
const hasLocalSupabase = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
);

test(
  "venue-discovery run integration (requires local Supabase)",
  { skip: !hasLocalSupabase && "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set" },
  async (t) => {
    const { getRegionsDueForRun, runRegion } = await import("./run.js");
    const { getSupabaseClient } = await import("../lib/supabase-client.js");
    const client = getSupabaseClient();

    async function refetchRegion(id: string) {
      const { data, error } = await client.from("regions").select("*").eq("id", id).single();
      if (error || !data) throw new Error(`Failed to refetch region: ${error?.message}`);
      return data;
    }

    const { data: region, error: seedError } = await client
      .from("regions")
      .insert({
        name: "__test_region__",
        country: "Testland",
        language: "es",
        status: "active",
        search_frequency: "weekly",
      })
      .select()
      .single();

    if (seedError || !region) {
      throw new Error(`Failed to seed test region: ${seedError?.message}`);
    }

    try {
      await t.test("getRegionsDueForRun includes a never-run active region", async () => {
        const due = await getRegionsDueForRun();
        assert.ok(due.some((r) => r.id === region.id));
      });

      await t.test("runRegion inserts new venues and records usage", async () => {
        const result = await runRegion(region, {
          discover: async () => ({
            candidates: [
              {
                name: "Test Gallery",
                address: null,
                websiteOrSocial: null,
                contactEmail: null,
                category: "art_space",
              },
            ],
            usage: { inputTokens: 1000, outputTokens: 200 },
          }),
        });

        assert.equal(result.inserted, 1);

        const { data: venues } = await client.from("venues").select("*").eq(
          "region_id",
          region.id,
        );
        assert.equal(venues?.length, 1);
        assert.equal(venues?.[0].name, "Test Gallery");

        const { data: usageRows } = await client
          .from("api_usage_log")
          .select("*")
          .eq("region_id", region.id);
        assert.equal(usageRows?.length, 1);
        assert.equal(usageRows?.[0].purpose, "venue_discovery");

        const updated = await refetchRegion(region.id);
        assert.equal(updated.consecutive_zero_yield_runs, 0);
        assert.equal(updated.status, "active");
      });

      await t.test("runRegion saturates a region after 2 consecutive zero-yield runs", async () => {
        const zeroYield = {
          discover: async () => ({
            candidates: [],
            usage: { inputTokens: 10, outputTokens: 5 },
          }),
        };

        await runRegion(await refetchRegion(region.id), zeroYield);
        let updated = await refetchRegion(region.id);
        assert.equal(updated.consecutive_zero_yield_runs, 1);
        assert.equal(updated.status, "active");

        await runRegion(updated, zeroYield);
        updated = await refetchRegion(region.id);
        assert.equal(updated.consecutive_zero_yield_runs, 2);
        assert.equal(updated.status, "saturated");
        assert.equal(updated.search_frequency, "monthly");
      });

      await t.test("runRegion passes existing venue names to discover", async () => {
        // Seed one venue so this region is no longer "empty."
        await client.from("venues").insert({
          region_id: region.id,
          name: "Already Known Gallery",
        });

        let capturedNames: string[] | undefined;
        await runRegion(await refetchRegion(region.id), {
          discover: async (_region, _client, existingVenueNames) => {
            capturedNames = existingVenueNames;
            return { candidates: [], usage: { inputTokens: 10, outputTokens: 5 } };
          },
        });

        assert.ok(capturedNames?.includes("Already Known Gallery"));

        await client.from("venues").delete().eq("name", "Already Known Gallery");
      });

      await t.test("runRegion un-saturates a region once it yields again", async () => {
        const saturatedRegion = await refetchRegion(region.id);
        await runRegion(saturatedRegion, {
          discover: async () => ({
            candidates: [
              {
                name: "Another Gallery",
                address: null,
                websiteOrSocial: null,
                contactEmail: null,
                category: "art_space",
              },
            ],
            usage: { inputTokens: 10, outputTokens: 5 },
          }),
        });
        const updated = await refetchRegion(region.id);
        assert.equal(updated.status, "active");
        assert.equal(updated.search_frequency, "weekly");
        assert.equal(updated.consecutive_zero_yield_runs, 0);
      });
    } finally {
      await client.from("venues").delete().eq("region_id", region.id);
      await client.from("api_usage_log").delete().eq("region_id", region.id);
      await client.from("regions").delete().eq("id", region.id);
    }
  },
);
