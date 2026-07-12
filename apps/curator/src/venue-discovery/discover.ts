import type { Tables } from "@caldearte/shared-types";

type Region = Tables<"regions">;

export interface VenueCandidate {
  name: string;
  address: string | null;
  websiteOrSocial: string | null;
  contactEmail: string | null;
  category: "art_space" | "hard_excluded" | "needs_review";
}

export interface DiscoverUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  webSearchRequests?: number;
}

export interface DiscoverResult {
  candidates: VenueCandidate[];
  usage: DiscoverUsage;
}

interface MessagesResponseContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: { query?: string };
}

// Narrow structural interface instead of the full Anthropic SDK class, so
// tests can inject a stub without hitting the real API.
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
// usage well under this in normal operation. Lowered from 20 to 12 after the
// first optimized run observed 5-16 real searches/region (avg ~9).
const MAX_WEB_SEARCH_USES = 12;

const QUERY_TEMPLATES: Record<string, (city: string) => string[]> = {
  es: (city) => [
    `galerías de arte en ${city}`,
    `centros culturales ${city}`,
    `juntas de vecinos con actividades culturales ${city}`,
  ],
  en: (city) => [
    `art galleries in ${city}`,
    `cultural centers in ${city}`,
    `neighborhood associations with cultural activities in ${city}`,
  ],
};

function buildQueries(region: Region): string[] {
  const templates = QUERY_TEMPLATES[region.language] ?? QUERY_TEMPLATES.en;
  return templates(region.name);
}

// Mirrors the venue-type filter in docs/curation-policy.md — kept in sync
// with that doc, not re-derived independently.
const VENUE_FILTER_POLICY = `Classify each venue's "category" using this rule:
- "hard_excluded": the venue is a church/temple or house of worship of any religious cult, or the headquarters of a right-wing or far-right political party.
- "art_space": a recognizable, legitimate art or community space — this includes not just museums and galleries but cultural centers, community centers, neighborhood associations, and spaces known for street art or public interventions.
- "needs_review": anything that is neither clearly a legitimate art/community space nor clearly one of the hard-excluded categories above. Do not guess — use this category when unsure.`;

const SEARCH_ECONOMY_POLICY = `Be economical with searches: rely on the information already present in your initial broad search results whenever possible. Only perform an additional, targeted search for a specific candidate when the initial results didn't already give you enough to confirm it's a real, active space or to extract its address/contact details — don't search individually for every candidate as a default. If you're still unsure about a candidate after a reasonable effort, classify it "needs_review" rather than spending more searches to resolve it. Never issue the same or a near-duplicate query more than once — if you already ran a search, reuse its results instead of repeating it.`;

export function buildSystemPrompt(
  region: Region,
  queries: string[],
  existingVenueNames: string[] = [],
): string {
  const knownVenuesSection =
    existingVenueNames.length > 0
      ? `\n\nVenues already known for this region (do not re-search or re-validate these — only report genuinely new candidates not on this list):\n${existingVenueNames.map((n) => `- ${n}`).join("\n")}\n`
      : "";

  return `You are researching art and community venues for the city/metro "${region.name}, ${region.country}" as part of Caldearte, a curated calendar of art opening nights.

Use the web_search tool to research using queries like:
${queries.map((q) => `- "${q}"`).join("\n")}

For each result, validate it is a real, currently active art or community space — not a stale blog post, a news article, or a dead/defunct result. Extract: name, address (if available), website or social media URL, and a public contact email if visible.

${SEARCH_ECONOMY_POLICY}
${knownVenuesSection}
${VENUE_FILTER_POLICY}

When you are done researching, respond with ONLY a fenced JSON code block (\`\`\`json ... \`\`\`) containing an array of objects with this exact shape, and nothing else before or after it:
[{ "name": string, "address": string | null, "websiteOrSocial": string | null, "contactEmail": string | null, "category": "art_space" | "hard_excluded" | "needs_review" }]

If you find no legitimate new venues, respond with an empty array: \`\`\`json
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
      console.log(`[venue-discovery] ${region.name} search: "${block.input.query}"`);
    }
  }
}

function parseCandidates(content: MessagesResponseContentBlock[]): VenueCandidate[] {
  const fullText = extractText(content);
  const match = fullText.match(/```json\s*([\s\S]*?)```/);

  if (!match) {
    throw new Error("discoverVenues: no fenced JSON block found in the model's response");
  }

  const parsed: unknown = JSON.parse(match[1]);
  if (!Array.isArray(parsed)) {
    throw new Error("discoverVenues: parsed JSON is not an array");
  }

  return parsed as VenueCandidate[];
}

export async function discoverVenues(
  region: Region,
  client: MessagesClient,
  existingVenueNames: string[] = [],
): Promise<DiscoverResult> {
  const queries = buildQueries(region);

  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 8000,
    system: buildSystemPrompt(region, queries, existingVenueNames),
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: MAX_WEB_SEARCH_USES }],
    output_config: { effort: "medium" },
    messages: [
      {
        role: "user",
        content: `Research venues for ${region.name}, ${region.country}.`,
      },
    ],
  });

  logSearchQueries(region, response.content);
  const candidates = parseCandidates(response.content);

  const usage: DiscoverUsage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? undefined,
    cacheReadInputTokens: response.usage.cache_read_input_tokens ?? undefined,
    webSearchRequests: response.usage.server_tool_use?.web_search_requests ?? undefined,
  };

  return { candidates, usage };
}
