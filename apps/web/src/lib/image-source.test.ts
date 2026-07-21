import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveImageSource, resolveCardImage } from "./image-source";

test("deriveImageSource recognizes instagram.com", () => {
  assert.deepEqual(deriveImageSource("https://www.instagram.com/p/abc123/"), { kind: "instagram", domain: null });
});

test("deriveImageSource recognizes facebook.com", () => {
  assert.deepEqual(deriveImageSource("https://www.facebook.com/events/123"), { kind: "facebook", domain: null });
});

test("deriveImageSource falls back to web + root domain, stripping www.", () => {
  assert.deepEqual(deriveImageSource("https://www.uchile.cl/eventos/x"), { kind: "web", domain: "uchile.cl" });
});

test("deriveImageSource: null sourceUrl -> web with no domain", () => {
  assert.deepEqual(deriveImageSource(null), { kind: "web", domain: null });
});

test("deriveImageSource: unparseable URL -> web with no domain, doesn't throw", () => {
  assert.deepEqual(deriveImageSource("not a url"), { kind: "web", domain: null });
});

test("resolveCardImage: real imageUrl wins for an ordinary web source", () => {
  assert.deepEqual(
    resolveCardImage({ imageUrl: "https://cdn.example.com/x.jpg", sourceUrl: "https://uchile.cl/eventos/x" }),
    { type: "photo", url: "https://cdn.example.com/x.jpg" },
  );
});

test("resolveCardImage: no imageUrl -> placeholder derived from sourceUrl", () => {
  assert.deepEqual(resolveCardImage({ imageUrl: null, sourceUrl: "https://facebook.com/events/1" }), {
    type: "placeholder",
    source: "facebook",
    domain: null,
  });
});

test("resolveCardImage: Instagram/Facebook use the placeholder for a raw (not re-hosted) imageUrl — those CDN links are signed and short-lived, guaranteed to rot", () => {
  assert.deepEqual(
    resolveCardImage({
      imageUrl: "https://scontent.cdninstagram.com/v/t51.82787-15/example.jpg?oe=6A5CC572",
      sourceUrl: "https://www.instagram.com/reel/abc123",
    }),
    { type: "placeholder", source: "instagram", domain: null },
  );
  assert.deepEqual(
    resolveCardImage({ imageUrl: "https://scontent.xx.fbcdn.net/example.jpg", sourceUrl: "https://www.facebook.com/events/1" }),
    { type: "placeholder", source: "facebook", domain: null },
  );
});

test("resolveCardImage: an Instagram/Facebook-sourced imageUrl IS trusted once re-hosted to our own Supabase Storage bucket", () => {
  const original = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://wtuhloeyotjthvmvxmxj.supabase.co";
  try {
    assert.deepEqual(
      resolveCardImage({
        imageUrl: "https://wtuhloeyotjthvmvxmxj.supabase.co/storage/v1/object/public/event-images/abc123.jpg",
        sourceUrl: "https://www.instagram.com/reel/abc123",
      }),
      { type: "photo", url: "https://wtuhloeyotjthvmvxmxj.supabase.co/storage/v1/object/public/event-images/abc123.jpg" },
    );
  } finally {
    process.env.NEXT_PUBLIC_SUPABASE_URL = original;
  }
});

test("resolveCardImage: still falls back to the placeholder for a raw social CDN link when NEXT_PUBLIC_SUPABASE_URL isn't set", () => {
  const original = process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    assert.deepEqual(
      resolveCardImage({ imageUrl: "https://scontent.cdninstagram.com/example.jpg", sourceUrl: "https://www.instagram.com/reel/abc123" }),
      { type: "placeholder", source: "instagram", domain: null },
    );
  } finally {
    process.env.NEXT_PUBLIC_SUPABASE_URL = original;
  }
});
