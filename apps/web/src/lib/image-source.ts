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

// Photo wins whenever a real image exists, regardless of source; otherwise
// falls back to the source-branded placeholder.
export function resolveCardImage(event: { imageUrl: string | null; sourceUrl: string | null }): CardImage {
  if (event.imageUrl) return { type: "photo", url: event.imageUrl };
  const { kind, domain } = deriveImageSource(event.sourceUrl);
  return { type: "placeholder", source: kind, domain };
}
