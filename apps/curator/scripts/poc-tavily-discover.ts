// Throwaway proof-of-concept script: real Tavily + Haiku, event-only (no
// venues), to measure real content quality and token volume before any
// production architecture decision. Not wired into index.ts/crawl-events.ts.
// No Supabase reads/writes. Run with `pnpm --filter @caldearte/curator poc-tavily`
// (loads .env via Node's --env-file, no dotenv dependency needed).
import { readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { ART_SCOPE_POLICY, TEXT_CURATION_POLICY } from "../src/lib/curation-policy.js";
import { KNOWN_SOURCES, knownSourceDomain } from "../src/lib/known-sources.js";
import { runVisionCheck, defaultImageFetcher } from "../src/lib/vision-check.js";

const TEST_UNITS = ["Providencia", "Recoleta", "Villa Alemana"];

// Whitelist, not blocklist — a blocklist of foreign countries (what this
// used to be) misses anything not explicitly listed (e.g. a Peru event
// that only says "Lima", never "Perú"). Real events almost always name a
// checkable Chilean place (that's the point of publishing them — people
// need to know where to go), so requiring a recognizable Chilean region/
// city/"Chile" itself in the location text is the safer direction: it
// still passes genuinely freeform locations (a plaza, a street corner) as
// long as they're tied to a real Chilean place name, and only rejects
// candidates that never identify anywhere checkable in Chile at all.
const CHILE_MARKERS = [
  "chile", "region metropolitana",
  // 16 regions
  "arica y parinacota", "tarapaca", "antofagasta", "atacama", "coquimbo",
  "valparaiso", "libertador", "o'higgins", "ohiggins", "maule", "nuble",
  "biobio", "araucania", "los rios", "los lagos", "aysen", "magallanes",
  // major cities/comunas seen or likely in this rollout
  "arica", "iquique", "alto hospicio", "calama", "tocopilla", "copiapo",
  "vallenar", "chanaral", "la serena", "ovalle", "illapel", "san antonio",
  "los andes", "san felipe", "quillota", "la ligua", "santiago",
  "providencia", "las condes", "vitacura", "lo barnechea", "nunoa",
  "la reina", "macul", "penalolen", "la florida", "puente alto",
  "san bernardo", "maipu", "pudahuel", "cerrillos", "estacion central",
  "quinta normal", "lo prado", "renca", "quilicura", "huechuraba",
  "independencia", "recoleta", "conchali", "cerro navia", "el bosque",
  "la cisterna", "san miguel", "san joaquin", "pedro aguirre cerda",
  "la granja", "la pintana", "san ramon", "lo espejo", "melipilla",
  "talagante", "buin", "vina del mar", "concon", "quilpue",
  "villa alemana", "casablanca", "rancagua", "san fernando", "rengo",
  "pichilemu", "talca", "curico", "linares", "cauquenes", "constitucion",
  "chillan", "san carlos", "los angeles", "concepcion", "talcahuano",
  "hualpen", "chiguayante", "san pedro de la paz", "coronel", "lota",
  "penco", "tome", "hualqui", "santa juana", "temuco", "padre las casas",
  "angol", "villarrica", "pucon", "valdivia", "la union", "puerto montt",
  "osorno", "castro", "ancud", "puerto varas", "coyhaique",
  "puerto aysen", "punta arenas", "puerto natales",
];

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Real bug found: "Recoleta" is both a real Chilean comuna AND part of
// "Centro Cultural Recoleta, Buenos Aires, Argentina" — a pure whitelist
// check let 3 Argentine candidates through because the substring
// "recoleta" matched. Fix: an explicit foreign-country mention overrides
// the whitelist, checked first — belt and suspenders, not either/or.
const FOREIGN_COUNTRY_MARKERS = [
  "argentina", "buenos aires", "espana", "peru", "bolivia", "colombia",
  "mexico", "estados unidos", "ecuador", "uruguay", "brasil", "venezuela",
  "paraguay",
];

function isChileanLocation(location: string): boolean {
  const normalized = stripAccents(location.toLowerCase());
  if (FOREIGN_COUNTRY_MARKERS.some((marker) => normalized.includes(marker))) return false;
  return CHILE_MARKERS.some((marker) => normalized.includes(marker));
}

// Obvious junk to strip before ever showing an image candidate to Haiku —
// site chrome, not event content. Real per-image alt text/description
// (when Tavily's includeImageDescriptions provides one) is the actual
// signal; this filter just removes what's unambiguously not a photo of
// anything happening.
const JUNK_IMAGE_MARKERS = ["logo", "icon", "favicon", "footer", "nav-", "-nav", "sprite"];
const MAX_IMAGES_PER_RESULT = 4;
// Confirmed with real logged data: of 180 raw Tavily results, 25 had
// score < 0.15 and none of them ever became a candidate Haiku reported.
const MIN_SCORE = 0.15;

function isJunkImage(url: string): boolean {
  const lower = url.toLowerCase();
  if (lower.endsWith(".svg")) return true;
  return JUNK_IMAGE_MARKERS.some((marker) => lower.includes(marker));
}

// Real run showed most of the token bloat from includeImages comes from
// long CDN URLs (Instagram/Facebook especially) with no description —
// without alt text Haiku has nothing to judge by anyway, and in practice
// these were almost always profile pictures/generic site assets. Dropping
// them before ever building the prompt cuts tokens without losing the
// signal that actually let Haiku pick correctly.
function filterImageCandidates(
  images: Array<{ url: string; description?: string | null }>,
): ImageCandidate[] {
  return images
    .filter((img) => !isJunkImage(img.url) && img.description)
    .slice(0, MAX_IMAGES_PER_RESULT)
    .map((img) => ({ url: img.url, description: img.description ?? null }));
}

const ES_MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function currentMonthLabel(now: Date): string {
  return `${ES_MONTHS[now.getMonth()]} ${now.getFullYear()}`;
}

function firstOfMonthIso(now: Date): string {
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

function buildQueries(unit: string, monthLabel: string): string[] {
  return [
    `inauguracion arte ${unit} ${monthLabel}`,
    `exposicion arte ${unit} ${monthLabel}`,
    `intervencion artistica ${unit} ${monthLabel}`,
  ];
}

interface ImageCandidate {
  url: string;
  description: string | null;
}

interface RawResult {
  title: string;
  url: string;
  content: string;
  score: number;
  query: string;
  images: ImageCandidate[];
}

interface TavilyRestResult {
  url: string;
  title: string;
  content: string;
  score: number;
  images?: Array<{ url: string; description?: string | null }>;
}

interface TavilyRestResponse {
  results: TavilyRestResult[];
  usage?: { credits: number };
}

// Raw REST call, not the @tavily/core SDK — confirmed via a real
// side-by-side test that the SDK (v0.7.6) silently drops per-result
// `images` even with includeImages/includeImageDescriptions set, while
// the REST API itself returns them. Per-result images are the whole
// point here, so bypass the SDK rather than lose that data.
async function tavilySearch(apiKey: string, query: string, opts: {
  startDate: string;
  excludeDomains: string[];
}): Promise<TavilyRestResponse> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      query,
      search_depth: "advanced",
      max_results: 20,
      start_date: opts.startDate,
      chunks_per_source: 1,
      country: "chile",
      exclude_domains: opts.excludeDomains,
      include_images: true,
      include_image_descriptions: true,
    }),
  });
  if (!res.ok) {
    throw new Error(`Tavily search failed for "${query}": ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<TavilyRestResponse>;
}

async function searchUnit(
  apiKey: string,
  unit: string,
  now: Date,
  excludeDomains: string[],
): Promise<{ results: RawResult[]; credits: number; rawLog: RawResult[] }> {
  const queries = buildQueries(unit, currentMonthLabel(now));
  const startDate = firstOfMonthIso(now);
  const rawLog: RawResult[] = [];
  let credits = 0;

  for (const query of queries) {
    const response = await tavilySearch(apiKey, query, { startDate, excludeDomains });
    credits += response.usage?.credits ?? 2;
    let keptCount = 0;
    for (const r of response.results) {
      // Real data check (poc-raw-results.json, run before this fix): of
      // 180 raw results, 25 had score < 0.15 and NONE of them ever became
      // a candidate Haiku reported — it was already ignoring this content
      // on its own. Dropping it before the prompt saves tokens with no
      // observed loss of real events.
      if (r.score < MIN_SCORE) continue;
      keptCount++;
      const images = filterImageCandidates(r.images ?? []);
      rawLog.push({ title: r.title, url: r.url, content: r.content, score: r.score, query, images });
    }
    console.log(`  [tavily] "${query}" -> ${response.results.length} results (${keptCount} kept, score >= ${MIN_SCORE})`);
  }

  // Dedup by URL across the 3 queries — same result frequently surfaces
  // under more than one query template, pure waste to send it to Haiku
  // twice with zero information gain.
  const seen = new Set<string>();
  const deduped: RawResult[] = [];
  for (const r of rawLog) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    deduped.push(r);
  }
  if (deduped.length < rawLog.length) {
    console.log(`  [dedup] ${rawLog.length} raw -> ${deduped.length} unique URLs`);
  }

  return { results: deduped, credits, rawLog };
}

// Real run showed the known-source page (artes.uchile.cl agenda) DOES
// have a real thumbnail next to every listed exhibition — the crude tag
// strip below was throwing all of them away before, not a real gap in
// the source. Pull <img src/alt> pairs out first, same idea as
// event-crawler/extract-images.ts, before stripping the rest of the HTML.
function extractImgTags(html: string): Array<{ url: string; description: string | null }> {
  const images: Array<{ url: string; description: string | null }> = [];
  const imgTagRegex = /<img\b[^>]*>/gi;
  const srcRegex = /\bsrc=["']([^"']+)["']/i;
  const altRegex = /\balt=["']([^"']*)["']/i;

  for (const match of html.matchAll(imgTagRegex)) {
    const tag = match[0];
    const src = tag.match(srcRegex)?.[1];
    if (!src) continue;
    const alt = tag.match(altRegex)?.[1] ?? null;
    images.push({ url: src, description: alt && alt.trim().length > 0 ? alt.trim() : null });
  }

  return images;
}

// Known-source pages are aggregators — one page legitimately lists many
// distinct events, each with its own small thumbnail (confirmed: the
// artes.uchile.cl agenda has 19 real per-exhibition thumbnails, filenames
// like "exposicion-hallazgo-prev.jpg" matching the exhibition titles
// almost 1:1). The per-result cap/description-required filter above is
// tuned for noisy multi-image social/CDN results — wrong fit here, where
// images are cheap (short relative paths) and plentiful on purpose. Only
// drop obvious site chrome (logo/icon/svg), keep everything else, and
// resolve relative URLs against the page's own origin.
function filterKnownSourceImages(
  images: Array<{ url: string; description: string | null }>,
  pageUrl: string,
): ImageCandidate[] {
  const seen = new Set<string>();
  const out: ImageCandidate[] = [];
  for (const img of images) {
    const trimmedUrl = img.url.trim();
    if (isJunkImage(trimmedUrl)) continue;
    const absoluteUrl = new URL(trimmedUrl, pageUrl).href;
    if (seen.has(absoluteUrl)) continue;
    seen.add(absoluteUrl);
    out.push({ url: absoluteUrl, description: img.description === "vacio" ? null : img.description });
  }
  return out;
}

interface WpEventsListItem {
  title: { rendered: string };
  meta: {
    link_al_evento?: string;
    imagen_evento?: string;
    extracto_corto?: string;
    fecha_de_inicio?: string; // YYYYMMDD
    fecha_de_termino?: string; // YYYYMMDD
  };
}

function formatWpDate(yyyymmdd: string | undefined): string {
  if (!yyyymmdd || yyyymmdd.length !== 8) return "?";
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

// A WordPress REST API response is already structured — no HTML parsing,
// no guessing which image belongs to which event (the API pairs them
// directly). Real find: hora_de_inicio/hora_de_termino on this site are
// the venue's daily opening hours, NOT the inauguración time — the real
// one, when there is one, is embedded in extracto_corto's free text, so
// Haiku still needs to read that rather than trust the structured hour
// fields blindly.
async function fetchJsonApiSource(source: { url: string; note: string }): Promise<RawResult> {
  const res = await fetch(source.url);
  const items: WpEventsListItem[] = await res.json();

  const images: ImageCandidate[] = items
    .filter((item) => item.meta.imagen_evento)
    .map((item) => ({
      url: item.meta.imagen_evento as string,
      description: `Imagen de la exposición: ${item.title.rendered}`,
    }));

  const content = items
    .map((item) => {
      const start = formatWpDate(item.meta.fecha_de_inicio);
      const end = formatWpDate(item.meta.fecha_de_termino);
      return `- "${item.title.rendered}" (${start} a ${end}): ${item.meta.extracto_corto ?? "sin descripción"}. Más info: ${item.meta.link_al_evento ?? source.url}`;
    })
    .join("\n");

  return { title: source.note, url: source.url, content, score: 1, query: "(fuente brillante)", images };
}

async function fetchKnownSources(sources: Array<{ url: string; note: string; type?: "html" | "json-api" }>): Promise<RawResult[]> {
  const out: RawResult[] = [];
  for (const source of sources) {
    try {
      if (source.type === "json-api") {
        out.push(await fetchJsonApiSource(source));
        continue;
      }
      const res = await fetch(source.url);
      const html = await res.text();
      const images = filterKnownSourceImages(extractImgTags(html), source.url);
      // Rough tag strip — good enough for a PoC to see if the content is
      // rich, not meant to be a real HTML-to-text pipeline.
      const text = html.replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 4000);
      out.push({ title: source.note, url: source.url, content: text, score: 1, query: "(fuente brillante)", images });
    } catch (err) {
      console.error(`  [known-source] failed to fetch ${source.url}: ${(err as Error).message}`);
    }
  }
  return out;
}

function formatImages(images: ImageCandidate[]): string {
  if (images.length === 0) return "";
  const lines = images
    .map((img) => `  - ${img.url}${img.description ? ` (descripción: ${img.description})` : ""}`)
    .join("\n");
  return `\nImágenes candidatas de esta fuente:\n${lines}`;
}

function buildBlock(unit: string, results: RawResult[]): string {
  const searchSection = results
    .map((r) => `### ${r.title}\n${r.url}\n${r.content}${formatImages(r.images)}`)
    .join("\n\n");

  return `## Resultados de búsqueda para "${unit}"\n\n${searchSection}`;
}

// Curated once per run, separately from any single comuna's search — a
// "fuente brillante" isn't scoped to one unit, and real runs showed Haiku
// inconsistently deciding whether to surface it when attached to each
// unit's own prompt (sometimes all of it, sometimes none). Running it
// through its own curation pass makes its yield deterministic instead of
// depending on which unit's call happened to report it this time.
function buildKnownSourceBlock(knownSourceResults: RawResult[]): string {
  return knownSourceResults
    .map((r) => `### ${r.title}\n${r.url}\n${r.content}${formatImages(r.images)}`)
    .join("\n\n");
}

function buildSystemPrompt(monthLabel: string): string {
  return `Eres un curador de Caldearte, un calendario de arte. A continuación recibirás resultados de búsqueda reales sobre exposiciones e intervenciones artísticas en distintas comunas/ciudades de Chile.

Para cada evento real que encuentres, extrae:
- título, descripción, artista (si se nombra)
- \`runStartDate\`: día en que comienza la exhibición/muestra (solo fecha, sin hora), si se menciona
- \`runEndDate\`: día en que termina, si se menciona (null si no se sabe)
- \`openingDatetime\`: fecha Y hora exacta de la inauguración, SOLO si la fuente menciona una apertura/inauguración específica con hora — null si no hay una inauguración confirmada (una muestra puede no tener inauguración pública)
- \`imageUrl\`: elige, de las "imágenes candidatas" listadas bajo cada fuente, la que realmente muestre una obra, flyer o foto del evento — NO un logo, ícono, foto de perfil, o imagen decorativa del sitio. Usa la descripción de cada imagen (cuando exista) para decidir: una descripción como "profile picture" NUNCA es correcta; una descripción que menciona un cartel, afiche, o texto del evento SÍ suele serlo. Si ninguna imagen candidata parece ser realmente del evento, usa null — no inventes ni elijas al azar.
- \`sourceUrl\`: la URL de la fuente donde se puede ver más información del evento

${ART_SCOPE_POLICY}

Excluye también, explícitamente:
- Convocatorias (llamados a postular obras a una futura exposición) — no son un evento que esté ocurriendo, son una invitación a futuro.
- Talleres (actividades de aprendizaje/participación, no una muestra o intervención artística).

${TEXT_CURATION_POLICY}

Importante sobre ubicación: no descartes un candidato solo porque la ubicación real mencionada en el contenido es distinta a la comuna/ciudad que buscamos — reporta la ubicación real tal como aparece en la fuente (ej. "Las Condes, Santiago" aunque la búsqueda haya sido por otra comuna). Descarta cuando la fuente sea de otro país (no de Chile) — esto es una regla dura, no una sugerencia: cualquier evento fuera de Chile debe ir "rejected".

Importante sobre fechas: la búsqueda no filtra perfectamente por fecha aunque se le haya pedido un mes específico. La regla es a nivel de MES, no de día exacto: descarta un candidato solo si su \`runEndDate\` (o, si no hay \`runEndDate\`, su \`runStartDate\`) corresponde a un mes ANTERIOR a ${monthLabel}, sin indicación de que siga vigente. No lo descartes solo porque su fecha específica dentro de ${monthLabel} ya pasó respecto al día de hoy, ni porque su apertura caiga en un mes posterior (un evento futuro encontrado de casualidad sigue siendo válido).

Etiqueta también: \`mediumType\` ("tradicional" o "intervencion_no_tradicional") y \`sensitivityTags\` (array de ["desnudo_erotismo", "guerra_violencia", "memoria_dictadura"], vacío si no aplica). Escribe un \`curationReasoning\` breve explicando tu decisión.

\`status\` es binario: "approved" o "rejected" — no hay estado intermedio.

Responde SOLO con un bloque de código \`\`\`json que contenga un array de objetos con esta forma exacta, nada más antes o después:
[{ "title": string, "description": string | null, "artist": string | null, "runStartDate": string | null, "runEndDate": string | null, "openingDatetime": string | null, "mediumType": "tradicional" | "intervencion_no_tradicional", "sensitivityTags": string[], "curationReasoning": string, "imageUrl": string | null, "status": "approved" | "rejected", "location": string, "sourceUrl": string | null }]

Si no encuentras nada en scope, responde con un array vacío: \`\`\`json
[]
\`\`\``;
}

interface Candidate {
  title: string;
  description: string | null;
  artist: string | null;
  runStartDate: string | null;
  runEndDate: string | null;
  openingDatetime: string | null;
  mediumType: "tradicional" | "intervencion_no_tradicional";
  sensitivityTags: string[];
  curationReasoning: string;
  imageUrl: string | null;
  status: "approved" | "rejected";
  location: string;
  sourceUrl: string | null;
}

function parseCandidates(text: string): Candidate[] {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (!match) {
    console.error(`  [debug] response length=${text.length}, tail: ${text.slice(-500)}`);
    throw new Error("no fenced JSON block found in Haiku's response (likely truncated by max_tokens)");
  }
  return JSON.parse(match[1]) as Candidate[];
}

// Deterministic backstop — the prompt already asks Haiku to reject
// non-Chile events, and we saw it fail to do so once (Recoleta/Buenos
// Aires). Whitelist, not blocklist (see CHILE_MARKERS above): reject
// unless the location text actually names somewhere checkable in Chile.
function applyLocationFilter(candidates: Candidate[]): Candidate[] {
  return candidates.map((c) =>
    c.status === "approved" && !isChileanLocation(c.location)
      ? { ...c, status: "rejected" as const, curationReasoning: `${c.curationReasoning} [FILTRO DE CÓDIGO: ubicación no reconocida como chilena, forzado a rejected]` }
      : c,
  );
}

function normalizeTitle(title: string): string {
  return stripAccents(title.toLowerCase())
    .replace(/["'«»“”]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Real run showed the exact same event reported twice with slightly
// different title punctuation ("Ejercicios de enlaces" vs "Exposición
// 'Ejercicios de enlaces'") — Haiku's own consolidation doesn't catch
// this reliably. This runs across ALL curate() calls combined (each unit
// plus the separate fuentes-brillantes pass), not just within one — the
// same museum show can legitimately surface via more than one call.
function dedupeAcrossSummary(summary: Array<{ candidates: Candidate[] }>): void {
  const seen = new Set<string>();
  for (const entry of summary) {
    for (const c of entry.candidates) {
      if (c.status !== "approved") continue;
      const key = normalizeTitle(c.title);
      if (seen.has(key)) {
        c.status = "rejected";
        c.curationReasoning += " [FILTRO DE CÓDIGO: título duplicado ya visto en otra unidad/fuente, descartado]";
      } else {
        seen.add(key);
      }
    }
  }
}

// Auto-promoted, not just flagged — simple rule: a domain (never a
// social platform, since those are shared by thousands of unrelated
// accounts) that contributed 2+ COMPLETE events this run (image, title,
// and a start date within the current month) is assumed a bright source
// by default. KNOWN_SOURCES (lib/known-sources.ts) stays the hand-seeded
// list; detected ones persist separately in detected-sources.json and
// get merged in at the start of every run — no source code gets
// rewritten by the script.
//
// `description` is deliberately NOT required — a real test against
// arteinformado.com (a genuinely rich aggregator, 10 real Chilean
// exhibitions, 2 within the current month, all with real images) showed
// Haiku correctly leaves `description` null when a source only lists
// structured facts (title/date/venue) with no prose per event. Requiring
// it would have disqualified a legitimately good source.
const SOCIAL_DOMAINS = ["instagram.com", "facebook.com", "tiktok.com", "twitter.com", "x.com"];
const CANDIDATE_SOURCE_THRESHOLD = 2;

function isCompleteEvent(c: Candidate, now: Date): boolean {
  if (!c.imageUrl || !c.title) return false;
  const dateToCheck = c.runStartDate ?? c.openingDatetime;
  if (!dateToCheck) return false;
  const d = new Date(dateToCheck);
  if (Number.isNaN(d.getTime())) return false;
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

interface DetectedSource {
  url: string;
  note: string;
  lastReviewedAt: string;
}

function detectNewBrightSources(
  summary: Array<{ candidates: Candidate[] }>,
  now: Date,
  existingDomains: string[],
): DetectedSource[] {
  const byDomain = new Map<string, Set<string>>();

  for (const entry of summary) {
    for (const c of entry.candidates) {
      if (c.status !== "approved" || !c.sourceUrl || !isCompleteEvent(c, now)) continue;
      let domain: string;
      try {
        domain = new URL(c.sourceUrl).hostname.replace(/^www\./, "");
      } catch {
        continue;
      }
      if (SOCIAL_DOMAINS.some((s) => domain.includes(s))) continue;
      if (existingDomains.includes(domain)) continue;
      if (!byDomain.has(domain)) byDomain.set(domain, new Set());
      byDomain.get(domain)!.add(c.sourceUrl);
    }
  }

  return [...byDomain.entries()]
    .filter(([, urls]) => urls.size >= CANDIDATE_SOURCE_THRESHOLD)
    .map(([domain, urls]) => ({
      url: [...urls][0],
      note: `Auto-detectado: ${urls.size} eventos completos (imagen+título+descripción+fecha del mes) en ${domain} el ${now.toISOString().slice(0, 10)}.`,
      lastReviewedAt: now.toISOString().slice(0, 10),
    }))
    .sort((a, b) => a.url.localeCompare(b.url));
}

async function curate(
  anthropic: Anthropic,
  systemPrompt: string,
  block: string,
): Promise<{
  candidates: Candidate[];
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}> {
  // Same system prompt on every call within a run (and across monthly
  // runs, aside from the month label baked into the date instruction) —
  // cache_control lets every call after the first pay ~10% of the input
  // cost for these tokens instead of 100%, within the 5-minute TTL.
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 16000,
    system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: block }],
  });

  const text = response.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");

  return {
    candidates: applyLocationFilter(parseCandidates(text)),
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
  };
}

function toMarkdown(summary: Array<{ unit: string; candidates: Candidate[] }>, visionNote: string | null): string {
  const lines: string[] = ["# Caldearte — eventos encontrados (PoC Tavily + Haiku)", ""];

  if (visionNote) {
    lines.push(`> ${visionNote}`, "");
  }

  for (const s of summary) {
    lines.push(`## ${s.unit}`, "");
    const approved = s.candidates.filter((c) => c.status === "approved");
    if (approved.length === 0) {
      lines.push("_Sin eventos aprobados._", "");
      continue;
    }
    for (const c of approved) {
      lines.push(`### ${c.title}`);
      if (c.imageUrl) {
        lines.push(`![${c.title}](${c.imageUrl})`);
      } else {
        lines.push("_(sin imagen)_");
      }
      lines.push("");
      lines.push(`- **Ubicación**: ${c.location}`);
      lines.push(`- **Duración**: ${c.runStartDate ?? "?"} → ${c.runEndDate ?? "?"}`);
      lines.push(`- **Inauguración**: ${c.openingDatetime ?? "sin apertura confirmada"}`);
      if (c.artist) lines.push(`- **Artista**: ${c.artist}`);
      if (c.description) lines.push(`- **Descripción**: ${c.description}`);
      lines.push(`- **Más información**: ${c.sourceUrl ?? "?"}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

const DETECTED_SOURCES_PATH = new URL("../detected-sources.json", import.meta.url).pathname;

function loadDetectedSources(): DetectedSource[] {
  try {
    return JSON.parse(readFileSync(DETECTED_SOURCES_PATH, "utf-8")) as DetectedSource[];
  } catch {
    return [];
  }
}

async function main() {
  const tavilyApiKey = process.env.TAVILY_API_KEY;
  if (!tavilyApiKey) throw new Error("TAVILY_API_KEY not set");

  const anthropic = new Anthropic();
  const now = new Date();
  const monthLabel = currentMonthLabel(now);
  const systemPrompt = buildSystemPrompt(monthLabel);

  // Dedup by domain when merging — guards against a domain being both
  // hand-added to KNOWN_SOURCES and previously auto-detected into
  // detected-sources.json, which would otherwise fetch it twice.
  // KNOWN_SOURCES wins on conflict since it's the curated, reviewed list.
  const detectedSourcesBefore = loadDetectedSources();
  const seenSourceDomains = new Set<string>();
  const allSources: typeof KNOWN_SOURCES = [];
  for (const source of [...KNOWN_SOURCES, ...detectedSourcesBefore]) {
    const domain = knownSourceDomain(source.url);
    if (seenSourceDomains.has(domain)) continue;
    seenSourceDomains.add(domain);
    allSources.push(source);
  }
  const excludeDomains = allSources.map((s) => knownSourceDomain(s.url));

  console.log(`Fetching known sources (${KNOWN_SOURCES.length} manuales + ${detectedSourcesBefore.length} auto-detectadas)...`);
  const knownSourceResults = await fetchKnownSources(allSources);

  const summary: Array<{
    unit: string;
    credits: number;
    candidates: Candidate[];
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  }> = [];
  const rawLogAll: Record<string, RawResult[]> = {};

  for (const unit of TEST_UNITS) {
    console.log(`\n=== ${unit} ===`);
    const { results, credits, rawLog } = await searchUnit(tavilyApiKey, unit, now, excludeDomains);
    rawLogAll[unit] = rawLog;
    const block = buildBlock(unit, results);
    const { candidates, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens } =
      await curate(anthropic, systemPrompt, block);

    console.log(`  candidates: ${candidates.length}`);
    for (const c of candidates) {
      console.log(`  - [${c.status}] "${c.title}" — ${c.location} — imagen:${c.imageUrl ?? "ninguna"}`);
      console.log(`    reasoning: ${c.curationReasoning}`);
    }
    console.log(`  tokens: input=${inputTokens} output=${outputTokens} cache_write=${cacheCreationInputTokens} cache_read=${cacheReadInputTokens}`);
    console.log(`  tavily credits: ${credits}`);

    summary.push({ unit, credits, candidates, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens });
  }

  if (knownSourceResults.length > 0) {
    console.log(`\n=== Fuentes brillantes (curación separada, una sola vez) ===`);
    const knownBlock = buildKnownSourceBlock(knownSourceResults);
    const { candidates, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens } =
      await curate(anthropic, systemPrompt, knownBlock);

    console.log(`  candidates: ${candidates.length}`);
    for (const c of candidates) {
      console.log(`  - [${c.status}] "${c.title}" — ${c.location} — imagen:${c.imageUrl ?? "ninguna"}`);
      console.log(`    reasoning: ${c.curationReasoning}`);
    }
    console.log(`  tokens: input=${inputTokens} output=${outputTokens} cache_write=${cacheCreationInputTokens} cache_read=${cacheReadInputTokens}`);

    summary.push({ unit: "Fuentes brillantes", credits: 0, candidates, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens });
  }

  dedupeAcrossSummary(summary);

  const newlyDetected = detectNewBrightSources(summary, now, excludeDomains);
  if (newlyDetected.length > 0) {
    console.log(`\n=== Fuentes brillantes nuevas, auto-agregadas (>= ${CANDIDATE_SOURCE_THRESHOLD} eventos completos, no red social) ===`);
    for (const s of newlyDetected) console.log(`  ${s.url} — ${s.note}`);
    const merged = [...detectedSourcesBefore, ...newlyDetected];
    writeFileSync(DETECTED_SOURCES_PATH, JSON.stringify(merged, null, 2));
    console.log(`Guardado en ${DETECTED_SOURCES_PATH} (se usará en la próxima corrida)`);
  } else {
    console.log(`\nNinguna fuente nueva auto-agregada esta corrida (umbral: >= ${CANDIDATE_SOURCE_THRESHOLD} eventos completos de un mismo dominio, sin contar redes sociales).`);
  }

  console.log("\n=== Resumen ===");
  for (const s of summary) {
    const approved = s.candidates.filter((c) => c.status === "approved").length;
    const withImage = s.candidates.filter((c) => c.status === "approved" && c.imageUrl).length;
    console.log(
      `${s.unit}: ${approved}/${s.candidates.length} aprobados (${withImage} con imagen), ${s.credits} créditos Tavily, ` +
        `${s.inputTokens} input (cache_write=${s.cacheCreationInputTokens} cache_read=${s.cacheReadInputTokens}), ${s.outputTokens} output tokens`,
    );
  }
  const totalCacheRead = summary.reduce((sum, s) => sum + s.cacheReadInputTokens, 0);
  const totalCacheWrite = summary.reduce((sum, s) => sum + s.cacheCreationInputTokens, 0);
  console.log(`\nCache totals: ${totalCacheWrite} tokens written, ${totalCacheRead} tokens read at ~10% cost.`);

  // Single real vision check — one image only, to confirm it's really art
  // (not a false positive) and to measure the real cost of Axis 5 before
  // deciding whether to apply it to every event. Falls back to the next
  // candidate if a fetch fails — real run showed Instagram's CDN can
  // reject a direct server-side fetch with 403 (hotlink protection), a
  // real limitation worth knowing about, not a reason to abandon the test.
  let visionNote: string | null = null;
  const candidatesWithImages = summary
    .flatMap((s) => s.candidates)
    .filter((c) => c.status === "approved" && c.imageUrl);

  let visionDone = false;
  for (const candidate of candidatesWithImages) {
    console.log(`\nRunning single real vision check on: "${candidate.title}" (${candidate.imageUrl})`);
    try {
      const { status, usage } = await runVisionCheck(anthropic, defaultImageFetcher, candidate.imageUrl as string);
      const cost = (usage.inputTokens / 1_000_000) * 1 + (usage.outputTokens / 1_000_000) * 5;
      console.log(`  vision status: ${status}, input=${usage.inputTokens} output=${usage.outputTokens} tokens, ~$${cost.toFixed(5)}`);
      visionNote = `Chequeo de visión real sobre "${candidate.title}": ${status} — ${usage.inputTokens} input / ${usage.outputTokens} output tokens (~$${cost.toFixed(5)} por imagen).`;
      visionDone = true;
      break;
    } catch (err) {
      console.error(`  vision check failed for "${candidate.title}": ${(err as Error).message} — trying next candidate`);
    }
  }

  if (!visionDone) {
    visionNote = candidatesWithImages.length > 0
      ? "Todos los intentos de chequeo de visión fallaron (posible bloqueo de hotlinking en las URLs de imagen disponibles)."
      : "Ningún evento aprobado tuvo imagen esta corrida — no se pudo probar el chequeo de visión.";
  }

  const rawLogPath = new URL("../poc-raw-results.json", import.meta.url).pathname;
  writeFileSync(rawLogPath, JSON.stringify(rawLogAll, null, 2));
  console.log(`\nRaw Tavily results (with score/images) written to ${rawLogPath}`);

  const candidatesPath = new URL("../poc-candidates.json", import.meta.url).pathname;
  const candidatesByUnit = Object.fromEntries(summary.map((s) => [s.unit, s.candidates]));
  writeFileSync(candidatesPath, JSON.stringify(candidatesByUnit, null, 2));
  console.log(`Final candidates written to ${candidatesPath}`);

  const mdPath = new URL("../poc-eventos.md", import.meta.url).pathname;
  writeFileSync(mdPath, toMarkdown(summary, visionNote));
  console.log(`Markdown event list written to ${mdPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
