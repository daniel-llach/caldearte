import { test } from "node:test";
import assert from "node:assert/strict";
import type { HeadlessRunSummary } from "../lib/notify.js";
import type { MaviActivity } from "../lib/mavi-headless.js";
import type { MessagesClient } from "../event-discovery/discover.js";

// Integration test against local Supabase — same convention as
// event-discovery/run.test.ts. Run `supabase start`, then export
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this suite.
// Anthropic and Resend are always stubbed via HeadlessRunDeps — no real
// API calls, no ANTHROPIC_API_KEY/RESEND_API_KEY needed.
const hasLocalSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

const MAVI_SOURCE_URL = "https://mavi.uc.cl/exposiciones-actuales/";
const NOW = new Date(2026, 6, 20);

function stubMessagesClient(candidatesJson: unknown[]): MessagesClient {
  return {
    messages: {
      create: async () => ({
        content: [{ type: "text", text: "```json\n" + JSON.stringify(candidatesJson) + "\n```" }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    },
  };
}

// Both scenarios below share the exact same bright_source_fetch_state row
// (MAVI_SOURCE_URL) — run as sequential t.test() sub-tests inside one
// outer test, not two independent top-level tests, since Node's test
// runner runs sibling top-level tests concurrently by default and two
// tests racing to set up/tear down the same DB row is exactly the kind of
// cross-test interference event-discovery/run.test.ts's own region-
// exclusion dance exists to avoid.
test(
  "headless-discovery run integration (requires local Supabase)",
  { skip: !hasLocalSupabase && "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set" },
  async (t) => {
    const { getSupabaseClient } = await import("../lib/supabase-client.js");
    const { run } = await import("./run.js");
    const client = getSupabaseClient();

    await t.test("not due yet — skips the fetch entirely and still sends a (mostly empty) summary", async () => {
      await client.from("bright_source_fetch_state").delete().eq("url", MAVI_SOURCE_URL);
      await client.from("bright_source_fetch_state").upsert({ url: MAVI_SOURCE_URL, last_fetched_at: NOW.toISOString() });

      let fetchCalled = false;
      let sentSummary: HeadlessRunSummary | undefined;

      try {
        await run({
          now: NOW,
          fetchMaviActivitiesFn: async () => {
            fetchCalled = true;
            return [];
          },
          sendHeadlessRunSummaryEmailFn: async (summary) => {
            sentSummary = summary;
          },
        });

        assert.equal(fetchCalled, false, "not due — fetchMaviActivities must never be called");
        assert.deepEqual(sentSummary?.sourcesFetched, []);
      } finally {
        await client.from("bright_source_fetch_state").delete().eq("url", MAVI_SOURCE_URL);
      }
    });

    await t.test("due — fetches, curates, inserts a real event, and records the fetch state", async () => {
      await client.from("bright_source_fetch_state").delete().eq("url", MAVI_SOURCE_URL);

      const activity: MaviActivity = {
        title: "__test_mavi_headless_expo__",
        content: "Desde el 1 de agosto de 2026 hasta el 30 de septiembre de 2026, sala principal, Santiago.",
        detailUrl: "https://www.uc.cl/agenda/actividad/__test_mavi_headless_expo__",
        imageUrl: "https://agendauc-prod.s3.amazonaws.com/test-image.jpg",
        placeName: "Museo de Artes Visuales MAVI UC",
      };
      // Row shape for curateBrightSourceItems (2026-07-24, index-keyed,
      // curatorial fields only) — title/sourceUrl/imageUrl/location/
      // placeName are never sent by Haiku for MAVI at all (MAVI_FIXED_LOCATION
      // in run.ts), they come from the activity itself deterministically.
      const candidateJson = {
        index: 0,
        status: "approved",
        artist: null,
        runStartDate: "2026-08-01",
        runEndDate: "2026-09-30",
        openingDatetime: null,
        openingTimeConfirmed: false,
        location: null,
        placeName: null,
        mediumType: "tradicional",
        sensitivityTags: [],
        curationReasoning: "test",
      };

      let sentSummary: HeadlessRunSummary | undefined;

      try {
        await client.from("events").delete().eq("title", activity.title);

        await run({
          now: NOW,
          fetchMaviActivitiesFn: async () => [activity],
          messagesClient: stubMessagesClient([candidateJson]),
          pageFetchFn: (async () => new Response("", { status: 404 })) as typeof fetch,
          sendHeadlessRunSummaryEmailFn: async (summary) => {
            sentSummary = summary;
          },
        });

        assert.deepEqual(sentSummary?.sourcesFetched, [MAVI_SOURCE_URL]);
        assert.equal(sentSummary?.candidates.total, 1);
        assert.equal(sentSummary?.candidates.insertedCount, 1);

        const { data: inserted } = await client
          .from("events")
          .select("title, source_url, opening_datetime")
          .eq("title", activity.title);
        assert.equal(inserted?.length, 1);
        assert.equal(inserted?.[0].source_url, activity.detailUrl);
        assert.equal(inserted?.[0].opening_datetime, null, "MAVI/uc.cl sources never get an openingDatetime, even if Haiku somehow set one");

        const { data: fetchState } = await client.from("bright_source_fetch_state").select("url").eq("url", MAVI_SOURCE_URL);
        assert.equal(fetchState?.length, 1, "fetch state recorded so the next run doesn't re-fetch for 7 days");
      } finally {
        await client.from("events").delete().eq("title", activity.title);
        await client.from("bright_source_fetch_state").delete().eq("url", MAVI_SOURCE_URL);
      }
    });
  },
);
