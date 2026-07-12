import type { ImageCandidate } from "./extract-images.js";
import { ART_SCOPE_POLICY, TEXT_CURATION_POLICY, ESCALATION_SIGNALS } from "../lib/curation-policy.js";
import { runVisionCheck, defaultImageFetcher, type ImageFetcher, type VisionUsage } from "../lib/vision-check.js";

export type FinalStatus = "approved" | "rejected" | "pending_review";
type ProvisionalStatus = "rejected" | "provisionally_approved" | "pending_review";

export interface EventCandidate {
  title: string;
  description: string | null;
  artist: string | null;
  openingDatetime: string | null;
  openingDateConfidence: "alta" | "baja";
  mediumType: "tradicional" | "intervencion_no_tradicional";
  sensitivityTags: string[];
  curationReasoning: string;
  imageUrl: string | null;
  status: FinalStatus;
}

interface ProvisionalCandidate extends Omit<EventCandidate, "status"> {
  provisionalStatus: ProvisionalStatus;
}

export type CurateUsage = VisionUsage;

export interface CurateResult {
  candidates: EventCandidate[];
  usage: CurateUsage[];
}

interface MessagesResponseContentBlock {
  type: string;
  text?: string;
}

// Same structural interface shape as venue-discovery/discover.ts's
// MessagesClient — no web search tool used here, so no server_tool_use.
// Also satisfies lib/vision-check.ts's narrower VisionMessagesClient shape.
export interface MessagesClient {
  messages: {
    create(params: Record<string, unknown>): Promise<{
      content: MessagesResponseContentBlock[];
      usage: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens?: number | null;
        cache_read_input_tokens?: number | null;
      };
    }>;
  };
}

export type { ImageFetcher };
export { defaultImageFetcher };

export function buildTextSystemPrompt(venueName: string, imageCandidates: ImageCandidate[]): string {
  const imageList =
    imageCandidates.length > 0
      ? imageCandidates.map((c) => `- ${c.src}${c.alt ? ` (alt: "${c.alt}")` : ""}`).join("\n")
      : "(no image candidates found on this page)";

  return `You are looking at the homepage of "${venueName}", an art/community venue, as part of Caldearte, a curated calendar of art opening nights.

Identify any opening-night events announced on this page (a new exhibition, show, or intervention starting on a specific date) — ignore past events, generic "about us" content, and unrelated news.

For each event found, extract: title, description, artist (if named), opening date/time, and whether the date confidence is "alta" or "baja". Use "alta" only when an explicit opening date/time is given. When the source only gives the exhibition's overall run (e.g. "Nov 12 - Dec 27"), not a specific opening night, use "baja" and set the date to the run's **start date** as a proxy — and say so explicitly in curationReasoning (e.g. "fecha de inicio de la muestra, no se confirma que sea la inauguración"), so this is never presented as a confirmed opening.

${ART_SCOPE_POLICY}

${TEXT_CURATION_POLICY}

${ESCALATION_SIGNALS}

Also tag each event: \`mediumType\` is "tradicional" (gallery/museum-style exhibition) or "intervencion_no_tradicional" (street art, public intervention, non-traditional space); \`sensitivityTags\` is an array from ["desnudo_erotismo", "guerra_violencia", "memoria_dictadura"] (empty array if none apply). Write a short \`curationReasoning\` explaining your axis decision.

Candidate images found on this page:
${imageList}

If the event has a genuine featured image among these candidates (the artwork/flyer, not a logo or unrelated photo), set \`imageUrl\` to that exact URL from the list above. Otherwise set it to null.

Respond with ONLY a fenced JSON code block containing an array of objects with this exact shape, and nothing else before or after it:
[{ "title": string, "description": string | null, "artist": string | null, "openingDatetime": string | null, "openingDateConfidence": "alta" | "baja", "mediumType": "tradicional" | "intervencion_no_tradicional", "sensitivityTags": string[], "curationReasoning": string, "imageUrl": string | null, "status": "rejected" | "provisionally_approved" | "pending_review" }]

If you find no opening-night events, respond with an empty array: \`\`\`json
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

function parseProvisionalCandidates(content: MessagesResponseContentBlock[]): ProvisionalCandidate[] {
  const fullText = extractText(content);
  const match = fullText.match(/```json\s*([\s\S]*?)```/);

  if (!match) {
    throw new Error("curateVenuePage: no fenced JSON block found in the model's text response");
  }

  const parsed: unknown = JSON.parse(match[1]);
  if (!Array.isArray(parsed)) {
    throw new Error("curateVenuePage: parsed JSON is not an array");
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
    provisionalStatus: raw.status as ProvisionalStatus,
  }));
}

function toUsage(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}): CurateUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? undefined,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? undefined,
  };
}

const MODEL = "claude-haiku-4-5";

// Two-step curation, matching docs/region-discovery.md's design: a cheap
// text-only pass for axes 1-4 + escalation, then a vision call for axis 5
// only on candidates that would otherwise be included with a real image —
// so vision cost is paid only when it matters, not on every candidate.
export async function curateVenuePage(
  venueName: string,
  html: string,
  imageCandidates: ImageCandidate[],
  client: MessagesClient,
  imageFetcher: ImageFetcher = defaultImageFetcher,
): Promise<CurateResult> {
  const usages: CurateUsage[] = [];

  const textResponse = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: buildTextSystemPrompt(venueName, imageCandidates),
    messages: [{ role: "user", content: `Page content:\n\n${html}` }],
  });

  usages.push(toUsage(textResponse.usage));
  const provisional = parseProvisionalCandidates(textResponse.content);

  const candidates: EventCandidate[] = [];
  for (const p of provisional) {
    const { provisionalStatus, ...rest } = p;

    if (provisionalStatus === "rejected" || provisionalStatus === "pending_review") {
      candidates.push({ ...rest, status: provisionalStatus });
      continue;
    }

    // provisionally_approved
    if (!rest.imageUrl) {
      // Nothing to falsely show — matches curation-policy.md's framing of
      // axis 5's actual risk (a graphic image being displayed).
      candidates.push({ ...rest, status: "approved" });
      continue;
    }

    const { status: visionStatus, usage: visionUsage } = await runVisionCheck(client, imageFetcher, rest.imageUrl);
    usages.push(visionUsage);
    candidates.push({ ...rest, status: visionStatus });
  }

  return { candidates, usage: usages };
}
