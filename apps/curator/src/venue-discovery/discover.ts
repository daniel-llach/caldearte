import type { Tables } from "@caldearte/shared-types";
import { ART_SCOPE_POLICY, TEXT_CURATION_POLICY, ESCALATION_SIGNALS, VENUE_FILTER_POLICY } from "../lib/curation-policy.js";
import { runVisionCheck, defaultImageFetcher, type ImageFetcher } from "../lib/vision-check.js";

type Region = Tables<"regions">;

// The primary output of this pass is curated EVENTS, not venues — a venue
// is matched or created as a byproduct only when one is identifiable.
// Three real production runs of the venue-first design produced venues but
// zero events; this merges what curation-policy already proves works in
// event-crawler/curate.ts directly into the search pass, so a street
// intervention, a school show, or someone's home is exactly as capturable
// as a museum, instead of waiting on a venue to be resolved first.
export interface EventDiscoveryCandidate {
  title: string;
  description: string | null;
  artist: string | null;
  openingDatetime: string | null;
  openingDateConfidence: "alta" | "baja";
  mediumType: "tradicional" | "intervencion_no_tradicional";
  sensitivityTags: string[];
  curationReasoning: string;
  imageUrl: string | null;
  status: "approved" | "rejected" | "pending_review";

  // Venue is optional: null venueName means no fixed institution (a street
  // corner, someone's home, a plaza, a school) — freeformLocation carries
  // the description instead.
  venueName: string | null;
  venueAddress: string | null;
  venueWebsiteOrSocial: string | null;
  venueCategory: "art_space" | "hard_excluded" | "needs_review" | null;
  freeformLocation: string | null;

  // The specific page this candidate was found at, and whether that's the
  // venue's own site ("oficial") or a third-party mention ("difusion") —
  // only "oficial" sources are trustworthy enough to derive a venue's
  // listing_url from (see venue-discovery/run.ts).
  sourceUrl: string | null;
  sourceType: "oficial" | "difusion" | null;
  contactEmail: string | null;
}

interface ProvisionalEventCandidate extends Omit<EventDiscoveryCandidate, "status"> {
  provisionalStatus: "rejected" | "provisionally_approved" | "pending_review";
}

export interface DiscoverUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  webSearchRequests?: number;
}

export interface DiscoverResult {
  candidates: EventDiscoveryCandidate[];
  usage: DiscoverUsage[];
}

interface MessagesResponseContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: { query?: string };
}

// Narrow structural interface instead of the full Anthropic SDK class, so
// tests can inject a stub without hitting the real API. Also satisfies
// lib/vision-check.ts's narrower VisionMessagesClient shape.
export interface MessagesClient {
  messages: {
    create(params: Record<string, unknown>): Promise<{
      content: MessagesResponseContentBlock[];
      usage: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens?: number | null;
        cache_read_input_tokens?: number | null;
        server_tool_use?: { web_search_requests?: number } | null;
      };
    }>;
  };
}

// Caps worst-case cost per call — a backstop, not the primary lever. The
// search-economy prompt instructions below are what's meant to keep actual
// usage well under this in normal operation.
const MAX_WEB_SEARCH_USES = 8;

const ES_MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const EN_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Current month + next month, as literal names — not the words "this
// month"/"este mes". web_search doesn't do date arithmetic on query text
// (that's backend-dependent and unreliable); a literal month name matches
// what real pages actually say, and lets Claude's own reasoning (grounded
// by the explicit "today's date" in the system prompt below) judge
// relevance from there.
function monthWindowLabel(now: Date, language: string): string {
  const names = language === "es" ? ES_MONTHS : EN_MONTHS;
  const year1 = now.getFullYear();
  const month1 = now.getMonth();
  const nextDate = new Date(year1, month1 + 1, 1);
  const year2 = nextDate.getFullYear();
  const month2 = nextDate.getMonth();

  return year1 === year2
    ? `${names[month1]} ${names[month2]} ${year1}`
    : `${names[month1]} ${year1} ${names[month2]} ${year2}`;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
}

const QUERY_TEMPLATES: Record<string, (city: string, monthLabel: string) => string[]> = {
  es: (city, monthLabel) => [
    `exhibiciones de arte ${city} ${monthLabel}`,
    `muestras artísticas ${city} ${monthLabel}`,
    `intervención artística ${city} ${monthLabel}`,
  ],
  en: (city, monthLabel) => [
    `art exhibitions ${city} ${monthLabel}`,
    `art shows ${city} ${monthLabel}`,
    `artistic intervention ${city} ${monthLabel}`,
  ],
};

function buildQueries(region: Region, now: Date): string[] {
  const language = region.language === "es" ? "es" : "en";
  const templates = QUERY_TEMPLATES[language];
  return templates(region.name, monthWindowLabel(now, language));
}

const SEARCH_ECONOMY_POLICY = `Be economical with searches: aim for the 3 initial broad queries plus at most 1-3 targeted follow-ups total for the whole region — not one follow-up per candidate. Rely on the information already present in your initial broad search results whenever possible; classify source type (see below) using those same results, not a dedicated search for it. Only perform an additional, targeted search when the initial results didn't already give you enough to confirm a candidate is real, active, and in scope, or to extract its address/contact details. If you're still unsure about a candidate after a reasonable effort, classify it "pending_review" rather than spending more searches to resolve it. Never issue the same or a near-duplicate query more than once — if you already ran a search, reuse its results instead of repeating it.`;

const SOURCE_CLASSIFICATION_POLICY = `For each candidate, classify where sourceUrl was found: "oficial" (the venue's own website or social media account) or "difusion" (a news site, cultural agenda aggregator, or municipal events listing that isn't the venue's own site). If the same exhibition/intervention turns up via both an official source and a diffusion source in your search results, report it once — consolidate into a single candidate, using the official source for sourceUrl and sourceType. If it only appears via a diffusion source, still report it (don't omit real candidates just because there's no official site) — set sourceType to "difusion" and don't invent an official URL that wasn't actually found. Classify using the search results you already have; this is a judgment call about content already in front of you, not a reason for an extra search.`;

const VENUE_OPTIONAL_POLICY = `A fixed venue is optional, not required. Many real exhibitions and interventions have no institution behind them at all: a street corner, a plaza, someone's home, a school, an empty lot. When you can identify a hosting institution, set venueName to its own name (never the exhibition's title) and fill in venueAddress/venueWebsiteOrSocial/venueCategory. When there is no institution — or you genuinely can't tell what it is — set venueName to null and instead describe the location in freeformLocation (e.g. "Plaza de Armas, Antofagasta" or "intervención callejera en el centro de Arica"). Never invent a venue to fill the field; a real event with no venue is exactly as valuable as one at a recognized museum — don't under-report informal or street events relative to institutional ones.`;

export function buildSystemPrompt(
  region: Region,
  queries: string[],
  now: Date,
  existingVenueNames: string[] = [],
): string {
  const knownVenuesSection =
    existingVenueNames.length > 0
      ? `\n\nVenues already known for this region (no need to re-verify these are legitimate — but if your search surfaces a specific exhibition/intervention page belonging to one of them, still report it with its sourceUrl, since that's exactly how we locate where they list current exhibitions):\n${existingVenueNames.map((n) => `- ${n}`).join("\n")}\n`
      : "";

  const todayIso = isoDate(now);
  const cutoffIso = isoDate(addMonths(now, 2));

  return `You are researching current art exhibitions and artistic interventions in the city/metro "${region.name}, ${region.country}" as part of Caldearte, a curated calendar of art opening nights.

Use the web_search tool to research using queries like:
${queries.map((q) => `- "${q}"`).join("\n")}

For each exhibition or intervention you find, extract: title, description, artist (if named), opening date/time, and whether the date confidence is "alta" or "baja". Use "alta" only when an explicit opening date/time is given. When the source only gives the exhibition's overall run (e.g. "Nov 12 - Dec 27"), not a specific opening night, use "baja" and set the date to the run's **start date** as a proxy — and say so explicitly in curationReasoning, so this is never presented as a confirmed opening.

${VENUE_OPTIONAL_POLICY}

"venueName" must be the institution itself (the gallery, museum, or cultural center — e.g. "Museo Nacional de Bellas Artes"), never the exhibition or intervention's own title (not "Valentina Cruz. De amor, humor y muerte"). If you find more than one exhibition at the same institution, still report each one as its own candidate (they're different events) — just reuse the same venueName/venueWebsiteOrSocial for both, don't invent variations.

Today's date is ${todayIso}. Only report candidates whose exhibition/intervention falls between today and ${cutoffIso} (roughly the next 2 months) — discard anything that has already ended and anything further out (dates that far ahead are typically unconfirmed).

${SEARCH_ECONOMY_POLICY}
${knownVenuesSection}
When a venue is identified, classify it: ${VENUE_FILTER_POLICY}

${SOURCE_CLASSIFICATION_POLICY}

${ART_SCOPE_POLICY}

${TEXT_CURATION_POLICY}

${ESCALATION_SIGNALS}

Also tag each event: \`mediumType\` is "tradicional" (gallery/museum-style exhibition) or "intervencion_no_tradicional" (street art, public intervention, non-traditional space); \`sensitivityTags\` is an array from ["desnudo_erotismo", "guerra_violencia", "memoria_dictadura"] (empty array if none apply). Write a short \`curationReasoning\` explaining your axis decision.

If a genuine image for the event (the artwork/flyer itself, not a logo or unrelated photo) surfaced directly in your search results, set \`imageUrl\` to that exact URL — search results won't always include one, and that's fine, set it to null when they don't.

Respond with ONLY a fenced JSON code block (\`\`\`json ... \`\`\`) containing an array of objects with this exact shape, and nothing else before or after it:
[{ "title": string, "description": string | null, "artist": string | null, "openingDatetime": string | null, "openingDateConfidence": "alta" | "baja", "mediumType": "tradicional" | "intervencion_no_tradicional", "sensitivityTags": string[], "curationReasoning": string, "imageUrl": string | null, "status": "rejected" | "provisionally_approved" | "pending_review", "venueName": string | null, "venueAddress": string | null, "venueWebsiteOrSocial": string | null, "venueCategory": "art_space" | "hard_excluded" | "needs_review" | null, "freeformLocation": string | null, "sourceUrl": string | null, "sourceType": "oficial" | "difusion" | null, "contactEmail": string | null }]

If you find nothing in scope, respond with an empty array: \`\`\`json
[]
\`\`\``;
}

function extractText(content: MessagesResponseContentBlock[]): string {
  let text = "";
  for (const block of content) {
    if (block.type === "text" && block.text) {
      text += block.text;
    }
  }
  return text;
}

function logSearchQueries(region: Region, content: MessagesResponseContentBlock[]): void {
  for (const block of content) {
    if (block.type === "server_tool_use" && block.name === "web_search" && block.input?.query) {
      console.log(`[event-discovery] ${region.name} search: "${block.input.query}"`);
    }
  }
}

function parseProvisionalCandidates(content: MessagesResponseContentBlock[]): ProvisionalEventCandidate[] {
  const fullText = extractText(content);
  const match = fullText.match(/```json\s*([\s\S]*?)```/);

  if (!match) {
    throw new Error("discoverEvents: no fenced JSON block found in the model's response");
  }

  const parsed: unknown = JSON.parse(match[1]);
  if (!Array.isArray(parsed)) {
    throw new Error("discoverEvents: parsed JSON is not an array");
  }

  return (parsed as Array<Record<string, unknown>>).map((raw) => ({
    title: raw.title as string,
    description: (raw.description as string | null) ?? null,
    artist: (raw.artist as string | null) ?? null,
    openingDatetime: (raw.openingDatetime as string | null) ?? null,
    openingDateConfidence: raw.openingDateConfidence as "alta" | "baja",
    mediumType: raw.mediumType as "tradicional" | "intervencion_no_tradicional",
    sensitivityTags: (raw.sensitivityTags as string[]) ?? [],
    curationReasoning: raw.curationReasoning as string,
    imageUrl: (raw.imageUrl as string | null) ?? null,
    provisionalStatus: raw.status as ProvisionalEventCandidate["provisionalStatus"],
    venueName: (raw.venueName as string | null) ?? null,
    venueAddress: (raw.venueAddress as string | null) ?? null,
    venueWebsiteOrSocial: (raw.venueWebsiteOrSocial as string | null) ?? null,
    venueCategory: (raw.venueCategory as EventDiscoveryCandidate["venueCategory"]) ?? null,
    freeformLocation: (raw.freeformLocation as string | null) ?? null,
    sourceUrl: (raw.sourceUrl as string | null) ?? null,
    sourceType: (raw.sourceType as EventDiscoveryCandidate["sourceType"]) ?? null,
    contactEmail: (raw.contactEmail as string | null) ?? null,
  }));
}

function toUsage(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number } | null;
}): DiscoverUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? undefined,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? undefined,
    webSearchRequests: usage.server_tool_use?.web_search_requests ?? undefined,
  };
}

const MODEL = "claude-haiku-4-5";

// Two-step curation, same design as event-crawler/curate.ts: a single
// search-heavy text call applies the venue-optional identification, the
// four content axes, and escalation signals; a vision call (Axis 5) then
// runs only for candidates that would otherwise be included and have a
// real image — so vision cost is paid only when it matters.
export async function discoverEvents(
  region: Region,
  client: MessagesClient,
  existingVenueNames: string[] = [],
  now: Date = new Date(),
  imageFetcher: ImageFetcher = defaultImageFetcher,
): Promise<DiscoverResult> {
  const queries = buildQueries(region, now);
  const usages: DiscoverUsage[] = [];

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: buildSystemPrompt(region, queries, now, existingVenueNames),
    // allowed_callers: ["direct"] is required — web_search_20260209 defaults
    // to programmatic/dynamic-filtering calling, which Haiku doesn't
    // support (confirmed via a real API call: 400 "does not support
    // programmatic tool calling" without this).
    tools: [
      {
        type: "web_search_20260209",
        name: "web_search",
        max_uses: MAX_WEB_SEARCH_USES,
        allowed_callers: ["direct"],
      },
    ],
    messages: [
      {
        role: "user",
        content: `Research current exhibitions and artistic interventions for ${region.name}, ${region.country}.`,
      },
    ],
  });

  logSearchQueries(region, response.content);
  usages.push(toUsage(response.usage));
  const provisional = parseProvisionalCandidates(response.content);

  const candidates: EventDiscoveryCandidate[] = [];
  for (const p of provisional) {
    const { provisionalStatus, ...rest } = p;

    if (provisionalStatus === "rejected" || provisionalStatus === "pending_review") {
      candidates.push({ ...rest, status: provisionalStatus });
      continue;
    }

    // provisionally_approved
    if (!rest.imageUrl) {
      candidates.push({ ...rest, status: "approved" });
      continue;
    }

    const { status: visionStatus, usage: visionUsage } = await runVisionCheck(client, imageFetcher, rest.imageUrl);
    usages.push(visionUsage);
    candidates.push({ ...rest, status: visionStatus });
  }

  return { candidates, usage: usages };
}
