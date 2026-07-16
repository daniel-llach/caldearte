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
    location: "GAM, Santiago",
    placeName: "GAM",
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
    placeName: null,
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
    placeName: "Centro Cultural Recoleta",
    sourceUrl: null,
  },
  {
    // Real production bug: only run_end_date set (a source stating when a
    // show closes but never when it opened) — must insert successfully
    // (events_has_some_date accepts run_end_date alone) instead of
    // crashing the whole run.
    title: "__test__ Piedras Raras",
    description: null,
    artist: null,
    runStartDate: null,
    runEndDate: "2026-08-15",
    openingDatetime: null,
    mediumType: "tradicional",
    sensitivityTags: [],
    curationReasoning: "solo fecha de termino",
    imageUrl: null,
    status: "approved",
    location: "Concepción, Chile",
    placeName: null,
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
    location: "Plaza Sotomayor, Valparaíso",
    placeName: "Plaza Sotomayor",
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
    location: "Rancagua, Chile",
    placeName: null,
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
        assert.equal(vigente.freeform_location, "GAM, Santiago");
        assert.equal(vigente.place_name, "GAM");
        assert.equal(vigente.run_start_date, "2026-07-05");
        assert.equal(vigente.run_end_date, "2026-09-30");
        assert.equal(vigente.source, "discovered");

        const santiagoRegion = await client.from("regions").select("id").eq("name", "Santiago").single();
        assert.equal(vigente.region_id, santiagoRegion.data?.id, "matched against the seeded Santiago region");

        assert.equal(byTitle.has("__test__ Ya terminó"), false, "stale event dropped");

        const foranea = byTitle.get("__test__ Foránea");
        assert.ok(foranea, "foreign event stored for audit");
        assert.equal(foranea.curation_status, "rejected");
        assert.match(foranea.curation_reasoning, /FILTRO DE CÓDIGO/);
        assert.equal(foranea.place_name, "Centro Cultural Recoleta");
        assert.equal(foranea.region_id, null, "no seeded region named 'Argentina' — unmatched, not the unit searched");

        const soloFin = byTitle.get("__test__ Piedras Raras");
        assert.ok(soloFin, "event with only run_end_date inserts successfully (real production bug, fixed)");
        assert.equal(soloFin.run_start_date, null);
        assert.equal(soloFin.run_end_date, "2026-08-15");

        const concepcionRegion = await client.from("regions").select("id").eq("name", "Concepción").single();
        assert.equal(
          soloFin.region_id,
          concepcionRegion.data?.id,
          "'Concepción, Chile' matches via the leading segment, not just a trailing one",
        );
      });

      await t.test("logs the raw search result for the unit's own domain", async () => {
        const { data: raw } = await client.from("raw_search_results").select("*").eq("unit_name", TEST_UNIT);
        assert.equal(raw?.length, 1);
        assert.equal(raw?.[0].domain, "x.cl");
        assert.equal(raw?.[0].url, "https://x.cl");
        assert.equal(raw?.[0].score, 0.9);
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
        assert.ok(bright?.every((e) => e.curation_status === "approved"));

        const valparaisoRegion = await client.from("regions").select("id").eq("name", "Valparaíso").single();
        const brightByTitle = new Map((bright ?? []).map((e) => [e.title, e]));
        assert.equal(brightByTitle.get("__test__ Brillante uno")?.place_name, "Plaza Sotomayor");
        assert.equal(brightByTitle.get("__test__ Brillante uno")?.region_id, valparaisoRegion.data?.id);
        assert.equal(brightByTitle.get("__test__ Brillante dos")?.place_name, null);
        assert.equal(brightByTitle.get("__test__ Brillante dos")?.region_id, null, "Rancagua isn't one of the 5 seeded regions");

        const { data: detected } = await client
          .from("detected_sources")
          .select("*")
          .like("url", "%nuevositio.cl%");
        assert.equal(detected?.length, 1);
        assert.match(detected![0].note, /2 eventos completos/);
      });

      await t.test("prunes raw_search_results older than 7 days on the next run", async () => {
        const old = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
        await client.from("raw_search_results").insert({
          unit_name: TEST_UNIT,
          domain: "viejo.cl",
          url: "https://viejo.cl",
          title: "old",
          score: 0.5,
          created_at: old,
        });

        await run({
          messagesClient,
          searchUnitFn: async () => ({ results: [], credits: 0 }),
          fetchBrightSourcesFn: async () => [],
          now: NOW,
        });

        const { data: stillThere } = await client.from("raw_search_results").select("id").eq("domain", "viejo.cl");
        assert.equal(stillThere?.length, 0, "row older than 7 days got pruned");
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
      await client.from("raw_search_results").delete().eq("unit_name", TEST_UNIT);
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
