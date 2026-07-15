// Event Discovery, Tavily + Haiku design (docs/region-discovery.md):
// code performs 3 fixed searches per unit via Tavily, then ONE plain
// (non-agentic) Haiku call curates the concatenated results — no tools, no
// web_search, no venues. Ported from the validated PoC
// (apps/curator/scripts/poc-tavily-discover.ts) after extensive real-data
// testing; keep the two in sync only in spirit — this file is now the
// source of truth.
import { ART_SCOPE_POLICY, TEXT_CURATION_POLICY, INSTITUTIONAL_EXCLUSION_POLICY } from "../lib/curation-policy.js";
import { tavilySearch, type FetchLike, type TavilyImage } from "../lib/tavily.js";
import { isChileanLocation } from "../lib/locations.js";
import { normalizeTitle } from "../lib/event-filters.js";

export { normalizeTitle };

export interface EventCandidate {
  title: string;
  description: string | null;
  artist: string | null;
  runStartDate: string | null; // YYYY-MM-DD
  runEndDate: string | null; // YYYY-MM-DD
  openingDatetime: string | null; // ISO datetime, only when explicitly confirmed
  mediumType: "tradicional" | "intervencion_no_tradicional";
  sensitivityTags: string[];
  curationReasoning: string;
  imageUrl: string | null;
  status: "approved" | "rejected";
  location: string;
  placeName: string | null; // recognizable venue/institution/landmark name, when the source states one
  sourceUrl: string | null;
}

export interface ImageCandidate {
  url: string;
  description: string | null;
}

export interface RawResult {
  title: string;
  url: string;
  content: string;
  score: number;
  images: ImageCandidate[];
}

export interface DiscoverUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

// Narrow structural interface instead of the full Anthropic SDK class, so
// tests can inject a stub without hitting the real API.
export interface MessagesClient {
  messages: {
    create(params: Record<string, unknown>): Promise<{
      content: Array<{ type: string; text?: string }>;
      usage: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens?: number | null;
        cache_read_input_tokens?: number | null;
      };
    }>;
  };
}

const MODEL = "claude-haiku-4-5";
export { MODEL as EVENT_DISCOVERY_MODEL };

// Confirmed with real logged data: of 180 raw Tavily results, 25 had
// score < 0.15 and none of them ever became a candidate Haiku reported —
// dropping them saves tokens with no observed loss of real events.
const MIN_SCORE = 0.15;

// Real-run finding: most of the token bloat from includeImages came from
// long CDN URLs (Instagram/Facebook) with no description — without alt
// text Haiku has nothing to judge by, and in practice these were almost
// always profile pictures/generic site assets. Requiring a description
// cut token volume ~60% with no observed quality loss.
const JUNK_IMAGE_MARKERS = ["logo", "icon", "favicon", "footer", "nav-", "-nav", "sprite"];
const MAX_IMAGES_PER_RESULT = 4;

export function isJunkImage(url: string): boolean {
  const lower = url.toLowerCase();
  if (lower.endsWith(".svg")) return true;
  return JUNK_IMAGE_MARKERS.some((marker) => lower.includes(marker));
}

export function filterImageCandidates(images: TavilyImage[]): ImageCandidate[] {
  return images
    .filter((img) => !isJunkImage(img.url) && img.description)
    .slice(0, MAX_IMAGES_PER_RESULT)
    .map((img) => ({ url: img.url, description: img.description ?? null }));
}

const ES_MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export function currentMonthLabel(now: Date): string {
  return `${ES_MONTHS[now.getMonth()]} ${now.getFullYear()}`;
}

export function firstOfMonthIso(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}-01`;
}

// The 3 validated query templates — tested whether any pair of 2 would
// suffice (reusing logged data, zero extra cost): dropping any one loses
// 20-32% of unique results, including real approved candidates. All 3 stay.
export function buildQueries(unit: string, now: Date): string[] {
  const monthLabel = currentMonthLabel(now);
  return [
    `inauguracion arte ${unit} ${monthLabel}`,
    `exposicion arte ${unit} ${monthLabel}`,
    `intervencion artistica ${unit} ${monthLabel}`,
  ];
}

export async function searchUnit(
  apiKey: string,
  unit: string,
  now: Date,
  excludeDomains: string[],
  fetchImpl: FetchLike = fetch,
): Promise<{ results: RawResult[]; credits: number }> {
  const collected: RawResult[] = [];
  let credits = 0;

  for (const query of buildQueries(unit, now)) {
    const response = await tavilySearch(
      apiKey,
      query,
      { startDate: firstOfMonthIso(now), excludeDomains },
      fetchImpl,
    );
    credits += response.usage?.credits ?? 2;
    for (const r of response.results) {
      if (r.score < MIN_SCORE) continue;
      collected.push({
        title: r.title,
        url: r.url,
        content: r.content,
        score: r.score,
        images: filterImageCandidates(r.images ?? []),
      });
    }
    console.log(`[event-discovery] ${unit} search: "${query}" -> kept ${collected.length} so far`);
  }

  // Dedup by URL across the 3 queries — the same result frequently
  // surfaces under more than one template, pure token waste to repeat it.
  const seen = new Set<string>();
  const results = collected.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  return { results, credits };
}

export function formatImages(images: ImageCandidate[]): string {
  if (images.length === 0) return "";
  const lines = images
    .map((img) => `  - ${img.url}${img.description ? ` (descripción: ${img.description})` : ""}`)
    .join("\n");
  return `\nImágenes candidatas de esta fuente:\n${lines}`;
}

export function buildBlock(header: string, results: RawResult[]): string {
  const section = results
    .map((r) => `### ${r.title}\n${r.url}\n${r.content}${formatImages(r.images)}`)
    .join("\n\n");
  return `## ${header}\n\n${section}`;
}

export function buildSystemPrompt(monthLabel: string): string {
  return `Eres un curador de Caldearte, un calendario de arte. A continuación recibirás resultados de búsqueda reales sobre exposiciones e intervenciones artísticas en distintas comunas/ciudades de Chile.

Para cada evento real que encuentres, extrae:
- título, descripción, artista (si se nombra)
- \`runStartDate\`: día en que comienza la exhibición/muestra (solo fecha, sin hora), si se menciona
- \`runEndDate\`: día en que termina, si se menciona (null si no se sabe)
- \`openingDatetime\`: fecha Y hora exacta de la inauguración, SOLO si la fuente menciona una apertura/inauguración específica con hora — null si no hay una inauguración confirmada (una muestra puede no tener inauguración pública)
- \`imageUrl\`: elige, de las "imágenes candidatas" listadas bajo cada fuente, la que realmente muestre una obra, flyer o foto del evento — NO un logo, ícono, foto de perfil, o imagen decorativa del sitio. Usa la descripción de cada imagen (cuando exista) para decidir: una descripción como "profile picture" NUNCA es correcta; una descripción que menciona un cartel, afiche, o texto del evento SÍ suele serlo. Si ninguna imagen candidata parece ser realmente del evento, usa null — no inventes ni elijas al azar.
- \`sourceUrl\`: la URL de la fuente donde se puede ver más información del evento
- \`location\`: la comuna/ciudad donde ocurre el evento, tal como aparece en la fuente (ej. "Las Condes, Santiago")
- \`placeName\`: el nombre reconocible del lugar, cuando la fuente lo menciona — nombre de museo, galería, centro cultural, u otra institución (ej. "GAM", "Parque Cultural Valparaíso"); si no hay un nombre de institución pero sí una dirección o punto de referencia claro (ej. "Plaza Sotomayor", "Parque Forestal", una dirección de calle), usa eso. Si la fuente no da ninguno de los dos, usa null — no repitas la comuna/ciudad aquí, y no inventes un nombre que la fuente no menciona.

${ART_SCOPE_POLICY}

Excluye también, explícitamente:
- Convocatorias (llamados a postular obras a una futura exposición) — no son un evento que esté ocurriendo, son una invitación a futuro.
- Talleres (actividades de aprendizaje/participación, no una muestra o intervención artística).

${TEXT_CURATION_POLICY}

${INSTITUTIONAL_EXCLUSION_POLICY}

Importante sobre ubicación: no descartes un candidato solo porque la ubicación real mencionada en el contenido es distinta a la comuna/ciudad que buscamos — reporta la ubicación real tal como aparece en la fuente (ej. "Las Condes, Santiago" aunque la búsqueda haya sido por otra comuna). Descarta cuando la fuente sea de otro país (no de Chile) — esto es una regla dura, no una sugerencia: cualquier evento fuera de Chile debe ir "rejected".

Importante sobre fechas: la búsqueda no filtra perfectamente por fecha aunque se le haya pedido un mes específico. La regla es a nivel de MES, no de día exacto: descarta un candidato solo si su \`runEndDate\` (o, si no hay \`runEndDate\`, su \`runStartDate\`) corresponde a un mes ANTERIOR a ${monthLabel}, sin indicación de que siga vigente. No lo descartes solo porque su fecha específica dentro de ${monthLabel} ya pasó respecto al día de hoy, ni porque su apertura caiga en un mes posterior (un evento futuro encontrado de casualidad sigue siendo válido).

Etiqueta también: \`mediumType\` ("tradicional" o "intervencion_no_tradicional") y \`sensitivityTags\` (array de ["desnudo_erotismo", "guerra_violencia", "memoria_dictadura"], vacío si no aplica). Escribe un \`curationReasoning\` breve explicando tu decisión.

\`status\` es binario: "approved" o "rejected" — no hay estado intermedio.

Responde SOLO con un bloque de código \`\`\`json que contenga un array de objetos con esta forma exacta, nada más antes o después:
[{ "title": string, "description": string | null, "artist": string | null, "runStartDate": string | null, "runEndDate": string | null, "openingDatetime": string | null, "mediumType": "tradicional" | "intervencion_no_tradicional", "sensitivityTags": string[], "curationReasoning": string, "imageUrl": string | null, "status": "approved" | "rejected", "location": string, "placeName": string | null, "sourceUrl": string | null }]

Si no encuentras nada en scope, responde con un array vacío: \`\`\`json
[]
\`\`\``;
}

function parseCandidates(text: string): EventCandidate[] {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (!match) {
    throw new Error(
      `event-discovery: no fenced JSON block found in Haiku's response (likely truncated; tail: ${text.slice(-200)})`,
    );
  }
  return JSON.parse(match[1]) as EventCandidate[];
}

// Deterministic backstop over Haiku's own decision: a sourceUrl shared by
// 2+ approved candidates in the same batch is structurally proof that page
// hosts multiple events, not one — Haiku had only that one URL in the text
// it saw (either a Tavily hit that happened to be a listing page, or a
// bright-source page whose markup we don't have a per-event parser for
// yet, so the whole page got flattened to one blob with one URL) and had
// no way to report each event's own page. A wrong link is worse than no
// link, so null it rather than pointing a card at the wrong event.
export function nullifyAggregatorSourceUrls(candidates: EventCandidate[]): EventCandidate[] {
  const counts = new Map<string, number>();
  for (const c of candidates) {
    if (c.status !== "approved" || !c.sourceUrl) continue;
    counts.set(c.sourceUrl, (counts.get(c.sourceUrl) ?? 0) + 1);
  }
  return candidates.map((c) => (c.sourceUrl && (counts.get(c.sourceUrl) ?? 0) >= 2 ? { ...c, sourceUrl: null } : c));
}

// Deterministic backstop over Haiku's own decision — see lib/locations.ts.
export function applyLocationFilter(candidates: EventCandidate[]): EventCandidate[] {
  return candidates.map((c) =>
    c.status === "approved" && !isChileanLocation(c.location)
      ? {
          ...c,
          status: "rejected" as const,
          curationReasoning: `${c.curationReasoning} [FILTRO DE CÓDIGO: ubicación no reconocida como chilena, forzado a rejected]`,
        }
      : c,
  );
}

export interface CurateResult {
  candidates: EventCandidate[];
  usage: DiscoverUsage;
}

export async function curate(
  client: MessagesClient,
  systemPrompt: string,
  block: string,
): Promise<CurateResult> {
  // cache_control is currently a no-op (the prompt is under Haiku's
  // 2048-token minimum cacheable prefix — measured for real, both cache
  // counters come back 0) but costs nothing and starts working
  // automatically if the prompt ever grows past the threshold.
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: block }],
  });

  const text = response.content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text)
    .join("");

  return {
    candidates: nullifyAggregatorSourceUrls(applyLocationFilter(parseCandidates(text))),
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? undefined,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? undefined,
    },
  };
}

// Month-level date backstop, mirroring the prompt's rule deterministically:
// an event is stale only if its run (end date, or start date when no end is
// given) ended in a month BEFORE the current one. An event with no parseable
// date at all is unusable for a calendar (and violates the DB's
// events_has_some_date constraint) — also dropped here.
export function isCurrentOrUpcoming(c: EventCandidate, now: Date): boolean {
  const dateStr = c.runEndDate ?? c.runStartDate ?? c.openingDatetime;
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  const monthValue = (date: Date) => date.getFullYear() * 12 + date.getMonth();
  return monthValue(d) >= monthValue(now);
}
