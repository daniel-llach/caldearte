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
}

export interface DiscoverResult {
  candidates: VenueCandidate[];
  usage: DiscoverUsage;
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

function buildSystemPrompt(region: Region, queries: string[]): string {
  return `You are researching art and community venues for the city/metro "${region.name}, ${region.country}" as part of Caldearte, a curated calendar of art opening nights.

Use the web_search tool to research using queries like:
${queries.map((q) => `- "${q}"`).join("\n")}

For each result, validate it is a real, currently active art or community space — not a stale blog post, a news article, or a dead/defunct result. Extract: name, address (if available), website or social media URL, and a public contact email if visible.

${VENUE_FILTER_POLICY}

When you are done researching, respond with ONLY a fenced JSON code block (\`\`\`json ... \`\`\`) containing an array of objects with this exact shape, and nothing else before or after it:
[{ "name": string, "address": string | null, "websiteOrSocial": string | null, "contactEmail": string | null, "category": "art_space" | "hard_excluded" | "needs_review" }]

If you find no legitimate venues, respond with an empty array: \`\`\`json
[]
\`\`\``;
}

function extractText(content: Array<{ type: string; text?: string }>): string {
  let text = "";
  for (const block of content) {
    if (block.type === "text" && block.text) {
      text += block.text;
    }
  }
  return text;
}

function parseCandidates(content: Array<{ type: string; text?: string }>): VenueCandidate[] {
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
): Promise<DiscoverResult> {
  const queries = buildQueries(region);

  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 8000,
    system: buildSystemPrompt(region, queries),
    tools: [{ type: "web_search_20260209", name: "web_search" }],
    output_config: { effort: "medium" },
    messages: [
      {
        role: "user",
        content: `Research venues for ${region.name}, ${region.country}.`,
      },
    ],
  });

  const candidates = parseCandidates(response.content);

  const usage: DiscoverUsage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? undefined,
    cacheReadInputTokens: response.usage.cache_read_input_tokens ?? undefined,
  };

  return { candidates, usage };
}
