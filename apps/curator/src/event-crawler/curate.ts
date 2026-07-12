import type { ImageCandidate } from "./extract-images.js";

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

export interface CurateUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

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

export interface ImageFetcher {
  fetch(url: string): Promise<{ base64: string; mediaType: string }>;
}

export const defaultImageFetcher: ImageFetcher = {
  async fetch(url: string) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`defaultImageFetcher: ${url} responded ${response.status}`);
    }
    const mediaType = response.headers.get("content-type") ?? "image/jpeg";
    const buffer = Buffer.from(await response.arrayBuffer());
    return { base64: buffer.toString("base64"), mediaType };
  },
};

// Mirrors docs/overview.md's "What counts as art" section, ported
// verbatim — this is the scope filter, applied BEFORE the exclusion axes
// below. First version only excluded "conventional concerts/shows" and
// still let theater plays through (a real pilot run captured 4 of them at
// Matucana 100) — rewritten after user clarification to explicitly exclude
// theater/concerts/gigs and to actually recognize a genuine artistic
// intervention, not just "not a concert."
const ART_SCOPE_POLICY = `Before applying the exclusion axes below, first confirm this event is actually in scope for an art-opening calendar. Included — visual/plastic art exhibitions: painting, drawing, sculpture, printmaking, installations (sound, tactile, or otherwise), and similar visual-art media shown as an exhibition. Included — genuine artistic interventions: a performance or happening staged specifically as an artistic gesture, not as a conventional show — for example a street performance blending dance and theater as a single artistic intervention, an artist inhabiting a public installation, a mass nude-portrait photography event, or a nude-body walk as performance art. Explicitly excluded, regardless of venue prestige or setting: conventional theater plays (in their usual theater format), concerts, gigs ("tocatas"), and dance performances in their traditional format/venue — even at a legitimate cultural center that also hosts real exhibitions. The test is the format, not the medium or the venue: is this a genuine artistic intervention or a visual-art exhibition, or is it a conventional performing-arts show being staged as usual? The latter is out of scope even when it shares elements (body, music, dance) with what is accepted. If it's ambiguous whether something is a genuine artistic intervention or essentially a themed concert/show with visual elements, use "pending_review" rather than deciding automatically. If it's clearly a conventional theater play, concert, gig, or show with no artistic-intervention framing, use "rejected" — out of scope, not merely low-priority.`;

// Mirrors docs/curation-policy.md's "Operational instruction for Claude
// Haiku's system prompt" block, ported verbatim — kept in sync with that
// doc, not re-derived independently. Axes 1-4 only; axis 5 is separate
// (see VISION_AXIS5_POLICY) because it needs the actual image, not text.
const TEXT_CURATION_POLICY = `Apply a default-exclusion policy across four axes: (1) religion — explicit religious imagery or themes, especially Christian or Jewish; Buddhism is evaluated case by case with a more permissive standard, but isn't automatically included; (2) war or extreme violence; (3) far right or authoritarian ideologies; (4) pseudoscience and superstition (tarot, esotericism, energy healing, and similar). For any of these four axes, the default decision is EXCLUDE. The only exception is when the event declares an explicit and unambiguous critical stance against that specific institution, ideology, or conflict — for example, an installation that explicitly denounces the Church's economic power, or an exhibit with an explicit curatorial statement denouncing an occupation or a dictatorship. "Exploring," "reflecting on," "contextualizing," "documenting," or showing ambiguous aesthetic/curatorial distance isn't enough — without an explicit, declared rejection stance, the event is excluded. There's no middle ground: either the event explicitly criticizes the institution/ideology/conflict, or it's excluded, regardless of artistic quality or the venue's prestige.`;

const ESCALATION_SIGNALS = `Use "pending_review" instead of forcing "rejected"/"provisionally_approved" when: the event appears to meet the exception (explicit critical stance) but the text isn't clear enough to confirm it; there's insufficient context (very short description, unclear curatorial text); the event mixes axes in a way that isn't obvious how to weigh; it involves Buddhism or another non-Christian/non-Jewish tradition and it's unclear whether the more permissive standard applies; or you have any other low-confidence classification. Don't force a binary decision when unsure.`;

export const VISION_AXIS5_POLICY = `Apply a fifth axis, independent of the four above: exclude any event whose image shows physical or sexual aggression explicitly (graphic violence, sexual assault, gore), regardless of whether the event has denunciation intent — denunciation only enables inclusion when expressed textually, thematically, or symbolically, not through explicit imagery. This axis is about explicit aggression/violence, not sexuality or nudity in general: artistic nudity, eroticism, or non-violent sexuality aren't excluded by this criterion. If the image is not graphic/explicit under this definition, respond with exactly APPROVE. If it is, respond with exactly REJECT.`;

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

async function runVisionCheck(
  client: MessagesClient,
  imageFetcher: ImageFetcher,
  imageUrl: string,
  usages: CurateUsage[],
): Promise<"approved" | "rejected"> {
  const { base64, mediaType } = await imageFetcher.fetch(imageUrl);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: VISION_AXIS5_POLICY },
        ],
      },
    ],
  });

  usages.push(toUsage(response.usage));
  const text = extractText(response.content).trim().toUpperCase();
  return text.includes("REJECT") ? "rejected" : "approved";
}

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

    const visionStatus = await runVisionCheck(client, imageFetcher, rest.imageUrl, usages);
    candidates.push({ ...rest, status: visionStatus });
  }

  return { candidates, usage: usages };
}
