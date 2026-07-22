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
import { matchesKnownExclusion, matchesKnownLowQualityDomain } from "../lib/known-exclusions.js";
import { normalizeTitle } from "../lib/event-filters.js";
import { parseLocalDatetimeToUtcIso } from "../lib/opening-time.js";

export { normalizeTitle };

export interface EventCandidate {
  title: string;
  description: string | null;
  artist: string | null;
  runStartDate: string | null; // YYYY-MM-DD
  runEndDate: string | null; // YYYY-MM-DD
  openingDatetime: string | null; // ISO datetime, only when explicitly confirmed
  // false when the source confirms an inauguración DATE but never an hour
  // — Haiku reports this itself now (see buildSystemPrompt's
  // openingDatetime/openingTimeConfirmed instructions), same convention
  // lib/opening-time.ts's deterministic regex path already used. Real bug
  // found in production (2026-07-21): before Haiku could report this
  // itself, its prompt required BOTH date and hour before setting
  // openingDatetime at all — 7 events with an inauguración explicitly
  // confirmed in Haiku's own curationReasoning still got openingDatetime
  // null purely because the hour was missing, discarding a real confirmed
  // date. Meaningless when openingDatetime is null.
  openingTimeConfirmed: boolean;
  mediumType: "tradicional" | "intervencion_no_tradicional";
  sensitivityTags: string[];
  curationReasoning: string;
  imageUrl: string | null;
  status: "approved" | "rejected";
  location: string;
  placeName: string | null; // recognizable venue/institution/landmark name, when the source states one
  sourceUrl: string | null;
  // Verbatim quote grounding, added 2026-07-22 after a real production
  // audit found Haiku fabricating whole events — specific dates/hours,
  // venue names, even descriptions — with zero basis in the source text,
  // while writing a confident-sounding curationReasoning. The existing
  // "NUNCA inventes... cita la frase exacta" prompt instruction (added
  // 2026-07-20) already asked for this and still failed, because a
  // free-text instruction isn't a verifiable guardrail. These two fields
  // make it one: enforceGroundedQuotes checks them against the actual
  // block text in code, not on Haiku's word. null when there's nothing to
  // ground (openingDatetime null) or when Haiku's output is malformed.
  dateQuote: string | null; // exact substring from the source confirming openingDatetime
  locationQuote: string | null; // exact substring from the source confirming location
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
//
// ", Chile" appended to the unit: comuna-name collisions with unrelated
// foreign places (e.g. "La Reina" pulling in Madrid's Reina Sofía museum,
// "Recoleta" pulling in Buenos Aires' Recoleta) are a real, measured
// pattern (scripts/query-variant-test.ts, a Tavily-only A/B test, zero
// Anthropic cost). ", Chile" was the clear winner over "Región
// Metropolitana" and "comuna de {unit}": eliminated foreign hits entirely
// for both collision-prone comunas tested (Recoleta 5→0, La Reina 3→0)
// with no loss of result count, and didn't hurt a control comuna with no
// collision problem (Ñuñoa). This was already a safety-net-only concern
// even before the change — applyLocationFilter already rejects anything
// that doesn't resolve to a real Chilean place, and none of these
// collisions had ever produced an actual event — so this is a
// signal-to-noise improvement, not a correctness fix.
export function buildQueries(unit: string, now: Date): string[] {
  const monthLabel = currentMonthLabel(now);
  return [
    `inauguracion arte ${unit}, Chile ${monthLabel}`,
    `exposicion arte ${unit}, Chile ${monthLabel}`,
    `intervencion artistica ${unit}, Chile ${monthLabel}`,
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

// Deterministic backstop, applied BEFORE curation — drops a known
// out-of-scope event's own search result so it never reaches Haiku's
// input at all: saves both the input tokens for that result's content
// and the output tokens Haiku would've spent generating (then discarding)
// a candidate for it. Safe for regular per-unit search results (each
// Tavily hit here is normally one page about one event, so matching the
// result's own title is precise) — NOT applied to bright sources, whose
// content bundles many events into one page; those rely on
// applyKnownExclusionsFilter below instead, after Haiku has already
// separated them into individual candidates.
//
// Also drops results from known low-quality-extraction domains
// (matchesKnownLowQualityDomain) — pages that themselves bundle many
// events/countries into one tangled page despite showing up as a REGULAR
// per-unit search result, not a bright source, so the "one page = one
// event" assumption above doesn't hold for them either. See
// known-exclusions.ts for the real case (infobae.com's agenda-cultura).
export function filterKnownExclusions(results: RawResult[]): RawResult[] {
  return results.filter((r) => !matchesKnownExclusion(r.title) && !matchesKnownLowQualityDomain(r.url));
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
- \`openingDatetime\` + \`openingTimeConfirmed\`: fecha de la inauguración, SOLO si la fuente confirma que existe una apertura/inauguración específica — ambos campos van null/false si no hay una inauguración confirmada (una muestra puede no tener inauguración pública, o el texto solo da el rango de la muestra sin mencionar ninguna apertura). **NUNCA inventes ni completes esta fecha con un valor "razonable" o "probable" — si no puedes citar la frase exacta de la fuente que confirma esa fecha, usa null.** Dos señales de alarma específicas, encontradas en producción (2026-07-20): (1) una publicación de red social que es un *registro/recuerdo* de una inauguración YA REALIZADA ("Compartimos este registro de la inauguración...", en pasado) no tiene una inauguración futura que reportar — openingDatetime debe ser null, aunque la publicación sea reciente; (2) una fecha real pero de un evento ya terminado (ej. "del 23 de diciembre al 28 de enero", sin relación con el mes buscado) no se convierte en una fecha del mes actual solo porque no tienes otra — si la fecha real no encaja con ${monthLabel}, el candidato se rechaza o se le pone openingDatetime null, nunca se sustituye por una fecha inventada.
  - Si la fuente confirma la fecha **y** la hora exacta de la inauguración: reporta ambas, con \`openingTimeConfirmed: true\`.
  - Si la fuente confirma que hay una inauguración en una fecha específica pero **no da la hora**: reporta esa fecha con hora "00:00" (un valor placeholder — el código nunca la muestra como si fuera real) y \`openingTimeConfirmed: false\`. **NO uses null solo porque falta la hora** — la fecha confirmada por sí sola ya es información real y valiosa que no debe perderse. Bug real encontrado en producción (2026-07-21): 7 eventos con una inauguración explícitamente confirmada en el propio \`curationReasoning\` de la curación terminaron con \`openingDatetime\` null solo por faltar la hora exacta.
  - **Formato obligatorio: "YYYY-MM-DDTHH:mm", SIEMPRE en hora LOCAL de Chile tal como la reporta la fuente (o "00:00" en el caso de hora no confirmada, arriba) — nunca agregues "Z" ni un offset de zona horaria, ni conviertas tú mismo a UTC** (ej. una fuente que dice "19:00 hrs" se reporta como "2026-07-15T19:00", nunca "2026-07-15T19:00:00Z" ni "...-04:00" ni "...-03:00" — el código se encarga de esa conversión).
- \`imageUrl\`: elige, de las "imágenes candidatas" listadas bajo cada fuente, la que realmente muestre una obra, flyer o foto del evento — NO un logo, ícono, foto de perfil, o imagen decorativa del sitio. Usa la descripción de cada imagen (cuando exista) para decidir: una descripción como "profile picture" NUNCA es correcta; una descripción que menciona un cartel, afiche, o texto del evento SÍ suele serlo. Si ninguna imagen candidata parece ser realmente del evento, usa null — no inventes ni elijas al azar.
- \`sourceUrl\`: la URL de la fuente donde se puede ver más información del evento. Cada bloque de resultados trae su propia URL justo después del título, al inicio del bloque — si no encuentras una URL más específica para el evento individual, usa esa URL del bloque en vez de responder null. **INVARIANTE: si status es "approved", sourceUrl NUNCA puede ser null.** Si un bloque no tiene URL disponible, entonces el evento debe ser "rejected", no "approved".
- \`location\`: la comuna/ciudad donde ocurre el evento, tal como aparece en la fuente (ej. "Las Condes, Santiago")
- \`placeName\`: el nombre reconocible del lugar, cuando la fuente lo menciona — nombre de museo, galería, centro cultural, u otra institución (ej. "GAM", "Parque Cultural Valparaíso"); si no hay un nombre de institución pero sí una dirección o punto de referencia claro (ej. "Plaza Sotomayor", "Parque Forestal", una dirección de calle), usa eso. Si la fuente no da ninguno de los dos, usa null — no repitas la comuna/ciudad aquí, y no inventes un nombre que la fuente no menciona.
- \`dateQuote\`: SOLO si \`openingDatetime\` no es null — copia LITERAL (textual, sin resumir ni traducir) de la frase exacta de la fuente que confirma esa fecha/hora. Si no puedes copiar una frase real que lo diga, \`openingDatetime\` y \`dateQuote\` van ambos null — esto se verifica en código contra el texto real, así que una cita inventada o parafraseada será detectada y el campo se anulará de todos modos.
- \`locationQuote\`: copia LITERAL de la frase de la fuente que nombra la ubicación que reportaste en \`location\` (puede ser el nombre de la comuna/ciudad, o el nombre de la cuenta/medio que publica si el texto no nombra la ubicación explícitamente pero la cuenta la deja clara, ej. "@culturaquilpue" o "tvohiggins"). Si no hay ninguna evidencia textual de dónde ocurre el evento, el evento debe ser "rejected" — no inventes una ubicación basándote en la comuna que estás buscando.

Regla general, para todos los campos: si un dato específico (fecha, hora, título, artista, lugar) no aparece literalmente en el texto de la fuente, ese campo va null — nunca lo completes con un valor "razonable", "típico", o inferido de otros eventos que estés viendo en el mismo lote. Un texto sobre un evento que ya ocurrió (ej. "Compartimos este registro de la inauguración...", en pasado) no es evidencia de un evento futuro, aunque la publicación misma sea reciente.

**Grounding obligatorio, encontrado en producción 2026-07-22:** la instrucción de arriba ("nunca inventes... cita la frase exacta") ya existía y aun así Haiku inventó eventos completos — fecha, hora, nombre del lugar, e incluso la descripción — sin ninguna base real en el texto, mientras escribía un \`curationReasoning\` que sonaba seguro y específico. \`dateQuote\`/\`locationQuote\` existen para que esto se pueda verificar en código, no solo confiar en tu palabra. Casos reales encontrados ese día, todos con \`status: "approved"\` cuando debían ser "rejected" o con el campo en null:
1. Un post cuyo texto real era solo "Columna de @rtorrescultura para ARTEPUERTO. Gracias Rafael..." (sin fecha, hora, ni descripción de ningún tipo) fue curado como "Exposición visual de arte plástico (grabadores y esculturas) con inauguración confirmada en fecha y hora específicas" — 100% inventado.
2. Un post real de un museo (balance institucional genérico de 2025, publicado 5 meses antes del mes buscado) fue curado como "CineForo Mariposas Verdes: Cine, diversidad y convivencia... Día Internacional de Orgullo LGBTI2+" — evento completo inventado, cero mención de eso en el texto.
3. Un artículo real sobre una expo que **cierra** el 3 de julio en Rancagua fue curado como "Inauguración: 09 de julio del 2026 a las 19:00 horas" en una comuna distinta (Curacautín) — fecha, hora Y ubicación inventadas.
4. Un recorrido virtual real (nombre real "Archivo del relato persistente", publicado en marzo, cierra el 21 de marzo) fue curado con "inauguración confirmada jueves 16 de julio... Galería Central María Izquierdo" — ningún dato coincide con el texto real.
5. Un post real sobre una exposición en Jaén, **España** (mención explícita de "la Guerra Civil de Jaén") fue curado con \`location\` asignado a una comuna chilena — nunca reportes una ubicación chilena si el texto no la nombra, aunque estés buscando esa comuna específica.

${ART_SCOPE_POLICY}

Excluye también, explícitamente:
- Convocatorias (llamados a postular obras a una futura exposición) — no son un evento que esté ocurriendo, son una invitación a futuro.
- Talleres (actividades de aprendizaje/participación, no una muestra o intervención artística).

${TEXT_CURATION_POLICY}

${INSTITUTIONAL_EXCLUSION_POLICY}

Importante sobre ubicación: no descartes un candidato solo porque la ubicación real mencionada en el contenido es distinta a la comuna/ciudad que buscamos — reporta la ubicación real tal como aparece en la fuente (ej. "Las Condes, Santiago" aunque la búsqueda haya sido por otra comuna). Descarta cuando la fuente sea de otro país (no de Chile) — esto es una regla dura, no una sugerencia: cualquier evento fuera de Chile debe ir "rejected".

Importante sobre fechas: la búsqueda no filtra perfectamente por fecha aunque se le haya pedido un mes específico. La regla es a nivel de MES, no de día exacto: descarta un candidato solo si su \`runEndDate\` (o, si no hay \`runEndDate\`, su \`runStartDate\`) corresponde a un mes ANTERIOR a ${monthLabel}, sin indicación de que siga vigente. No lo descartes solo porque su fecha específica dentro de ${monthLabel} ya pasó respecto al día de hoy, ni porque su apertura caiga en un mes posterior (un evento futuro encontrado de casualidad sigue siendo válido).

Cuidado especial con publicaciones de redes sociales (Instagram, Facebook, TikTok) que mencionan solo día y mes SIN año (ej. "del 1 al 28 de julio"): estas publicaciones a veces reaparecen en la búsqueda aunque tengan más de un año de antigüedad, y el buscador no siempre lo detecta. NO asumas automáticamente que se refieren a ${monthLabel} solo porque coincide con el mes actual. Antes de asignar el año actual a esa fecha, busca alguna señal de vigencia real en el propio texto (el año escrito explícitamente, una mención a "hoy", "esta semana", "recién inaugurada", u otro indicio de actualidad). Si la única pista es "día de mes" sin año y no hay ninguna señal de vigencia, rechaza el candidato por precaución en vez de asumir que es de ${monthLabel}.

Regla dura sobre el año: si la fuente menciona un año explícitamente (ej. "13 de junio 2025"), usa ESE año tal cual — nunca lo reemplaces por el año de ${monthLabel} solo porque el día/mes coincide con lo buscado. Muchos sitios de agenda cultural conservan páginas de eventos ya realizados, a veces marcadas explícitamente con avisos como "Este evento ha pasado" o "Evento finalizado" — si ves ese tipo de aviso, o si el año explícito de la fuente hace que el evento ya haya terminado, rechaza el candidato sin importar que el día/mes parezca vigente.

Etiqueta también: \`mediumType\` ("tradicional" o "intervencion_no_tradicional") y \`sensitivityTags\` (array de ["desnudo_erotismo", "guerra_violencia", "memoria_dictadura"], vacío si no aplica). Escribe un \`curationReasoning\` breve explicando tu decisión.

\`status\` es binario: "approved" o "rejected" — no hay estado intermedio.

Responde SOLO con un bloque de código \`\`\`json que contenga un array de objetos con esta forma exacta, nada más antes o después:
[{ "title": string, "description": string | null, "artist": string | null, "runStartDate": string | null, "runEndDate": string | null, "openingDatetime": string | null, "openingTimeConfirmed": boolean, "dateQuote": string | null, "locationQuote": string | null, "mediumType": "tradicional" | "intervencion_no_tradicional", "sensitivityTags": string[], "curationReasoning": string, "imageUrl": string | null, "status": "approved" | "rejected", "location": string, "placeName": string | null, "sourceUrl": string | null }]

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
  const parsed = JSON.parse(match[1]) as (EventCandidate & {
    openingTimeConfirmed?: unknown;
    dateQuote?: unknown;
    locationQuote?: unknown;
  })[];
  return parsed.map((c) => ({
    ...c,
    // Haiku reports openingDatetime as a plain Chile-local "YYYY-MM-DDTHH:mm"
    // (see buildSystemPrompt) — converted here to a real UTC instant via the
    // same DST-safe logic lib/opening-time.ts already uses for the
    // deterministic regex path. Real bug, found 2026-07-20: this used to be
    // written straight through with zero conversion, so a source's "12:30"
    // rendered as "08:30" on the card (America/Santiago is UTC-4). Malformed
    // output degrades to null rather than a silently wrong instant.
    openingDatetime: c.openingDatetime ? parseLocalDatetimeToUtcIso(c.openingDatetime) : null,
    // Haiku now reports this itself (see buildSystemPrompt) — `false` means
    // it confirmed a date but never an hour (reported as a "00:00"
    // placeholder). Defaults to `true` only if Haiku's output is malformed
    // (field missing or not a real boolean) — the safe assumption when
    // openingDatetime is set at all, and meaningless when it's null.
    openingTimeConfirmed: typeof c.openingTimeConfirmed === "boolean" ? c.openingTimeConfirmed : true,
    // Same defensive posture — malformed/missing quote fields degrade to
    // null (treated as "ungrounded" by enforceGroundedQuotes below), never
    // thrown on.
    dateQuote: typeof c.dateQuote === "string" ? c.dateQuote : null,
    locationQuote: typeof c.locationQuote === "string" ? c.locationQuote : null,
  }));
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

// Backstop for known-out-of-scope events, applied AFTER curation (unlike
// filterKnownExclusions above, which runs before) — catches candidates
// filterKnownExclusions can't safely reach: bright-source content, where
// many events share one page and Haiku is the one who first separates
// them into individual titles, or a regular search hit whose own Tavily
// title didn't happen to match even though Haiku's extracted title does.
// No token savings here (Haiku already ran) — this is the safety net.
export function applyKnownExclusionsFilter(candidates: EventCandidate[]): EventCandidate[] {
  return candidates.map((c) =>
    c.status === "approved" && matchesKnownExclusion(c.title)
      ? { ...c, status: "rejected" as const, curationReasoning: `${c.curationReasoning} [FILTRO DE CÓDIGO: evento conocido fuera de alcance]` }
      : c,
  );
}

// Domains confirmed (2026-07-20, via a user-requested manual review of
// real production events) to never publish a real inauguración date/hour
// — only exhibition run dates and, for MAVI specifically, guided-tour
// ("visita mediada") times that Haiku had mistakenly conflated with an
// opening night more than once. Real bug found: two MAVI-sourced events
// got the exact same fabricated openingDatetime, and a third had its
// visita-mediada time stored as if it were an inauguración — despite the
// prompt's own "SOLO si la fuente menciona..." instruction. MAVI's real
// listing (mavi.uc.cl/exposiciones-actuales/) is a JS-rendered Next.js
// app whose data API (api.agenda.uc.cl) returns 403 to a plain fetch, so
// it can't be registered as a bright source with the current fetch-only
// architecture (see docs/region-discovery.md's Event Discovery
// quality-improvements section for the headless-browser plan) — these
// events still get discovered incidentally via regular per-comuna search,
// same as any other event. Rather than rejecting them outright (the
// exhibition itself, and its run dates, are often real and legitimate),
// this only strips the fabricated/misattributed openingDatetime, so the
// event can still show as an "expo actual" with its real run dates.
export function nullifyOpeningDatetimeForKnownSources(candidates: EventCandidate[]): EventCandidate[] {
  return candidates.map((c) => {
    if (!c.openingDatetime || !c.sourceUrl) return c;
    let url: URL;
    try {
      url = new URL(c.sourceUrl);
    } catch {
      return c;
    }
    // uc.cl/www.uc.cl is a huge general university domain — only its
    // /agenda section is the PUC events system MAVI's detail pages live
    // on (see the comment above); mavi.uc.cl itself is unconditional.
    const isKnownDomain =
      url.hostname === "mavi.uc.cl" ||
      ((url.hostname === "uc.cl" || url.hostname === "www.uc.cl") && url.pathname.startsWith("/agenda"));
    if (!isKnownDomain) return c;
    return {
      ...c,
      openingDatetime: null,
      curationReasoning: `${c.curationReasoning} [FILTRO DE CÓDIGO: fuente conocida sin fechas de inauguración confiables (MAVI/UC agenda); openingDatetime forzado a null]`,
    };
  });
}

function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

// Verifies dateQuote/locationQuote (see buildSystemPrompt, EventCandidate's
// own doc comment) actually appear in the real text Haiku was given — a
// code-level guardrail, not a request for Haiku to police itself. Real bug
// found in production (2026-07-22): the existing "cite the exact phrase"
// prompt instruction alone didn't stop Haiku from fabricating whole events
// (specific dates/hours, venue names, even descriptions) with zero basis
// in the source text, while writing a confident-sounding curationReasoning
// — 4 of 6 manually-checked candidates in one run had this exact problem,
// plus 2 with a wrong-country location that had also passed a confident
// curationReasoning. Deliberately fails closed: a quote that's missing OR
// present-but-not-found (parsed as unverifiable either way — this version
// doesn't try to distinguish "fabricated" from "legitimate paraphrase")
// gets the same treatment. Measure real false-rejection rate before
// building a second, more lenient verification pass for the ambiguous
// case — see docs/region-discovery.md.
//
// location has no nullable fallback (every event needs one) — an
// ungrounded location rejects the whole candidate, same severity as
// enforceSourceUrlInvariant below. openingDatetime IS nullable — an
// ungrounded date only nulls that field, since the rest of the candidate
// (title, description, run dates) may still be perfectly real; this
// mirrors nullifyOpeningDatetimeForKnownSources's existing "strip the
// unreliable part, keep the rest" approach.
//
// Splits `block` into per-result sections keyed by URL, mirroring
// buildBlock's own format (`### title\nurl\ncontent...`, sections joined
// by a blank line) — so a candidate's quote is checked against ONLY the
// section for its own sourceUrl, not the whole block. Real gap found
// 2026-07-22, first production run after this filter shipped: checking
// against the whole block let Haiku cite REAL text from a DIFFERENT
// result in the same batch and misattribute it to an unrelated candidate
// — two confirmed cases ("Instalación País: Chile 2026", a plain photo
// post with no date, approved with a fabricated Cerrillos venue/date;
// "Expo Noah Bliazi", approved citing an inauguración quote that was
// real text from a different, unrelated Puente Alto post about
// workshops). Falls back to checking the whole block only when a
// candidate's sourceUrl doesn't match any section header exactly (e.g. an
// aggregator/listing URL, or a URL Haiku composed slightly differently)
// — degrading to the previous, coarser check rather than over-rejecting
// on a lookup miss.
function splitBlockByUrl(block: string): Map<string, string> {
  const sections = new Map<string, string>();
  for (const part of block.split(/\n\n(?=### )/)) {
    const url = part.split("\n")[1]?.trim();
    if (url) sections.set(url, part);
  }
  return sections;
}

export function enforceGroundedQuotes(candidates: EventCandidate[], block: string): EventCandidate[] {
  const sections = splitBlockByUrl(block);

  return candidates.map((c) => {
    if (c.status !== "approved") return c;

    const ownSection = c.sourceUrl ? sections.get(c.sourceUrl) : undefined;
    const searchSpace = normalizeForMatch(ownSection ?? block);
    const isGrounded = (quote: string | null) => !!quote && searchSpace.includes(normalizeForMatch(quote));

    if (!isGrounded(c.locationQuote)) {
      return {
        ...c,
        status: "rejected" as const,
        curationReasoning: `${c.curationReasoning} [FILTRO DE CÓDIGO: ubicación sin cita textual verificable en la fuente; rechazado]`,
      };
    }

    if (c.openingDatetime && !isGrounded(c.dateQuote)) {
      return {
        ...c,
        openingDatetime: null,
        openingTimeConfirmed: false,
        curationReasoning: `${c.curationReasoning} [FILTRO DE CÓDIGO: fecha de inauguración sin cita textual verificable; openingDatetime forzado a null]`,
      };
    }

    return c;
  });
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

// Enforce the sourceUrl invariant: approved events MUST have a sourceUrl
// (either a specific per-event URL or at minimum the block's URL). If Haiku
// violated this, force to rejected — a wrong link is worse than no link, but
// no link on an approved event is a prompt-following failure that shouldn't
// silently pass.
export function enforceSourceUrlInvariant(candidates: EventCandidate[]): EventCandidate[] {
  return candidates.map((c) =>
    c.status === "approved" && !c.sourceUrl
      ? {
          ...c,
          status: "rejected" as const,
          curationReasoning: `${c.curationReasoning} [FILTRO DE CÓDIGO: evento aprobado sin sourceUrl viola el invariante; rechazado]`,
        }
      : c,
  );
}

// Not a filter — approved-with-a-URL is exactly what
// enforceSourceUrlInvariant already guarantees. This only surfaces LOW
// -QUALITY links (a bare domain root, e.g. "https://culturacopiapo.cl",
// not a specific event page a visitor could actually read) for manual
// review — found via a user-requested audit (2026-07-20). Deliberately NOT
// a hard rejection: some small-comuna cultural centers genuinely only have
// a single-page site where the homepage IS the correct and only page, and
// a blanket path-based heuristic risks false-rejecting those exactly the
// way the isChileanLocation whitelist drift did for real comunas. Logged
// so it's visible in the workflow's own run logs for a human to spot-check
// periodically, same visibility mechanism page-fetch.ts's own recovery
// logs already use.
export function logBareDomainSourceUrls(candidates: EventCandidate[]): EventCandidate[] {
  for (const c of candidates) {
    if (c.status !== "approved" || !c.sourceUrl) continue;
    let url: URL;
    try {
      url = new URL(c.sourceUrl);
    } catch {
      continue;
    }
    if (url.pathname === "/" || url.pathname === "") {
      console.log(
        `[event-discovery] sourceUrl is a bare domain root, not a specific event page — review manually: "${c.title}" -> ${c.sourceUrl}`,
      );
    }
  }
  return candidates;
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
    candidates: logBareDomainSourceUrls(
      enforceSourceUrlInvariant(
        applyKnownExclusionsFilter(
          nullifyAggregatorSourceUrls(
            nullifyOpeningDatetimeForKnownSources(applyLocationFilter(enforceGroundedQuotes(parseCandidates(text), block))),
          ),
        ),
      ),
    ),
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
