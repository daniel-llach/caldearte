import { Resend } from "resend";

const GITHUB_API = "https://api.github.com";
const BUDGET_ALERT_LABEL = "budget-alert";

// Same recipient/domain pattern as apps/web's contact route
// (apps/web/src/app/api/contact/route.ts) — caldearte.com is already a
// verified Resend sending domain as of the production launch.
const RUN_SUMMARY_RECIPIENT = "daniel@probablespa.cl";

interface FlagBudgetExceededInput {
  spend: number;
  budget: number;
}

// Opens a GitHub issue when the monthly budget ceiling is hit, so it's
// visible without checking Action logs. GITHUB_TOKEN/GITHUB_REPOSITORY are
// auto-provided inside a GitHub Action — no new secret needed. No-ops (with
// a warning) when run outside an Action, e.g. locally or in tests.
export async function flagBudgetExceeded({ spend, budget }: FlagBudgetExceededInput): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;

  if (!token || !repo) {
    console.warn(
      "flagBudgetExceeded: GITHUB_TOKEN/GITHUB_REPOSITORY not set — skipping GitHub issue (expected outside a GitHub Action).",
    );
    return;
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  // Don't spam a new issue every run — only create one if none is open yet.
  const existing = await fetch(
    `${GITHUB_API}/repos/${repo}/issues?state=open&labels=${BUDGET_ALERT_LABEL}`,
    { headers },
  );

  if (!existing.ok) {
    throw new Error(
      `Failed to check for existing budget-alert issues: ${existing.status} ${await existing.text()}`,
    );
  }

  const openIssues = (await existing.json()) as unknown[];
  if (openIssues.length > 0) {
    return;
  }

  const body = [
    `El gasto estimado de este mes ($${spend.toFixed(2)}) alcanzó o superó el techo configurado ($${budget.toFixed(2)}).`,
    "",
    "La activación de regiones nuevas está pausada hasta que se suba el techo.",
    "",
    "Para subir el techo: `update system_config set value = '<nuevo monto>' where key = 'monthly_budget_usd';`",
    "",
    "Cerrá este issue una vez que hayas decidido qué hacer.",
  ].join("\n");

  const created = await fetch(`${GITHUB_API}/repos/${repo}/issues`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: "🚦 Techo de gasto mensual alcanzado — expansión de regiones pausada",
      body,
      labels: [BUDGET_ALERT_LABEL],
    }),
  });

  if (!created.ok) {
    throw new Error(`Failed to create budget-alert issue: ${created.status} ${await created.text()}`);
  }
}

export interface RunSummary {
  startedAt: Date;
  units: { total: number; failed: string[] };
  comunas: string[]; // unit.name for every unit attempted this run
  brightSources: { due: number; total: number };
  candidates: {
    total: number;
    approvedByCuration: number; // status === "approved" in allCandidates (Haiku's judgment)
    rejectedByCuration: number; // status === "rejected" in allCandidates
    insertedCount: number; // actually written to `events` (excludes stale/duplicate-filtered)
    byMediumType: Record<string, number>;
    sensitivityTagged: number;
  };
  cost: {
    anthropicUsd: number;
    tavilyCredits: number;
    tavilyUsd: number;
    totalUsd: number;
    monthToDateUsd: number;
    monthlyBudgetUsd: number;
  };
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

// Exported (not just used internally) so tests can assert on exact content
// without stubbing the Resend client or making any network call.
export function buildSubject(summary: RunSummary): string {
  const dateStr = summary.startedAt.toISOString().slice(0, 10).split("-").reverse().join("/");
  return `Caldearte — resumen de Event Discovery (${dateStr}, ${summary.comunas.length} comunas)`;
}

export function buildBody(summary: RunSummary): string {
  const { units, comunas, brightSources, candidates, cost } = summary;

  const lines = [
    `Resumen de la corrida de Event Discovery — ${summary.startedAt.toISOString()}`,
    "",
    `COMUNAS CONSULTADAS (${comunas.length})`,
    comunas.length > 0 ? comunas.join(", ") : "(ninguna debida esta corrida)",
    "",
    "FUENTES BRILLANTES",
    `${brightSources.due} de ${brightSources.total} debidas esta corrida (ciclo de 14 días)`,
    "",
    "UNIDADES FALLIDAS",
    units.failed.length > 0
      ? `${units.failed.length}: ${units.failed.join(", ")} (quedan pendientes para la próxima corrida)`
      : "(ninguna)",
    "",
    "EVENTOS",
    `Total candidatos: ${candidates.total}`,
    `Aprobados por curatoría: ${candidates.approvedByCuration}`,
    `Rechazados por curatoría: ${candidates.rejectedByCuration}`,
    `Insertados en el calendario: ${candidates.insertedCount}`,
    `Con tag de sensibilidad: ${candidates.sensitivityTagged}`,
    "",
    "Por tipo de medio:",
    ...Object.entries(candidates.byMediumType).map(([type, count]) => `  ${type}: ${count}`),
    "",
    "COSTO ESTIMADO DE ESTA CORRIDA",
    `Anthropic (Haiku): ${fmtUsd(cost.anthropicUsd)}`,
    `Tavily (${cost.tavilyCredits} créditos × $0.008): ${fmtUsd(cost.tavilyUsd)}`,
    `Total: ${fmtUsd(cost.totalUsd)}`,
    "",
    "GASTO DEL MES A LA FECHA",
    `$${cost.monthToDateUsd.toFixed(2)} de $${cost.monthlyBudgetUsd.toFixed(2)} (techo mensual, system_config.monthly_budget_usd)`,
  ];

  return lines.join("\n");
}

// Ancillary — sent as the very last step of a run, must never throw (a
// failed email must not fail an otherwise-successful run). Every figure in
// `summary` was already computed from data the run fetches regardless
// (usage/credits already returned by curate()/searchUnitFn calls), so this
// adds no Anthropic/Tavily cost — only one Resend send per run.
export async function sendRunSummaryEmail(summary: RunSummary): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(
      "sendRunSummaryEmail: RESEND_API_KEY not set — skipping run-summary email (expected outside CI or before the secret is configured).",
    );
    return;
  }

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: "Caldearte <contacto@caldearte.com>",
    to: RUN_SUMMARY_RECIPIENT,
    subject: buildSubject(summary),
    text: buildBody(summary),
  });

  if (error) {
    console.error("[notify] run-summary email send failed", error);
  }
}
