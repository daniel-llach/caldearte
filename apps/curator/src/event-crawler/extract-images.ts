export interface ImageCandidate {
  src: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

const IMG_TAG_RE = /<img\b[^>]*>/gi;
const ATTR_RE = (name: string) => new RegExp(`${name}\\s*=\\s*"([^"]*)"|${name}\\s*=\\s*'([^']*)'`, "i");

function attr(tag: string, name: string): string | null {
  const match = tag.match(ATTR_RE(name));
  if (!match) return null;
  return match[1] ?? match[2] ?? null;
}

// Small, obviously-decorative images (site logos, icons) aren't useful as an
// event's featured image — filtered out by filename heuristic rather than
// left for the model to sort through.
const LOW_VALUE_SRC_RE = /(logo|icon|favicon|sprite|avatar|spinner|placeholder)/i;

function score(candidate: ImageCandidate): number {
  if (LOW_VALUE_SRC_RE.test(candidate.src)) return -1;

  let s = 0;
  if (candidate.alt && candidate.alt.trim().length > 0) s += 2;
  if (candidate.width && candidate.height) {
    const area = candidate.width * candidate.height;
    if (area >= 400 * 400) s += 3;
    else if (area >= 150 * 150) s += 1;
    else s -= 1;
  }
  return s;
}

function resolveUrl(src: string, pageUrl: string): string | null {
  try {
    return new URL(src, pageUrl).toString();
  } catch {
    return null;
  }
}

// Extracts <img> candidates from raw HTML and ranks them so only a short,
// relevant shortlist gets handed to the model — not every image on the page.
export function extractImageCandidates(
  html: string,
  pageUrl: string,
  limit = 8,
): ImageCandidate[] {
  const tags = html.match(IMG_TAG_RE) ?? [];

  const candidates: ImageCandidate[] = [];
  for (const tag of tags) {
    const src = attr(tag, "src");
    if (!src || src.startsWith("data:")) continue;

    const resolved = resolveUrl(src, pageUrl);
    if (!resolved) continue;

    const width = attr(tag, "width");
    const height = attr(tag, "height");

    candidates.push({
      src: resolved,
      alt: attr(tag, "alt"),
      width: width ? Number.parseInt(width, 10) || null : null,
      height: height ? Number.parseInt(height, 10) || null : null,
    });
  }

  return candidates
    .map((c) => ({ candidate: c, score: score(c) }))
    .filter((c) => c.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((c) => c.candidate);
}
