import { test } from "node:test";
import assert from "node:assert/strict";

// Integration test against local Supabase. Run `supabase start`, then export
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this suite.
// Tavily and Anthropic are always stubbed via RunDeps — no real API calls,
// no TAVILY_API_KEY/ANTHROPIC_API_KEY needed.
const hasLocalSupabase = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const TEST_UNIT = "__test_unit__";
const NOW = new Date(2026, 6, 12); // July 12, 2026

const unitCandidates = [
  {
    title: "__test__ Muestra vigente",
    description: "desc",
    artist: "Artista",
    runStartDate: "2026-07-05",
    runEndDate: "2026-09-30",
    openingDatetime: "2026-07-05T19:00:00-04:00",
    mediumType: "tradicional",
    sensitivityTags: [],
    curationReasoning: "ok",
    imageUrl: "https://x.cl/obra.jpg",
    status: "approved",
    location: "Providencia, Santiago, Chile",
    sourceUrl: "https://x.cl/expo",
  },
  {
    title: "__test__ Ya terminó",
    description: null,
    artist: null,
    runStartDate: "2026-05-01",
    runEndDate: "2026-06-20",
    openingDatetime: null,
    mediumType: "tradicional",
    sensitivityTags: [],
    curationReasoning: "ok",
    imageUrl: null,
    status: "approved",
    location: "Santiago, Chile",
    sourceUrl: null,
  },
  {
    title: "__test__ Foránea",
    description: null,
    artist: null,
    runStartDate: "2026-07-10",
    runEndDate: null,
    openingDatetime: null,
    mediumType: "tradicional",
    sensitivityTags: [],
    curationReasoning: "expo real",
    imageUrl: null,
    status: "approved",
    location: "Centro Cultural Recoleta, Buenos Aires, Argentina",
    sourceUrl: null,
  },
];

const brightCandidates = [
  {
    title: "__test__ Brillante uno",
    description: null,
    artist: null,
    runStartDate: "2026-07-08",
    runEndDate: "2026-08-30",
    openingDatetime: null,
    mediumType: "tradicional",
    sensitivityTags: [],
    curationReasoning: "ok",
    imageUrl: "https://nuevositio.cl/obra1.jpg",
    status: "approved",
    location: "Valparaíso, Chile",
    sourceUrl: "https://nuevositio.cl/expo-1",
  },
  {
    title: "__test__ Brillante dos",
    description: null,
    artist: null,
    runStartDate: "2026-07-09",
    runEndDate: "2026-08-30",
    openingDatetime: null,
    mediumType: "tradicional",
    sensitivityTags: [],
    curationReasoning: "ok",
    imageUrl: "https://nuevositio.cl/obra2.jpg",
    status: "approved",
    location: "Valparaíso, Chile",
    sourceUrl: "https://nuevositio.cl/expo-2",
  },
];

function fencedJson(payload: unknown): string {
  return "```json\n" + JSON.stringify(payload) + "\n```";
}

test(
  "event-discovery run integration (requires local Supabase)",
  { skip: !hasLocalSupabase && "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set" },
  async (t) => {
    const { run, getUnitsDueForRun } = await import("./run.js");
    const { getSupabaseClient } = await import("../lib/supabase-client.js");
    const client = getSupabaseClient();

    const { data: unit, error: seedError } = await client
      .from("regions")
      .insert({ name: TEST_UNIT, country: "Testland", language: "es", status: "active" })
      .select()
      .single();
    if (seedError || !unit) throw new Error(`Failed to seed test unit: ${seedError?.message}`);

    const { data: excludedUnit } = await client
      .from("regions")
      .insert({ name: "__test_excluded__", country: "Testland", language: "es", status: "excluded" })
      .select()
      .single();

    // Stubbed search: only the test unit yields results; every other unit
    // (including the real seeded Chile regions in the local DB) gets [].
    const searchUnitFn = async (_key: string, unitName: string) =>
      unitName === TEST_UNIT
        ? {
            results: [{ title: "r", url: "https://x.cl", content: "c", score: 0.9, images: [] }],
            credits: 6,
          }
        : { results: [], credits: 0 };

    // Stubbed Haiku: unit blocks get the unit candidates, the bright-sources
    // block gets the bright candidates.
    const messagesClient = {
      messages: {
        create: async (params: Record<string, unknown>) => {
          const userContent = (params.messages as Array<{ content: string }>)[0].content;
          const payload = userContent.includes("Fuentes brillantes") ? brightCandidates : unitCandidates;
          return {
            content: [{ type: "text", text: fencedJson(payload) }],
            usage: { input_tokens: 100, output_tokens: 50 },
          };
        },
      },
    };

    try {
      await t.test("first run inserts current events, drops stale, stores foreign as rejected", async () => {
        await run({
          messagesClient,
          searchUnitFn,
          fetchBrightSourcesFn: async () => [],
          now: NOW,
        });

        const { data: events } = await client.from("events").select("*").like("title", "__test__%");
        const byTitle = new Map((events ?? []).map((e) => [e.title, e]));

        const vigente = byTitle.get("__test__ Muestra vigente");
        assert.ok(vigente, "current event inserted");
        assert.equal(vigente.curation_status, "approved");
        assert.equal(vigente.venue_id, null);
        assert.equal(vigente.freeform_location, "Providencia, Santiago, Chile");
        assert.equal(vigente.run_start_date, "2026-07-05");
        assert.equal(vigente.run_end_date, "2026-09-30");
        assert.equal(vigente.source, "discovered");

        assert.equal(byTitle.has("__test__ Ya terminó"), false, "stale event dropped");

        const foranea = byTitle.get("__test__ Foránea");
        assert.ok(foranea, "foreign event stored for audit");
        assert.equal(foranea.curation_status, "rejected");
        assert.match(foranea.curation_reasoning, /FILTRO DE CÓDIGO/);
      });

      await t.test("last_run_at is set and the unit is no longer due; excluded units never run", async () => {
        const { data: updated } = await client.from("regions").select("last_run_at").eq("id", unit.id).single();
        assert.ok(updated?.last_run_at, "last_run_at set");

        const due = await getUnitsDueForRun(NOW);
        assert.equal(due.some((r) => r.id === unit.id), false, "just-run unit not due");
        assert.equal(due.some((r) => r.id === excludedUnit?.id), false, "excluded unit not due");
      });

      await t.test("a re-run a month later does not re-insert the same events (cross-run dedup)", async () => {
        const { count: before } = await client
          .from("events")
          .select("id", { count: "exact", head: true })
          .like("title", "__test__%");

        await run({
          messagesClient,
          searchUnitFn,
          fetchBrightSourcesFn: async () => [],
          now: new Date(2026, 7, 15), // Aug 15 — unit due again
        });

        const { count: after } = await client
          .from("events")
          .select("id", { count: "exact", head: true })
          .like("title", "__test__%");

        assert.equal(after, before, "no duplicates inserted on re-run");
      });

      await t.test("bright-sources pass inserts events and auto-detects the new source domain", async () => {
        await run({
          messagesClient,
          searchUnitFn: async () => ({ results: [], credits: 0 }), // units yield nothing this time
          fetchBrightSourcesFn: async () => [
            { title: "fuente", url: "https://agenda.cl", content: "c", score: 1, images: [] },
          ],
          now: new Date(2026, 8, 20), // Sep 20 — but candidates dated July...
        });

        // July-dated bright candidates are stale by September — nothing inserted.
        const { data: none } = await client.from("events").select("id").like("title", "__test__ Brillante%");
        assert.equal(none?.length ?? 0, 0);

        // Re-run within July: candidates are current, both insert, domain detected.
        await run({
          messagesClient,
          searchUnitFn: async () => ({ results: [], credits: 0 }),
          fetchBrightSourcesFn: async () => [
            { title: "fuente", url: "https://agenda.cl", content: "c", score: 1, images: [] },
          ],
          now: new Date(2026, 6, 13), // July 13
        });

        const { data: bright } = await client.from("events").select("*").like("title", "__test__ Brillante%");
        assert.equal(bright?.length, 2);
        assert.ok(bright?.every((e) => e.venue_id === null && e.curation_status === "approved"));

        const { data: detected } = await client
          .from("detected_sources")
          .select("*")
          .like("url", "%nuevositio.cl%");
        assert.equal(detected?.length, 1);
        assert.match(detected![0].note, /2 eventos completos/);
      });

      await t.test("usage was recorded under the event_discovery purpose", async () => {
        // Filtered by this suite's own stub token counts — parallel test
        // files share the local DB, other suites may write their own
        // event_discovery rows concurrently.
        const { data: usage } = await client
          .from("api_usage_log")
          .select("purpose, model")
          .eq("purpose", "event_discovery")
          .eq("input_tokens", 100)
          .eq("output_tokens", 50);
        assert.ok((usage?.length ?? 0) > 0);
        assert.ok(usage!.every((row) => row.model === "claude-haiku-4-5"));
      });
    } finally {
      await client.from("events").delete().like("title", "__test__%");
      await client.from("detected_sources").delete().like("url", "%nuevositio.cl%");
      // Surgical, by this suite's stub token counts — not by purpose alone
      // (would race with usage-tracking.test.ts's own rows).
      await client
        .from("api_usage_log")
        .delete()
        .eq("purpose", "event_discovery")
        .eq("input_tokens", 100)
        .eq("output_tokens", 50);
      await client.from("regions").delete().like("name", "__test_%");
    }
  },
);
