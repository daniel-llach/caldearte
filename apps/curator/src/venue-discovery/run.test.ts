import { test } from "node:test";
import assert from "node:assert/strict";

// Integration test against local Supabase. Run `supabase start`, then export
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this suite.
// discoverEvents is always stubbed via runRegion's `deps.discover` — this
// never calls the real Anthropic API, so ANTHROPIC_API_KEY isn't needed.
const hasLocalSupabase = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const baseCandidate = {
  description: null,
  artist: null,
  openingDateConfidence: "alta" as const,
  mediumType: "tradicional" as const,
  sensitivityTags: [] as string[],
  curationReasoning: "ok",
  imageUrl: null,
  venueAddress: null,
  venueWebsiteOrSocial: null,
  sourceUrl: null,
  sourceType: null,
  contactEmail: null,
};

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

      await t.test("runRegion drops the event entirely when the venue is hard_excluded", async () => {
        const before = await refetchRegion(region.id);
        const result = await runRegion(before, {
          discover: async () => ({
            candidates: [
              {
                ...baseCandidate,
                title: "Evento en iglesia",
                openingDatetime: "2026-09-01T19:00:00-04:00",
                venueName: "Iglesia Tal",
                venueCategory: "hard_excluded",
                freeformLocation: null,
                status: "approved",
              },
            ],
            usage: [{ inputTokens: 10, outputTokens: 5 }],
          }),
        });

        assert.equal(result.inserted, 0);

        const { data: venues } = await client.from("venues").select("*").eq("name", "Iglesia Tal");
        assert.equal(venues?.length ?? 0, 0);
      });

      await t.test("runRegion forces pending_review when the venue is needs_review", async () => {
        const result = await runRegion(await refetchRegion(region.id), {
          discover: async () => ({
            candidates: [
              {
                ...baseCandidate,
                title: "Muestra dudosa",
                openingDatetime: "2026-09-02T19:00:00-04:00",
                venueName: "Espacio Ambiguo",
                venueCategory: "needs_review",
                freeformLocation: null,
                status: "approved",
              },
            ],
            usage: [{ inputTokens: 10, outputTokens: 5 }],
          }),
        });

        assert.equal(result.inserted, 1);

        const { data: events } = await client.from("events").select("*").eq("title", "Muestra dudosa");
        assert.equal(events?.[0].curation_status, "pending_review");

        const { data: venues } = await client.from("venues").select("*").eq("name", "Espacio Ambiguo");
        assert.equal(venues?.length, 1);
        assert.equal(venues?.[0].category, "needs_review");
      });

      await t.test("runRegion creates a new venue once and inserts both events for two candidates at it", async () => {
        const result = await runRegion(await refetchRegion(region.id), {
          discover: async () => ({
            candidates: [
              {
                ...baseCandidate,
                title: "Exposición Uno",
                openingDatetime: "2026-09-03T19:00:00-04:00",
                venueName: "Museo Nuevo",
                venueWebsiteOrSocial: "https://museonuevo.cl",
                venueCategory: "art_space",
                freeformLocation: null,
                status: "approved",
              },
              {
                ...baseCandidate,
                title: "Exposición Dos",
                openingDatetime: "2026-09-10T19:00:00-04:00",
                venueName: "Museo Nuevo",
                venueWebsiteOrSocial: "https://museonuevo.cl",
                venueCategory: "art_space",
                freeformLocation: null,
                status: "approved",
              },
            ],
            usage: [{ inputTokens: 10, outputTokens: 5 }],
          }),
        });

        assert.equal(result.inserted, 2);

        const { data: venues } = await client.from("venues").select("*").eq("source_domain", "museonuevo.cl");
        assert.equal(venues?.length, 1);

        const { data: events } = await client
          .from("events")
          .select("*")
          .eq("venue_id", venues![0].id)
          .order("title");
        assert.equal(events?.length, 2);
        assert.equal(events?.[0].title, "Exposición Dos");
        assert.equal(events?.[1].title, "Exposición Uno");
      });

      await t.test("runRegion inserts a freeform candidate with venue_id null", async () => {
        const result = await runRegion(await refetchRegion(region.id), {
          discover: async () => ({
            candidates: [
              {
                ...baseCandidate,
                title: "Intervención callejera",
                openingDatetime: "2026-09-04T19:00:00-04:00",
                venueName: null,
                venueCategory: null,
                freeformLocation: "Plaza Colón, Arica",
                status: "approved",
              },
            ],
            usage: [{ inputTokens: 10, outputTokens: 5 }],
          }),
        });

        assert.equal(result.inserted, 1);

        const { data: events } = await client.from("events").select("*").eq("title", "Intervención callejera");
        assert.equal(events?.[0].venue_id, null);
        assert.equal(events?.[0].freeform_location, "Plaza Colón, Arica");
        assert.equal(events?.[0].source, "discovered");
      });

      await t.test("runRegion drops candidates with no opening_datetime or already past", async () => {
        const result = await runRegion(await refetchRegion(region.id), {
          discover: async () => ({
            candidates: [
              {
                ...baseCandidate,
                title: "Sin fecha",
                openingDatetime: null,
                venueName: null,
                venueCategory: null,
                freeformLocation: "Plaza X",
                status: "approved",
              },
              {
                ...baseCandidate,
                title: "Ya pasó",
                openingDatetime: "2020-01-01T19:00:00-04:00",
                venueName: null,
                venueCategory: null,
                freeformLocation: "Plaza Y",
                status: "approved",
              },
            ],
            usage: [{ inputTokens: 10, outputTokens: 5 }],
          }),
        });

        assert.equal(result.inserted, 0);
      });

      await t.test("runRegion does not re-insert a duplicate event on a later run", async () => {
        const deps = {
          discover: async () => ({
            candidates: [
              {
                ...baseCandidate,
                title: "Intervención repetida",
                openingDatetime: "2026-09-20T19:00:00-04:00",
                venueName: null,
                venueCategory: null,
                freeformLocation: "Plaza Z",
                status: "approved",
              },
            ],
            usage: [{ inputTokens: 10, outputTokens: 5 }],
          }),
        };

        const first = await runRegion(await refetchRegion(region.id), deps);
        assert.equal(first.inserted, 1);

        const second = await runRegion(await refetchRegion(region.id), deps);
        assert.equal(second.inserted, 0);
      });

      await t.test("runRegion saturates a region after 2 consecutive zero-yield runs", async () => {
        await client
          .from("regions")
          .update({ consecutive_zero_yield_runs: 0, status: "active", search_frequency: "weekly" })
          .eq("id", region.id);

        const zeroYield = { discover: async () => ({ candidates: [], usage: [{ inputTokens: 10, outputTokens: 5 }] }) };

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
        await client.from("venues").insert({ region_id: region.id, name: "Already Known Gallery" });

        let capturedNames: string[] | undefined;
        await runRegion(await refetchRegion(region.id), {
          discover: async (_region, _client, existingVenueNames) => {
            capturedNames = existingVenueNames;
            return { candidates: [], usage: [{ inputTokens: 10, outputTokens: 5 }] };
          },
        });

        assert.ok(capturedNames?.includes("Already Known Gallery"));
        await client.from("venues").delete().eq("name", "Already Known Gallery");
      });

      await t.test("runRegion un-saturates a region once it yields again", async () => {
        const result = await runRegion(await refetchRegion(region.id), {
          discover: async () => ({
            candidates: [
              {
                ...baseCandidate,
                title: "Nueva muestra",
                openingDatetime: "2026-09-25T19:00:00-04:00",
                venueName: null,
                venueCategory: null,
                freeformLocation: "Plaza W",
                status: "approved",
              },
            ],
            usage: [{ inputTokens: 10, outputTokens: 5 }],
          }),
        });

        assert.equal(result.inserted, 1);
        const updated = await refetchRegion(region.id);
        assert.equal(updated.status, "active");
        assert.equal(updated.search_frequency, "weekly");
        assert.equal(updated.consecutive_zero_yield_runs, 0);
      });
    } finally {
      const { data: venues } = await client.from("venues").select("id").eq("region_id", region.id);
      const venueIds = (venues ?? []).map((v) => v.id);
      if (venueIds.length > 0) {
        await client.from("events").delete().in("venue_id", venueIds);
      }
      await client.from("events").delete().like("freeform_location", "Plaza%");
      await client.from("api_usage_log").delete().eq("region_id", region.id);
      await client.from("venues").delete().eq("region_id", region.id);
      await client.from("regions").delete().eq("id", region.id);
    }
  },
);
