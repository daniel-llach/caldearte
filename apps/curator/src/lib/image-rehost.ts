// Re-hosts an Instagram/Facebook-sourced image to Supabase Storage at
// curation time, before its signed CDN link rots (confirmed against real
// production samples: sometimes within hours, always within days — the
// expiry is baked into the URL's own `oe=` param, not a freshness question).
// Only ever called for instagram.com/facebook.com sources (see
// isSocialMediaUrl in page-fetch.ts) — other sources' imageUrl is used
// directly, hotlinked, no re-hosting needed for those yet (general
// hotlink-reliability hardening is the wider, not-yet-scoped Phase 3 idea in
// docs/roadmap.md; this covers only the known-rot Instagram/Facebook case).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@caldearte/shared-types";

const BUCKET = "event-images";
// Real measured samples (5 Instagram images, 2026-07-20): 25KB-1.9MB, one
// already dead (22 bytes) within hours of capture. 8MB is a generous safety
// cap against something unexpectedly huge, not a tuned average.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type ImageFetchLike = (
  url: string,
  init: { signal: AbortSignal; headers: Record<string, string> },
) => Promise<{ ok: boolean; headers: { get(name: string): string | null }; arrayBuffer(): Promise<ArrayBuffer> }>;

// Returns the new public Supabase Storage URL, or null if anything along the
// way fails — the caller falls back to no image (never stores a link already
// known to rot).
export async function rehostImage(
  imageUrl: string,
  client: SupabaseClient<Database>,
  fetchImpl: ImageFetchLike = fetch,
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetchImpl(imageUrl, {
      signal: controller.signal,
      // Some CDNs vary their response by user-agent — a plain server-side
      // fetch with no UA at all has been seen to behave differently than a
      // browser-like one for image hosts elsewhere in this codebase's
      // history (see page-fetch.ts's own fetch calls), so set one
      // defensively rather than relying on the default.
      headers: { "user-agent": "Mozilla/5.0 (compatible; CaldearteBot/1.0)" },
    });
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    const extension = EXTENSION_BY_CONTENT_TYPE[contentType];
    if (!extension) return null; // not a recognized image type — don't guess

    const buffer = await res.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) return null;

    const path = `${crypto.randomUUID()}.${extension}`;
    const { error } = await client.storage.from(BUCKET).upload(path, buffer, { contentType, upsert: false });
    if (error) {
      console.error(`[image-rehost] upload failed for ${imageUrl}: ${error.message}`);
      return null;
    }

    return client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  } catch (err) {
    console.error(`[image-rehost] failed for ${imageUrl}: ${(err as Error).message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export type RehostImageFn = typeof rehostImage;
