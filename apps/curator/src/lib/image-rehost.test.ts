import { test } from "node:test";
import assert from "node:assert/strict";
import { rehostImage, type ImageFetchLike } from "./image-rehost.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@caldearte/shared-types";

function stubFetch(opts: { ok?: boolean; contentType?: string; bytes?: number }): ImageFetchLike {
  const { ok = true, contentType = "image/jpeg", bytes = 1024 } = opts;
  return async () => ({
    ok,
    headers: { get: (name: string) => (name === "content-type" ? contentType : null) },
    arrayBuffer: async () => new ArrayBuffer(bytes),
  });
}

function stubClient(opts: { uploadError?: string; publicUrl?: string } = {}): {
  client: SupabaseClient<Database>;
  uploadCalls: Array<{ path: string; contentType: string | undefined }>;
} {
  const uploadCalls: Array<{ path: string; contentType: string | undefined }> = [];
  const storage = {
    from: (_bucket: string) => ({
      upload: async (path: string, _buffer: ArrayBuffer, options: { contentType?: string }) => {
        uploadCalls.push({ path, contentType: options.contentType });
        if (opts.uploadError) return { error: { message: opts.uploadError } };
        return { error: null };
      },
      getPublicUrl: (path: string) => ({
        data: { publicUrl: opts.publicUrl ?? `https://project.supabase.co/storage/v1/object/public/event-images/${path}` },
      }),
    }),
  };
  return { client: { storage } as unknown as SupabaseClient<Database>, uploadCalls };
}

test("rehostImage uploads a valid image and returns its new public URL", async () => {
  const { client, uploadCalls } = stubClient();
  const result = await rehostImage("https://scontent.cdninstagram.com/afiche.jpg", client, stubFetch({}));
  assert.match(result ?? "", /^https:\/\/project\.supabase\.co\/storage\/v1\/object\/public\/event-images\/.+\.jpg$/);
  assert.equal(uploadCalls.length, 1);
  assert.equal(uploadCalls[0].contentType, "image/jpeg");
});

test("rehostImage returns null on a non-2xx response, without attempting an upload", async () => {
  const { client, uploadCalls } = stubClient();
  const result = await rehostImage("https://scontent.cdninstagram.com/gone.jpg", client, stubFetch({ ok: false }));
  assert.equal(result, null);
  assert.equal(uploadCalls.length, 0);
});

test("rehostImage returns null for an unrecognized content type — never guesses an extension", async () => {
  const { client, uploadCalls } = stubClient();
  const result = await rehostImage("https://scontent.cdninstagram.com/video.mp4", client, stubFetch({ contentType: "video/mp4" }));
  assert.equal(result, null);
  assert.equal(uploadCalls.length, 0);
});

test("rehostImage returns null for an empty or oversized body, without uploading", async () => {
  const { client: emptyClient, uploadCalls: emptyCalls } = stubClient();
  assert.equal(await rehostImage("https://x.com/a.jpg", emptyClient, stubFetch({ bytes: 0 })), null);
  assert.equal(emptyCalls.length, 0);

  const { client: hugeClient, uploadCalls: hugeCalls } = stubClient();
  assert.equal(await rehostImage("https://x.com/a.jpg", hugeClient, stubFetch({ bytes: 9 * 1024 * 1024 })), null);
  assert.equal(hugeCalls.length, 0);
});

test("rehostImage returns null when the Storage upload itself fails", async () => {
  const { client } = stubClient({ uploadError: "bucket not found" });
  const result = await rehostImage("https://x.com/a.jpg", client, stubFetch({}));
  assert.equal(result, null);
});

test("rehostImage returns null when the fetch itself throws, never bubbling the error", async () => {
  const { client } = stubClient();
  const throwing: ImageFetchLike = async () => {
    throw new Error("network error");
  };
  const result = await rehostImage("https://x.com/a.jpg", client, throwing);
  assert.equal(result, null);
});
