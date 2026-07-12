import { VISION_AXIS5_POLICY } from "./curation-policy.js";

export interface ImageFetcher {
  fetch(url: string): Promise<{ base64: string; mediaType: string }>;
}

export const defaultImageFetcher: ImageFetcher = {
  async fetch(url: string) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`defaultImageFetcher: ${url} responded ${response.status}`);
    }
    // Some servers append parameters to Content-Type on binary responses
    // (e.g. "image/jpeg;charset=UTF-8", seen on artes.uchile.cl) — the
    // Anthropic API rejects anything but the bare mime type, so strip
    // everything after the first ";" before using it.
    const mediaType = (response.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
    const buffer = Buffer.from(await response.arrayBuffer());
    return { base64: buffer.toString("base64"), mediaType };
  },
};

interface VisionResponseContentBlock {
  type: string;
  text?: string;
}

// Minimal shape the vision call needs — both event-crawler/curate.ts's and
// event-discovery/discover.ts's richer MessagesClient interfaces already
// satisfy this structurally, no adapter needed.
export interface VisionMessagesClient {
  messages: {
    create(params: Record<string, unknown>): Promise<{
      content: VisionResponseContentBlock[];
      usage: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens?: number | null;
        cache_read_input_tokens?: number | null;
      };
    }>;
  };
}

export interface VisionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

const MODEL = "claude-haiku-4-5";

function extractText(content: VisionResponseContentBlock[]): string {
  let text = "";
  for (const block of content) {
    if (block.type === "text" && block.text) {
      text += block.text;
    }
  }
  return text;
}

// Axis 5 (explicit aggression) only — a separate call from the text-based
// axes 1-4, since it needs the actual image. Called only when a candidate
// would otherwise be included and has a real chosen image, so vision cost
// is paid only when it matters.
export async function runVisionCheck(
  client: VisionMessagesClient,
  imageFetcher: ImageFetcher,
  imageUrl: string,
): Promise<{ status: "approved" | "rejected"; usage: VisionUsage }> {
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

  const text = extractText(response.content).trim().toUpperCase();
  const status = text.includes("REJECT") ? "rejected" : "approved";

  const usage: VisionUsage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? undefined,
    cacheReadInputTokens: response.usage.cache_read_input_tokens ?? undefined,
  };

  return { status, usage };
}
