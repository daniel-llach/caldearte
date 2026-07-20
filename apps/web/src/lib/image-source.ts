// There's no image-source column in the DB — derived client-side from
// `source_url`'s hostname, same precedent as cities.ts's deriveCityId
// (derive from an existing free-text/URL field instead of a schema change).

export type ImageSourceKind = "instagram" | "facebook" | "web";

export interface ImageSource {
  kind: ImageSourceKind;
  domain: string | null;
}

export function deriveImageSource(sourceUrl: string | null): ImageSource {
  if (!sourceUrl) return { kind: "web", domain: null };

  let hostname: string;
  try {
    hostname = new URL(sourceUrl).hostname;
  } catch {
    return { kind: "web", domain: null }; // scraped URLs aren't guaranteed parseable
  }

  if (hostname.includes("instagram.com")) return { kind: "instagram", domain: null };
  if (hostname.includes("facebook.com")) return { kind: "facebook", domain: null };
  return { kind: "web", domain: hostname.replace(/^www\./, "") };
}

export type CardImage =
  | { type: "photo"; url: string }
  | { type: "placeholder"; source: ImageSourceKind; domain: string | null };

// The three placeholder PNGs are already complete, ready-to-use
// backgrounds (gradient/marble + logo baked in per public/placeholders/) —
// shared between CardImage.tsx (full-size card) and CityThumbnails.tsx
// (small preview tiles), so it lives next to the ImageSourceKind it
// indexes rather than duplicated in each component.
export const PLACEHOLDER_BG: Record<ImageSourceKind, string> = {
  instagram: "/placeholders/instagram.png",
  facebook: "/placeholders/facebook.png",
  web: "/placeholders/web.png",
};

// Photo wins whenever a real image exists — EXCEPT for Instagram/Facebook
// sources, where it never does. Confirmed in production: an imageUrl
// scraped from an Instagram-sourced event is a signed, short-lived CDN
// link (scontent.cdninstagram.com/...&oe=...) — it 403s within days
// regardless of how "fresh" it was when captured, since the expiry is
// baked into the URL itself. There's no reliable window where trusting it
// is safe, so always use the branded placeholder for these two sources —
// exactly what that placeholder exists for — rather than gambling on a
// link that's guaranteed to rot.
export function resolveCardImage(event: { imageUrl: string | null; sourceUrl: string | null }): CardImage {
  const { kind, domain } = deriveImageSource(event.sourceUrl);
  if (event.imageUrl && kind !== "instagram" && kind !== "facebook") return { type: "photo", url: event.imageUrl };
  return { type: "placeholder", source: kind, domain };
}
