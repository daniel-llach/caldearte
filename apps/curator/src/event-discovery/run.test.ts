import { test } from "node:test";
import assert from "node:assert/strict";
import type { RunSummary } from "../lib/notify.js";

// Integration test against local Supabase. Run `supabase start`, then export
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this suite.
// Tavily, Anthropic, and Resend are always stubbed via RunDeps — no real API
// calls, no TAVILY_API_KEY/ANTHROPIC_API_KEY/RESEND_API_KEY needed.
const hasLocalSupabase = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const TEST_UNIT = "__test_unit__";
const NOW = new Date(2026, 6, 12); // July 12, 2026

// getUnitsDueForRun now caps its result to weekly_batch_size and sorts
// oldest-last_run_at-first — with 300+ real seeded comunas also due
// (null last_run_at, sorting before any real timestamp), a test's own
// units can get non-deterministically crowded out, or a large enough
// batch size can end up actually PROCESSING every real comuna (harmless
// API-wise, since searchUnitFn is always stubbed in these tests — but it
// also flips each 'not_started' comuna to 'active' and sets last_run_at,
// permanently mutating real seed data as an unwanted test side effect).
// Temporarily excluding every non-test region isolates the due/batch
// universe to just a test's own seeded units; call `restore()` in a
// `finally` block to put every real region back exactly as it was.
//
// Filters the UPDATE by the same `name NOT LIKE '__test%'` clause used
// for the snapshot SELECT, rather than collecting IDs into `.in()` — with
// 300+ UUIDs that query string is long enough to fail silently against
// PostgREST (confirmed directly: no error surfaced, but the update
// matched nothing). The restore step chunks its own `.in()` calls for
// the same reason.
async function excludeRealRegionsForTest(
  client: ReturnType<typeof import("../lib/supabase-client.js").getSupabaseClient>,
): Promise<{ restore: () => Promise<void> }> {
  const { data: realRegions } = await client.from("regions").select("id, status").not("name", "like", "__test%");
  const snapshot = realRegions ?? [];

  if (snapshot.length > 0) {
    const { error } = await client.from("regions").update({ status: "excluded" }).not("name", "like", "__test%");
    if (error) throw new Error(`Failed to temporarily exclude real regions: ${error.message}`);
  }

  return {
    async restore() {
      const CHUNK_SIZE = 50;
      const idsByStatus = new Map<string, string[]>();
      for (const r of snapshot) {
        if (!idsByStatus.has(r.status)) idsByStatus.set(r.status, []);
        idsByStatus.get(r.status)!.push(r.id);
      }
      for (const [status, ids] of idsByStatus) {
        for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
          const chunk = ids.slice(i, i + CHUNK_SIZE);
          const { error } = await client.from("regions").update({ status }).in("id", chunk);
          if (error) throw new Error(`Failed to restore region status: ${error.message}`);
        }
      }
    },
  };
}

const unitCandidates = [
  {
    title: "__test__ Muestra vigente",
    description: "desc",
    artist: "Artista",
    runStartDate: "2026-07-05",
    runEndDate: "2026-09-30",
    openingDatetime: "2026-07-05T19:00:00-04:00",
    openingTimeConfirmed: true,
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
    openingTimeConfirmed: true,
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
    openingTimeConfirmed: true,
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
    openingTimeConfirmed: true,
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
    openingTimeConfirmed: true,
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
    openingTimeConfirmed: true,
    mediumType: "tradicional",
    sensitivityTags: [],
    curationReasoning: "ok",
    imageUrl: "https://nuevositio.cl/obra2.jpg",
    status: "approved",
    // A fictional place, not a real comuna — deliberately not "Rancagua"
    // (used before the region-seeding migration added all 346 official
    // comunas as rows; Rancagua is real and would now match). Still passes
    // isChileanLocation (the trailing ", Chile" segment is enough), but
    // can never match a real regions.name — the actual thing this test
    // wants to exercise: an unmatched location gets region_id=null.
    location: "Barrio Inventado, Chile",
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

    const realRegions = await excludeRealRegionsForTest(client);

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

      await t.test(
        "a re-run where Haiku gives the same sourceUrl a different title still does not duplicate (real production bug, fixed)",
        async () => {
          const { count: before } = await client
            .from("events")
            .select("id", { count: "exact", head: true })
            .like("title", "__test__%");

          // Same sourceUrl as "__test__ Muestra vigente" (https://x.cl/expo),
          // but Haiku re-worded the title on this run — title-only dedup
          // would miss this and insert a second row for the same event.
          const retitledCandidates = unitCandidates.map((c) =>
            c.title === "__test__ Muestra vigente" ? { ...c, title: "__test__ Muestra vigente (retitulada)" } : c,
          );
          const retitledMessagesClient = {
            messages: {
              create: async (params: Record<string, unknown>) => {
                const userContent = (params.messages as Array<{ content: string }>)[0].content;
                const payload = userContent.includes("Fuentes brillantes") ? brightCandidates : retitledCandidates;
                return {
                  content: [{ type: "text", text: fencedJson(payload) }],
                  usage: { input_tokens: 100, output_tokens: 50 },
                };
              },
            },
          };

          await run({
            messagesClient: retitledMessagesClient,
            searchUnitFn,
            fetchBrightSourcesFn: async () => [],
            now: new Date(2026, 8, 20), // Sep 20 — unit due again, safely past the 28-day cadence
          });

          const { count: after } = await client
            .from("events")
            .select("id", { count: "exact", head: true })
            .like("title", "__test__%");

          assert.equal(after, before, "no duplicate inserted despite the new title — sourceUrl dedup caught it");

          const { data: retitled } = await client
            .from("events")
            .select("id")
            .eq("title", "__test__ Muestra vigente (retitulada)");
          assert.equal(retitled?.length ?? 0, 0, "the re-titled duplicate itself was not inserted");
        },
      );

      await t.test(
        "the same event reposted with a different title AND a different sourceUrl still does not duplicate, via the location+date fingerprint (real production bug, San Felipe 'SALa FEM'/'SAlaFEM'/'SalaFEM', fixed)",
        async () => {
          const { count: before } = await client
            .from("events")
            .select("id", { count: "exact", head: true })
            .like("title", "__test__%");

          // Different title AND different sourceUrl from "__test__ Muestra
          // vigente" (the real bug: 3 differently-punctuated titles from 3
          // different social posts) — but the exact same location and
          // opening_datetime, which is what should catch it.
          const repostedCandidates = unitCandidates.map((c) =>
            c.title === "__test__ Muestra vigente"
              ? { ...c, title: "__test__ MuestraVigente Reposteada", sourceUrl: "https://otrafuente.cl/repost" }
              : c,
          );
          const repostedMessagesClient = {
            messages: {
              create: async (params: Record<string, unknown>) => {
                const userContent = (params.messages as Array<{ content: string }>)[0].content;
                const payload = userContent.includes("Fuentes brillantes") ? brightCandidates : repostedCandidates;
                return {
                  content: [{ type: "text", text: fencedJson(payload) }],
                  usage: { input_tokens: 100, output_tokens: 50 },
                };
              },
            },
          };

          await run({
            messagesClient: repostedMessagesClient,
            searchUnitFn,
            fetchBrightSourcesFn: async () => [],
            now: new Date(2026, 9, 25), // Oct 25 — unit due again, safely past the 28-day cadence
          });

          const { count: after } = await client
            .from("events")
            .select("id", { count: "exact", head: true })
            .like("title", "__test__%");

          assert.equal(after, before, "no duplicate inserted — location+date fingerprint caught it");

          const { data: reposted } = await client
            .from("events")
            .select("id")
            .eq("title", "__test__ MuestraVigente Reposteada");
          assert.equal(reposted?.length ?? 0, 0, "the reposted duplicate itself was not inserted");
        },
      );

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

        // This test jumps "now" backward (Sep 20 -> Jul 13) purely to
        // exercise month-staleness filtering in isolation — not a real
        // same-session scenario, since real runs only ever move forward in
        // time. Without clearing bright_source_fetch_state here, the first
        // call above already marked every known/detected source as
        // "just fetched" (at Sep 20), which the second call's earlier
        // Jul 13 "now" would see as a NEGATIVE elapsed time — never due —
        // silently skipping the bright-sources fetch entirely.
        await client.from("bright_source_fetch_state").delete().neq("url", "");

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
        assert.equal(brightByTitle.get("__test__ Brillante dos")?.region_id, null, "a fictional place doesn't match any real seeded region");

        const { data: detected } = await client
          .from("detected_sources")
          .select("*")
          .like("url", "%nuevositio.cl%");
        assert.equal(detected?.length, 1);
        assert.match(detected![0].note, /2 eventos completos/);
      });

      await t.test("a bright source fetched recently is skipped until its own 2-week cadence elapses, independent of other sources", async () => {
        await client.from("bright_source_fetch_state").delete().neq("url", "");
        let fetchCallCount = 0;
        const fetchBrightSourcesFn = async () => {
          fetchCallCount += 1;
          return [{ title: "fuente", url: "https://agenda.cl", content: "c", score: 1, images: [] }];
        };

        // First run: nothing fetched yet -> due -> fetch happens, state recorded.
        await run({
          messagesClient,
          searchUnitFn: async () => ({ results: [], credits: 0 }),
          fetchBrightSourcesFn,
          now: new Date(2026, 6, 13), // July 13
        });
        assert.equal(fetchCallCount, 1);

        // Second run, 3 days later — well under the 2-week interval —
        // must be skipped: fetchBrightSourcesFn is not called again.
        await run({
          messagesClient,
          searchUnitFn: async () => ({ results: [], credits: 0 }),
          fetchBrightSourcesFn,
          now: new Date(2026, 6, 16), // July 16
        });
        assert.equal(fetchCallCount, 1, "still 1 — 3 days is under the 2-week cadence");

        // Third run, 15 days after the FIRST fetch — past the interval —
        // due again, fetch happens.
        await run({
          messagesClient,
          searchUnitFn: async () => ({ results: [], credits: 0 }),
          fetchBrightSourcesFn,
          now: new Date(2026, 6, 28), // July 28 — 15 days after July 13
        });
        assert.equal(fetchCallCount, 2, "due again once 2 weeks have passed since ITS OWN last fetch");

        await client.from("events").delete().like("title", "__test__ Brillante%");
        await client.from("detected_sources").delete().like("url", "%nuevositio.cl%");
        await client.from("bright_source_fetch_state").delete().neq("url", "");
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

      await t.test("prunes events more than a year past their run_end_date, keeps recent ones", async () => {
        await client.from("events").insert([
          {
            title: "__test__ Evento expirado",
            freeform_location: "GAM, Santiago",
            opening_datetime: "2024-01-01T22:00:00+00:00",
            run_start_date: "2024-01-01",
            run_end_date: "2024-06-01", // well over a year before NOW (2026-07-12)
            source: "discovered",
            curation_status: "approved",
          },
          {
            title: "__test__ Evento reciente",
            freeform_location: "GAM, Santiago",
            opening_datetime: "2026-06-01T22:00:00+00:00",
            run_start_date: "2026-06-01",
            run_end_date: "2026-06-15", // under a year before NOW
            source: "discovered",
            curation_status: "approved",
          },
        ]);

        await run({
          messagesClient,
          searchUnitFn: async () => ({ results: [], credits: 0 }),
          fetchBrightSourcesFn: async () => [],
          now: NOW,
        });

        const { data: remaining } = await client
          .from("events")
          .select("title")
          .like("title", "__test__ Evento%");
        const titles = (remaining ?? []).map((e) => e.title);
        assert.ok(!titles.includes("__test__ Evento expirado"), "event past 1-year retention got pruned");
        assert.ok(titles.includes("__test__ Evento reciente"), "recent event was kept");
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

      await t.test("sendRunSummaryEmailFn is called exactly once per run, with comunas reflecting units actually attempted", async () => {
        let callCount = 0;
        let capturedSummary: RunSummary | undefined;
        const sendRunSummaryEmailFn = async (summary: RunSummary) => {
          callCount += 1;
          capturedSummary = summary;
        };

        await run({
          messagesClient,
          searchUnitFn,
          fetchBrightSourcesFn: async () => [],
          sendRunSummaryEmailFn,
          now: new Date(2026, 10, 22), // Nov 22 — unit due again
        });

        assert.equal(callCount, 1, "called once, not per-unit or per-bright-source-pass");
        assert.ok(capturedSummary);
        assert.ok(capturedSummary!.comunas.includes(TEST_UNIT));
        assert.ok(!capturedSummary!.comunas.includes("__test_excluded__"), "excluded units never enter the due batch");
      });

      await t.test("summary distinguishes insertedCount (actually written) from approvedByCuration (Haiku's raw call)", async () => {
        // One current+approved (gets inserted) and one approved-but-stale
        // (filtered by isCurrentOrUpcoming before insertCandidates ever
        // runs) — approvedByCuration counts both, insertedCount only the first.
        const mixedCandidates = [
          {
            title: "__test__ Vigente Nov",
            description: null,
            artist: null,
            runStartDate: "2026-12-25", // same month as this test's "now" (Dec 20) — current
            runEndDate: null,
            openingDatetime: null,
    openingTimeConfirmed: true,
            mediumType: "tradicional",
            sensitivityTags: [],
            curationReasoning: "ok",
            imageUrl: null,
            status: "approved",
            location: "GAM, Santiago",
            placeName: null,
            sourceUrl: "https://x.cl/vigente-nov",
          },
          {
            title: "__test__ Vieja Nov",
            description: null,
            artist: null,
            runStartDate: "2026-05-01",
            runEndDate: "2026-05-15", // months before Nov 25 — stale
            openingDatetime: null,
    openingTimeConfirmed: true,
            mediumType: "tradicional",
            sensitivityTags: [],
            curationReasoning: "ok",
            imageUrl: null,
            status: "approved",
            location: "GAM, Santiago",
            placeName: null,
            sourceUrl: "https://x.cl/vieja-nov",
          },
        ];
        const mixedMessagesClient = {
          messages: {
            create: async () => ({
              content: [{ type: "text", text: fencedJson(mixedCandidates) }],
              usage: { input_tokens: 100, output_tokens: 50 },
            }),
          },
        };

        let capturedSummary: RunSummary | undefined;
        await run({
          messagesClient: mixedMessagesClient,
          searchUnitFn,
          fetchBrightSourcesFn: async () => [],
          sendRunSummaryEmailFn: async (summary) => {
            capturedSummary = summary;
          },
          now: new Date(2026, 11, 20), // Dec 20 — unit due again
        });

        assert.ok(capturedSummary);
        assert.equal(capturedSummary!.candidates.approvedByCuration, 2, "both candidates were approved by Haiku's call");
        assert.equal(capturedSummary!.candidates.insertedCount, 1, "only the current one actually got written to events");
      });

      await t.test("cost figures derive from usage/credits already in scope, not a new query", async () => {
        let capturedSummary: RunSummary | undefined;
        await run({
          messagesClient,
          searchUnitFn, // stub always returns 6 Tavily credits per searched unit
          fetchBrightSourcesFn: async () => [],
          sendRunSummaryEmailFn: async (summary) => {
            capturedSummary = summary;
          },
          now: new Date(2027, 0, 24), // Jan 24, 2027 — unit due again
        });

        assert.ok(capturedSummary);
        const { estimateCostUsd } = await import("../lib/pricing.js");
        const expectedAnthropicUsd = estimateCostUsd("claude-haiku-4-5", { inputTokens: 100, outputTokens: 50 });
        assert.equal(capturedSummary!.cost.anthropicUsd, expectedAnthropicUsd, "exactly one curate() call happened (unit pass, no bright sources due)");
        assert.equal(capturedSummary!.cost.tavilyCredits, 6, "the stub's fixed credits value for the one searched unit");
        assert.equal(capturedSummary!.cost.tavilyUsd, 6 * 0.008);
        assert.ok(capturedSummary!.cost.totalUsd > 0);
      });

      await t.test("a failing unit lands in units.failed, the run still completes and still sends the summary", async () => {
        const throwingSearchUnitFn = async (_key: string, unitName: string) => {
          if (unitName === TEST_UNIT) throw new Error("simulated Tavily failure");
          return { results: [], credits: 0 };
        };

        let capturedSummary: RunSummary | undefined;
        await run({
          messagesClient,
          searchUnitFn: throwingSearchUnitFn,
          fetchBrightSourcesFn: async () => [],
          sendRunSummaryEmailFn: async (summary) => {
            capturedSummary = summary;
          },
          now: new Date(2027, 1, 21), // Feb 21, 2027 — unit due again
        });

        assert.ok(capturedSummary);
        assert.ok(capturedSummary!.units.failed.includes(TEST_UNIT));
      });

      await t.test("sendRunSummaryEmailFn still fires when zero events are found", async () => {
        let capturedSummary: RunSummary | undefined;
        await run({
          messagesClient,
          searchUnitFn: async () => ({ results: [], credits: 0 }),
          fetchBrightSourcesFn: async () => [],
          sendRunSummaryEmailFn: async (summary) => {
            capturedSummary = summary;
          },
          now: new Date(2027, 2, 21), // Mar 21, 2027 — unit due again
        });

        assert.ok(capturedSummary, "the summary email is ancillary reporting, not gated on there being something to report");
        assert.equal(capturedSummary!.candidates.total, 0);
      });

      await t.test("excludeDomains passed to Tavily merges bright-source domains with known low-quality-extraction domains", async () => {
        let capturedExcludeDomains: string[] = [];
        const capturingSearchUnitFn = async (_key: string, _unitName: string, _now: Date, excludeDomains: string[]) => {
          capturedExcludeDomains = excludeDomains;
          return { results: [], credits: 0 };
        };

        await run({
          messagesClient,
          searchUnitFn: capturingSearchUnitFn,
          fetchBrightSourcesFn: async () => [],
          now: new Date(2027, 3, 18), // Apr 18, 2027 — unit due again
        });

        assert.ok(
          capturedExcludeDomains.includes("infobae.com"),
          "the known-low-quality domain is passed to Tavily's exclude_domains, not just filtered post-hoc",
        );
      });
    } finally {
      await client.from("events").delete().like("title", "__test__%");
      await client.from("detected_sources").delete().like("url", "%nuevositio.cl%");
      await client.from("bright_source_fetch_state").delete().neq("url", "");
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
      await realRegions.restore();
    }
  },
);

test(
  "getUnitsDueForRun batch cap (requires local Supabase)",
  { skip: !hasLocalSupabase && "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set" },
  async (t) => {
    const { getUnitsDueForRun } = await import("./run.js");
    const { getSupabaseClient } = await import("../lib/supabase-client.js");
    const client = getSupabaseClient();

    const { data: originalBatchSize } = await client
      .from("system_config")
      .select("value")
      .eq("key", "weekly_batch_size")
      .single();
    const realRegions = await excludeRealRegionsForTest(client);

    try {
      // Three never-run test regions, seeded in a deliberately scrambled
      // insert order — proves sorting happens on last_run_at, not
      // insertion/id order. Both timestamps must be >28 days before NOW
      // (July 12) to count as "due" at all under isDueForRun's own check.
      const older = new Date(2026, 4, 1).toISOString(); // May 1
      const newer = new Date(2026, 4, 20).toISOString(); // May 20
      await client.from("regions").insert([
        { name: "__test_batch_c__", country: "Testland", language: "es", status: "not_started", last_run_at: newer },
        { name: "__test_batch_a__", country: "Testland", language: "es", status: "not_started", last_run_at: null },
        { name: "__test_batch_b__", country: "Testland", language: "es", status: "not_started", last_run_at: older },
      ]);

      await t.test("caps the due list to weekly_batch_size", async () => {
        await client.from("system_config").update({ value: "2" }).eq("key", "weekly_batch_size");
        const due = await getUnitsDueForRun(NOW);
        const testUnits = due.filter((r) => r.name.startsWith("__test_batch_"));
        assert.equal(testUnits.length, 2, "only 2 of the 3 due test regions fit in a batch size of 2");
      });

      await t.test("oldest last_run_at first — never-run (null) sorts before any real timestamp", async () => {
        await client.from("system_config").update({ value: "10000" }).eq("key", "weekly_batch_size");
        const due = await getUnitsDueForRun(NOW);
        const names = due.filter((r) => r.name.startsWith("__test_batch_")).map((r) => r.name);
        assert.deepEqual(names, ["__test_batch_a__", "__test_batch_b__", "__test_batch_c__"]);
      });
    } finally {
      await client.from("regions").delete().like("name", "__test_batch_%");
      await realRegions.restore();
      if (originalBatchSize) {
        await client.from("system_config").update({ value: originalBatchSize.value }).eq("key", "weekly_batch_size");
      }
    }
  },
);

test(
  "one unit throwing doesn't crash the rest of the batch — real production bug (2026-07-17): an uncaught exception in ONE unit killed the entire weekly-batch run, losing every remaining unit",
  { skip: !hasLocalSupabase && "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set" },
  async () => {
    const { run, getUnitsDueForRun } = await import("./run.js");
    const { getSupabaseClient } = await import("../lib/supabase-client.js");
    const client = getSupabaseClient();
    const brokenUnit = "__test_broken__";
    const okUnit = "__test_ok__";
    const realRegions = await excludeRealRegionsForTest(client);
    const { data: originalBatchSize } = await client
      .from("system_config")
      .select("value")
      .eq("key", "weekly_batch_size")
      .single();

    try {
      const { data: broken, error: e1 } = await client
        .from("regions")
        .insert({ name: brokenUnit, country: "Testland", language: "es", status: "active" })
        .select()
        .single();
      const { data: ok, error: e2 } = await client
        .from("regions")
        .insert({ name: okUnit, country: "Testland", language: "es", status: "active" })
        .select()
        .single();
      if (e1 || !broken || e2 || !ok) throw new Error(`Failed to seed test units: ${e1?.message} ${e2?.message}`);

      await client.from("system_config").update({ value: "10000" }).eq("key", "weekly_batch_size");

      const searchUnitFn = async (_key: string, unitName: string) => {
        if (unitName === brokenUnit) throw new Error("simulated search failure");
        return unitName === okUnit
          ? { results: [{ title: "r", url: "https://x.cl", content: "c", score: 0.9, images: [] }], credits: 6 }
          : { results: [], credits: 0 };
      };
      const messagesClient = {
        messages: {
          create: async () => ({
            content: [{ type: "text", text: fencedJson([]) }],
            usage: { input_tokens: 100, output_tokens: 50 },
          }),
        },
      };

      // getUnitsDueForRun sorts by last_run_at, both null (tied) — insert
      // order alone doesn't guarantee brokenUnit runs first, so force it
      // explicitly by checking due-order and, if needed, aborting isn't an
      // option here; instead assert on outcomes only, not processing order.
      await run({ messagesClient, searchUnitFn, fetchBrightSourcesFn: async () => [], now: NOW });

      const { data: brokenAfter } = await client.from("regions").select("last_run_at").eq("id", broken.id).single();
      assert.equal(brokenAfter?.last_run_at, null, "broken unit stays due — not silently marked done with no real data");

      const { data: okAfter } = await client.from("regions").select("last_run_at").eq("id", ok.id).single();
      assert.ok(okAfter?.last_run_at, "the OTHER unit still completed and got its last_run_at set");

      const due = await getUnitsDueForRun(NOW);
      assert.ok(due.some((r) => r.id === broken.id), "broken unit is still due for retry next run");
    } finally {
      await client.from("regions").delete().in("name", [brokenUnit, okUnit]);
      await client.from("raw_search_results").delete().eq("unit_name", okUnit);
      await client
        .from("api_usage_log")
        .delete()
        .eq("purpose", "event_discovery")
        .eq("input_tokens", 100)
        .eq("output_tokens", 50);
      await realRegions.restore();
      if (originalBatchSize) {
        await client.from("system_config").update({ value: originalBatchSize.value }).eq("key", "weekly_batch_size");
      }
    }
  },
);

test(
  "a 'not_started' comuna flips to 'active' the first time it actually runs (requires local Supabase)",
  { skip: !hasLocalSupabase && "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set" },
  async () => {
    const { run } = await import("./run.js");
    const { getSupabaseClient } = await import("../lib/supabase-client.js");
    const client = getSupabaseClient();
    const unitName = "__test_not_started__";

    const { data: originalBatchSize } = await client
      .from("system_config")
      .select("value")
      .eq("key", "weekly_batch_size")
      .single();
    const realRegions = await excludeRealRegionsForTest(client);

    try {
      const { data: unit, error } = await client
        .from("regions")
        .insert({ name: unitName, country: "Testland", language: "es", status: "not_started" })
        .select()
        .single();
      if (error || !unit) throw new Error(`Failed to seed test unit: ${error?.message}`);

      await client.from("system_config").update({ value: "10000" }).eq("key", "weekly_batch_size");

      await run({
        messagesClient: {
          messages: { create: async () => ({ content: [{ type: "text", text: fencedJson([]) }], usage: { input_tokens: 100, output_tokens: 50 } }) },
        },
        searchUnitFn: async () => ({ results: [], credits: 0 }),
        fetchBrightSourcesFn: async () => [],
        now: NOW,
      });

      const { data: after } = await client.from("regions").select("status").eq("id", unit.id).single();
      assert.equal(after?.status, "active");
    } finally {
      await client.from("regions").delete().eq("name", unitName);
      await realRegions.restore();
      await client
        .from("api_usage_log")
        .delete()
        .eq("purpose", "event_discovery")
        .eq("input_tokens", 100)
        .eq("output_tokens", 50);
      if (originalBatchSize) {
        await client.from("system_config").update({ value: originalBatchSize.value }).eq("key", "weekly_batch_size");
      }
    }
  },
);
