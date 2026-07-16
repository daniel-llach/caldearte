// Throwaway diagnostic script: compares Tavily query-phrasing variants for
// comuna-name collisions (e.g. "La Reina" pulling in Madrid's Reina Sofía
// museum, "Recoleta" pulling in Buenos Aires' Recoleta) — Tavily credits
// only, zero Anthropic calls, zero DB writes, not wired into production.
// Same throwaway-PoC posture as poc-tavily-discover.ts. Run with
// `pnpm --filter @caldearte/curator query-variant-test` (loads .env via
// Node's --env-file, no dotenv dependency needed).
import { tavilySearch, type TavilyResult } from "../src/lib/tavily.js";
import { currentMonthLabel, firstOfMonthIso } from "../src/event-discovery/discover.js";

const apiKey = process.env.TAVILY_API_KEY;
if (!apiKey) throw new Error("TAVILY_API_KEY is not set");

const now = new Date();
const monthLabel = currentMonthLabel(now);
const startDate = firstOfMonthIso(now);

// La Reina and Recoleta: confirmed real collisions from raw_search_results.
// Ñuñoa: control, no known collision risk.
const COMUNAS = ["La Reina", "Recoleta", "Ñuñoa"];

const VARIANTS: Array<{ name: string; format: (unit: string) => string }> = [
  { name: "baseline", format: (u) => u },
  { name: "+chile", format: (u) => `${u}, Chile` },
  { name: "+rm", format: (u) => `${u}, Región Metropolitana` },
  { name: "comuna de", format: (u) => `comuna de ${u}` },
];

// Crude by design — good enough for A/B comparison, not a replacement for
// lib/locations.ts's isChileanLocation. Printed below so it's auditable.
const FOREIGN_TLDS = [".es", ".ar"];
const FOREIGN_MARKERS = ["españa", "madrid", "buenos aires", "argentina"];

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function looksForeign(result: TavilyResult): boolean {
  const hostname = hostnameOf(result.url);
  if (FOREIGN_TLDS.some((tld) => hostname.endsWith(tld))) return true;
  const haystack = `${result.title} ${result.content}`.toLowerCase();
  return FOREIGN_MARKERS.some((marker) => haystack.includes(marker));
}

function isChileanDomain(url: string): boolean {
  return hostnameOf(url).endsWith(".cl");
}

interface VariantMetrics {
  variant: string;
  query: string;
  resultCount: number;
  avgScore: number;
  foreignCount: number;
  chileanDomainCount: number;
  credits: number;
}

async function testVariant(query: string, variantName: string): Promise<VariantMetrics> {
  const response = await tavilySearch(apiKey!, query, { startDate, excludeDomains: [] });
  const results = response.results ?? [];
  const avgScore = results.length > 0 ? results.reduce((sum, r) => sum + r.score, 0) / results.length : 0;
  return {
    variant: variantName,
    query,
    resultCount: results.length,
    avgScore: Math.round(avgScore * 1000) / 1000,
    foreignCount: results.filter(looksForeign).length,
    chileanDomainCount: results.filter((r) => isChileanDomain(r.url)).length,
    credits: response.usage?.credits ?? 2,
  };
}

// Decision rule (from the plan): foreignCount reduction vs. baseline is
// the primary signal (it's the actual problem being solved), gated by two
// guardrails so a variant can't "win" just by returning almost nothing.
const RESULT_COUNT_FLOOR_RATIO = 0.7; // must keep >= 70% of baseline's result count
const SCORE_DROP_CEILING = 0.05; // avgScore must not drop by more than this

function verdictFor(variant: VariantMetrics, baseline: VariantMetrics): string {
  const foreignReduced = variant.foreignCount < baseline.foreignCount;
  const resultCountOk = variant.resultCount >= baseline.resultCount * RESULT_COUNT_FLOOR_RATIO;
  const scoreOk = variant.avgScore >= baseline.avgScore - SCORE_DROP_CEILING;

  if (!foreignReduced) return "no win — doesn't reduce foreign hits";
  if (!resultCountOk || !scoreOk) return "tradeoff — reduces foreign hits but fails a guardrail (discuss)";
  return "WIN — reduces foreign hits, passes both guardrails";
}

async function main() {
  console.log(`Foreign heuristic: TLDs [${FOREIGN_TLDS.join(", ")}], keywords [${FOREIGN_MARKERS.join(", ")}]`);
  console.log(`Template: "exposicion arte {variant} ${monthLabel}" — one representative category, not all 3`);
  console.log(`Comunas: ${COMUNAS.join(", ")} | Variants: ${VARIANTS.map((v) => v.name).join(", ")}\n`);

  let totalCredits = 0;

  for (const comuna of COMUNAS) {
    console.log(`\n=== ${comuna} ===`);
    const rows: VariantMetrics[] = [];
    for (const variant of VARIANTS) {
      const query = `exposicion arte ${variant.format(comuna)} ${monthLabel}`;
      const metrics = await testVariant(query, variant.name);
      rows.push(metrics);
      totalCredits += metrics.credits;
    }

    console.table(
      rows.map((r) => ({
        variant: r.variant,
        query: r.query,
        results: r.resultCount,
        avgScore: r.avgScore,
        foreign: r.foreignCount,
        clDomains: r.chileanDomainCount,
      })),
    );

    const baseline = rows.find((r) => r.variant === "baseline")!;
    for (const r of rows) {
      if (r.variant === "baseline") continue;
      console.log(`  ${r.variant}: ${verdictFor(r, baseline)}`);
    }
  }

  console.log(`\nTotal Tavily credits spent: ${totalCredits} (estimated 24)`);
}

main();
