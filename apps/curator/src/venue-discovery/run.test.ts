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

      await t.test("runRegion inserts a new venue with listing_url derived from sourceUrl", async () => {
        const result = await runRegion(region, {
          discover: async () => ({
            candidates: [
              {
                name: "Test Gallery",
                address: null,
                websiteOrSocial: null,
                sourceUrl: "https://testgallery.cl/exposiciones/obra-x/",
                sourceType: "oficial",
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
        assert.equal(venues?.[0].listing_url, "https://testgallery.cl/exposiciones/");

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

      await t.test("runRegion backfills listing_url for an already-known venue, without inserting a duplicate", async () => {
        const { data: existing } = await client
          .from("venues")
          .insert({
            region_id: region.id,
            name: "Balmaceda Sede X",
            source_domain: "balmacedartejoven.cl",
          })
          .select()
          .single();

        try {
          const result = await runRegion(await refetchRegion(region.id), {
            discover: async () => ({
              candidates: [
                {
                  name: "Balmaceda Sede X (found via a different name)",
                  address: null,
                  websiteOrSocial: null,
                  sourceUrl: "https://balmacedartejoven.cl/agenda/muestra-final/",
                  sourceType: "oficial",
                  contactEmail: null,
                  category: "art_space",
                },
              ],
              usage: { inputTokens: 10, outputTokens: 5 },
            }),
          });

          // Matched by domain, not a new venue — doesn't count toward inserted.
          assert.equal(result.inserted, 0);

          const { data: venues } = await client
            .from("venues")
            .select("*")
            .eq("source_domain", "balmacedartejoven.cl");
          assert.equal(venues?.length, 1);
          assert.equal(venues?.[0].listing_url, "https://balmacedartejoven.cl/agenda/");
        } finally {
          await client.from("venues").delete().eq("id", existing!.id);
        }
      });

      await t.test("runRegion does not overwrite an already-resolved listing_url", async () => {
        const { data: existing } = await client
          .from("venues")
          .insert({
            region_id: region.id,
            name: "Ya Resuelto",
            source_domain: "yaresuelto.cl",
            listing_url: "https://yaresuelto.cl/agenda-original/",
          })
          .select()
          .single();

        try {
          await runRegion(await refetchRegion(region.id), {
            discover: async () => ({
              candidates: [
                {
                  name: "Ya Resuelto",
                  address: null,
                  websiteOrSocial: null,
                  sourceUrl: "https://yaresuelto.cl/otra-carpeta/otra-muestra/",
                  sourceType: "oficial",
                  contactEmail: null,
                  category: "art_space",
                },
              ],
              usage: { inputTokens: 10, outputTokens: 5 },
            }),
          });

          const { data: venues } = await client
            .from("venues")
            .select("*")
            .eq("id", existing!.id);
          assert.equal(venues?.[0].listing_url, "https://yaresuelto.cl/agenda-original/");
        } finally {
          await client.from("venues").delete().eq("id", existing!.id);
        }
      });

      await t.test("runRegion does not derive listing_url from a diffusion source", async () => {
        const result = await runRegion(await refetchRegion(region.id), {
          discover: async () => ({
            candidates: [
              {
                name: "Solo En Difusion",
                address: null,
                websiteOrSocial: null,
                sourceUrl: "https://chilemosaico.cl/eventos/tag/arica/algun-evento/",
                sourceType: "difusion",
                contactEmail: null,
                category: "art_space",
              },
            ],
            usage: { inputTokens: 10, outputTokens: 5 },
          }),
        });

        assert.equal(result.inserted, 1);

        const { data: venues } = await client
          .from("venues")
          .select("*")
          .eq("name", "Solo En Difusion");
        assert.equal(venues?.[0].listing_url, null);

        await client.from("venues").delete().eq("name", "Solo En Difusion");
      });

      await t.test("runRegion consolidates same-domain candidates from the same batch before inserting", async () => {
        const result = await runRegion(await refetchRegion(region.id), {
          discover: async () => ({
            candidates: [
              {
                name: "Colección MAC: Modulaciones de la imagen fotográfica",
                address: null,
                websiteOrSocial: "https://mac.uchile.cl",
                sourceUrl: "https://mac.uchile.cl/exposiciones/modulaciones/",
                sourceType: "oficial",
                contactEmail: null,
                category: "art_space",
              },
              {
                name: "Colección MAC: Modulaciones de la imagen fotográfica (Quinta Normal)",
                address: null,
                websiteOrSocial: "https://mac.uchile.cl",
                sourceUrl: "https://mac.uchile.cl/exposiciones/modulaciones-qn/",
                sourceType: "oficial",
                contactEmail: null,
                category: "art_space",
              },
            ],
            usage: { inputTokens: 10, outputTokens: 5 },
          }),
        });

        assert.equal(result.inserted, 1);

        const { data: venues } = await client
          .from("venues")
          .select("*")
          .eq("source_domain", "mac.uchile.cl");
        assert.equal(venues?.length, 1);

        await client.from("venues").delete().eq("source_domain", "mac.uchile.cl");
      });

      await t.test("runRegion saturates a region after 2 consecutive zero-yield runs", async () => {
        // Reset regardless of what earlier subtests left it at.
        await client
          .from("regions")
          .update({ consecutive_zero_yield_runs: 0, status: "active", search_frequency: "weekly" })
          .eq("id", region.id);

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
                sourceUrl: null,
                sourceType: null,
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
