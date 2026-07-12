import type { Tables } from "@caldearte/shared-types";

type Region = Tables<"regions">;

export interface VenueCandidate {
  name: string;
  address: string | null;
  websiteOrSocial: string | null;
  // The specific exhibition/intervention page this candidate was found at
  // (not just the venue's general homepage) - lets run.ts derive a
  // listing_url by truncating to the parent directory. Null when the
  // search only turned up the venue's general site/social link.
  sourceUrl: string | null;
  // Whether sourceUrl is the venue's own site ("oficial") or a third-party
  // mention (news, cultural agenda aggregator, municipal listing —
  // "difusion"). Only "oficial" sources are trustworthy enough to derive
  // listing_url from — a news article or aggregator page doesn't update
  // when the venue's own exhibitions change, and an aggregator covers many
  // venues at once, so deriving a "listing page" from it would misattribute
  // whatever the Event Crawler later finds there. Null when sourceUrl
  // itself is null.
  sourceType: "oficial" | "difusion" | null;
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
// usage well under this in normal operation. Lowered from 12 to 8 after the
// exhibition-first run showed 3 of 4 regions hitting the old cap trying to
// verify a single candidate — a manual dry run (same query templates, no
// API) found a real, confirmed candidate in 4-5 searches total.
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

// Exhibition/intervention-first, not venue-first: the earlier version
// searched for "galleries"/"cultural centers" as a proxy for finding
// content, and it produced exactly the failure mode that assumption
// predicts - a venue list with nothing to show for it, because the venue's
// homepage often isn't where its current exhibitions are listed (proven
// with GAM: real content lives at a subpage, not the homepage). Searching
// for the actual exhibitions/interventions directly finds a specific page
// we can derive a listing URL from, and treats venues as a byproduct.
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

// Mirrors the venue-type filter in docs/curation-policy.md — kept in sync
// with that doc, not re-derived independently.
const VENUE_FILTER_POLICY = `Classify each venue's "category" using this rule:
- "hard_excluded": the venue is a church/temple or house of worship of any religious cult, or the headquarters of a right-wing or far-right political party.
- "art_space": a recognizable, legitimate art or community space — this includes not just museums and galleries but cultural centers, community centers, neighborhood associations, and spaces known for street art or public interventions.
- "needs_review": anything that is neither clearly a legitimate art/community space nor clearly one of the hard-excluded categories above. Do not guess — use this category when unsure.`;

const SEARCH_ECONOMY_POLICY = `Be economical with searches: aim for the 3 initial broad queries plus at most 1-3 targeted follow-ups total for the whole region — not one follow-up per candidate. Rely on the information already present in your initial broad search results whenever possible; classify source type (see below) using those same results, not a dedicated search for it. Only perform an additional, targeted search when the initial results didn't already give you enough to confirm a candidate is real, active, and in scope, or to extract its address/contact details. If you're still unsure about a candidate after a reasonable effort, classify it "needs_review" rather than spending more searches to resolve it. Never issue the same or a near-duplicate query more than once — if you already ran a search, reuse its results instead of repeating it.`;

const SOURCE_CLASSIFICATION_POLICY = `For each candidate, classify where sourceUrl was found: "oficial" (the venue's own website or social media account) or "difusion" (a news site, cultural agenda aggregator, or municipal events listing that isn't the venue's own site). If the same exhibition/intervention turns up via both an official source and a diffusion source in your search results, report it once — consolidate into a single candidate, using the official source for sourceUrl and sourceType. If it only appears via a diffusion source, still report it (don't omit real candidates just because there's no official site) — set sourceType to "difusion" and don't invent an official URL that wasn't actually found. Classify using the search results you already have; this is a judgment call about content already in front of you, not a reason for an extra search.`;

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

For each exhibition or intervention you find, identify the venue hosting it (or note that it has no fixed venue, if it's a standalone street intervention) and validate it's real and currently active — not a stale blog post, a dead result, or something that already closed. Extract: venue name, address (if available), the venue's general website or social media URL, the specific page URL where you found this exhibition/intervention (sourceUrl — not just the venue's homepage), and a public contact email if visible.

Today's date is ${todayIso}. Only report candidates whose exhibition/intervention falls between today and ${cutoffIso} (roughly the next 2 months) — discard anything that has already ended and anything further out (dates that far ahead are typically unconfirmed).

${SEARCH_ECONOMY_POLICY}
${knownVenuesSection}
${VENUE_FILTER_POLICY}

${SOURCE_CLASSIFICATION_POLICY}

When you are done researching, respond with ONLY a fenced JSON code block (\`\`\`json ... \`\`\`) containing an array of objects with this exact shape, and nothing else before or after it:
[{ "name": string, "address": string | null, "websiteOrSocial": string | null, "sourceUrl": string | null, "sourceType": "oficial" | "difusion" | null, "contactEmail": string | null, "category": "art_space" | "hard_excluded" | "needs_review" }]

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
  now: Date = new Date(),
): Promise<DiscoverResult> {
  const queries = buildQueries(region, now);

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 8000,
    system: buildSystemPrompt(region, queries, now, existingVenueNames),
    // allowed_callers: ["direct"] is required — web_search_20260209 defaults
    // to programmatic/dynamic-filtering calling, which Haiku doesn't
    // support (confirmed via a real API call: 400 "does not support
    // programmatic tool calling" without this). This also means no dynamic
    // filtering, which is fine here — the search-economy prompt is what's
    // meant to keep result volume down, not the tool's own filtering.
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
