import { test } from "node:test";
import assert from "node:assert/strict";

// Integration test against local Supabase. Run `supabase start`, then export
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this suite.
// fetchPage and curate are always stubbed via crawlVenue's deps — this
// never calls the network or the real Anthropic API.
const hasLocalSupabase = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
);

test(
  "event-crawler run integration (requires local Supabase)",
  { skip: !hasLocalSupabase && "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set" },
  async (t) => {
    const { getVenuesDueForCheck, crawlVenue } = await import("./run.js");
    const { getSupabaseClient } = await import("../lib/supabase-client.js");
    const client = getSupabaseClient();

    async function refetchVenue(id: string) {
      const { data, error } = await client.from("venues").select("*").eq("id", id).single();
      if (error || !data) throw new Error(`Failed to refetch venue: ${error?.message}`);
      return data;
    }

    const { data: region } = await client
      .from("regions")
      .select("id")
      .limit(1)
      .single();

    const { data: venue, error: seedError } = await client
      .from("venues")
      .insert({
        region_id: region!.id,
        name: "__test_venue__",
        category: "art_space",
        source_domain: "example-test-venue.cl",
      })
      .select()
      .single();

    if (seedError || !venue) {
      throw new Error(`Failed to seed test venue: ${seedError?.message}`);
    }

    const fetchPage = { fetch: async () => "<html>fixed content</html>" };

    try {
      await t.test("crawlVenue inserts new dated events and records usage", async () => {
        const result = await crawlVenue(venue, {
          fetchPage,
          curate: async () => ({
            candidates: [
              {
                title: "Muestra de prueba",
                description: null,
                artist: null,
                openingDatetime: "2026-09-01T19:00:00-04:00",
                openingDateConfidence: "alta",
                mediumType: "tradicional",
                sensitivityTags: [],
                curationReasoning: "ok",
                imageUrl: null,
                status: "approved",
              },
            ],
            usage: [{ inputTokens: 100, outputTokens: 50 }],
          }),
        });

        assert.equal(result.inserted, 1);

        const { data: events } = await client.from("events").select("*").eq("venue_id", venue.id);
        assert.equal(events?.length, 1);
        assert.equal(events?.[0].title, "Muestra de prueba");
        assert.equal(events?.[0].curation_status, "approved");

        const { data: usageRows } = await client
          .from("api_usage_log")
          .select("*")
          .eq("venue_id", venue.id);
        assert.equal(usageRows?.length, 1);
        assert.equal(usageRows?.[0].purpose, "event_crawl");

        const updated = await refetchVenue(venue.id);
        assert.equal(updated.consecutive_zero_yield_checks, 0);
        assert.equal(updated.check_frequency_days, 3);
        assert.ok(updated.content_hash);
      });

      await t.test("crawlVenue drops candidates with no opening_datetime", async () => {
        const result = await crawlVenue(await refetchVenue(venue.id), {
          fetchPage: { fetch: async () => "<html>different content</html>" },
          curate: async () => ({
            candidates: [
              {
                title: "Sin fecha",
                description: null,
                artist: null,
                openingDatetime: null,
                openingDateConfidence: "baja",
                mediumType: "tradicional",
                sensitivityTags: [],
                curationReasoning: "sin fecha clara",
                imageUrl: null,
                status: "approved",
              },
            ],
            usage: [{ inputTokens: 10, outputTokens: 5 }],
          }),
        });

        assert.equal(result.inserted, 0);
      });

      await t.test("crawlVenue skips the curate call when content is unchanged", async () => {
        let curateCalled = false;
        const current = await refetchVenue(venue.id);

        const result = await crawlVenue(current, {
          fetchPage: { fetch: async () => "<html>different content</html>" },
          curate: async () => {
            curateCalled = true;
            return { candidates: [], usage: [] };
          },
        });

        assert.equal(curateCalled, false);
        assert.equal(result.inserted, 0);

        const updated = await refetchVenue(venue.id);
        // Streak carries over from the previous subtest's zero-yield check
        // (same fetched content, so this is the 2nd consecutive zero-yield).
        assert.equal(updated.consecutive_zero_yield_checks, 2);
      });

      await t.test("crawlVenue slows check_frequency_days after 3 consecutive zero-yield checks", async () => {
        const zeroYield = {
          fetchPage: { fetch: async () => "<html>different content</html>" },
          curate: async () => ({ candidates: [], usage: [] }),
        };

        await crawlVenue(await refetchVenue(venue.id), zeroYield);
        await crawlVenue(await refetchVenue(venue.id), zeroYield);
        const updated = await refetchVenue(venue.id);

        // Streak carries over from earlier subtests: 2 + 2 more = 4, past
        // the slowdown threshold of 3.
        assert.equal(updated.consecutive_zero_yield_checks, 4);
        assert.equal(updated.check_frequency_days, 7);
      });

      await t.test("getVenuesDueForCheck excludes social-domain and non-art_space venues", async () => {
        const { data: socialVenue } = await client
          .from("venues")
          .insert({
            region_id: region!.id,
            name: "__test_social_venue__",
            category: "art_space",
            source_domain: "facebook.com",
          })
          .select()
          .single();

        const { data: reviewVenue } = await client
          .from("venues")
          .insert({
            region_id: region!.id,
            name: "__test_needs_review_venue__",
            category: "needs_review",
            source_domain: "example-needs-review.cl",
          })
          .select()
          .single();

        try {
          const due = await getVenuesDueForCheck();
          assert.ok(!due.some((v) => v.id === socialVenue!.id));
          assert.ok(!due.some((v) => v.id === reviewVenue!.id));
        } finally {
          await client.from("venues").delete().eq("id", socialVenue!.id);
          await client.from("venues").delete().eq("id", reviewVenue!.id);
        }
      });
    } finally {
      await client.from("events").delete().eq("venue_id", venue.id);
      await client.from("api_usage_log").delete().eq("venue_id", venue.id);
      await client.from("venues").delete().eq("id", venue.id);
    }
  },
);
