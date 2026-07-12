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

    // Every subtest below fetches genuinely different (fake) page content
    // so each run always goes through curate(), not the unchanged-content
    // skip path — that path gets its own dedicated subtest. Assertions on
    // consecutive_zero_yield_checks are always relative (before/after),
    // since subtests share one seeded venue and run in sequence.
    let pageContentCounter = 0;
    function nextPageContent(): { fetch: () => Promise<string> } {
      pageContentCounter += 1;
      return { fetch: async () => `<html>content variant ${pageContentCounter}</html>` };
    }

    const { data: region } = await client.from("regions").select("id").limit(1).single();

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

    try {
      await t.test("crawlVenue inserts new dated events and records usage", async () => {
        const result = await crawlVenue(venue, {
          fetchPage: nextPageContent(),
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
                imageUrl: "https://example-test-venue.cl/obra.jpg",
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
        assert.equal(events?.[0].image_url, "https://example-test-venue.cl/obra.jpg");

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

      await t.test("crawlVenue treats an equivalent instant in a different ISO offset as a duplicate", async () => {
        const before = await refetchVenue(venue.id);

        // Same event as the first subtest (2026-09-01T19:00-04:00 = 23:00
        // UTC), just expressed with a different UTC offset — must not be
        // re-inserted as a "new" event.
        const result = await crawlVenue(before, {
          fetchPage: nextPageContent(),
          curate: async () => ({
            candidates: [
              {
                title: "Muestra de prueba",
                description: null,
                artist: null,
                openingDatetime: "2026-09-01T23:00:00+00:00",
                openingDateConfidence: "alta",
                mediumType: "tradicional",
                sensitivityTags: [],
                curationReasoning: "ok",
                imageUrl: null,
                status: "approved",
              },
            ],
            usage: [{ inputTokens: 10, outputTokens: 5 }],
          }),
        });

        assert.equal(result.inserted, 0);

        const { data: events } = await client.from("events").select("*").eq("venue_id", venue.id);
        assert.equal(events?.length, 1);

        const updated = await refetchVenue(venue.id);
        assert.equal(updated.consecutive_zero_yield_checks, before.consecutive_zero_yield_checks + 1);
      });

      await t.test("crawlVenue drops candidates with no opening_datetime", async () => {
        const before = await refetchVenue(venue.id);

        const result = await crawlVenue(before, {
          fetchPage: nextPageContent(),
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

        const updated = await refetchVenue(venue.id);
        assert.equal(updated.consecutive_zero_yield_checks, before.consecutive_zero_yield_checks + 1);
      });

      await t.test("crawlVenue drops candidates whose opening date has already passed", async () => {
        const before = await refetchVenue(venue.id);

        const result = await crawlVenue(before, {
          fetchPage: nextPageContent(),
          curate: async () => ({
            candidates: [
              {
                title: "Ya pasó",
                description: null,
                artist: null,
                openingDatetime: "2020-01-01T19:00:00-04:00",
                openingDateConfidence: "alta",
                mediumType: "tradicional",
                sensitivityTags: [],
                curationReasoning: "ok",
                imageUrl: null,
                status: "approved",
              },
            ],
            usage: [{ inputTokens: 10, outputTokens: 5 }],
          }),
        });

        assert.equal(result.inserted, 0);

        const updated = await refetchVenue(venue.id);
        assert.equal(updated.consecutive_zero_yield_checks, before.consecutive_zero_yield_checks + 1);
      });

      await t.test("crawlVenue skips the curate call when content is unchanged", async () => {
        const before = await refetchVenue(venue.id);
        const sameContent = nextPageContent();
        let curateCalled = false;
        const curate = async () => {
          curateCalled = true;
          return { candidates: [], usage: [] };
        };

        // First crawl with this content: genuinely different from what's
        // stored, so curate() does run.
        await crawlVenue(before, { fetchPage: sameContent, curate });
        assert.equal(curateCalled, true);

        // Second crawl with the exact same content: now unchanged, skip.
        curateCalled = false;
        const result = await crawlVenue(await refetchVenue(venue.id), { fetchPage: sameContent, curate });

        assert.equal(curateCalled, false);
        assert.equal(result.inserted, 0);

        const updated = await refetchVenue(venue.id);
        assert.equal(updated.consecutive_zero_yield_checks, before.consecutive_zero_yield_checks + 2);
      });

      await t.test("crawlVenue slows check_frequency_days after 3 consecutive zero-yield checks", async () => {
        // Force the streak to exactly the slowdown threshold, regardless
        // of what earlier subtests left it at.
        await client
          .from("venues")
          .update({ consecutive_zero_yield_checks: 2, check_frequency_days: 3 })
          .eq("id", venue.id);

        const zeroYield = { fetchPage: nextPageContent(), curate: async () => ({ candidates: [], usage: [] }) };
        await crawlVenue(await refetchVenue(venue.id), zeroYield);

        const updated = await refetchVenue(venue.id);
        assert.equal(updated.consecutive_zero_yield_checks, 3);
        assert.equal(updated.check_frequency_days, 7);
      });

      await t.test("crawlVenue fetches listing_url when set, instead of the domain root", async () => {
        const { data: resolvedVenue } = await client
          .from("venues")
          .insert({
            region_id: region!.id,
            name: "__test_resolved_venue__",
            category: "art_space",
            source_domain: "resolved-test-venue.cl",
            listing_url: "https://resolved-test-venue.cl/agenda/",
          })
          .select()
          .single();

        try {
          let fetchedUrl: string | undefined;
          await crawlVenue(resolvedVenue!, {
            fetchPage: {
              fetch: async (url: string) => {
                fetchedUrl = url;
                return "<html>agenda content</html>";
              },
            },
            curate: async () => ({ candidates: [], usage: [] }),
          });

          assert.equal(fetchedUrl, "https://resolved-test-venue.cl/agenda/");
        } finally {
          await client.from("venues").delete().eq("id", resolvedVenue!.id);
        }
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
