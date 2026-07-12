import type { VenueCandidate } from "./discover.js";

export interface ExistingVenue {
  id: string;
  name: string;
  source_domain: string | null;
  listing_url?: string | null;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function extractDomain(url: string | null): string | null {
  if (!url) return null;
  try {
    const { hostname } = new URL(url.startsWith("http") ? url : `https://${url}`);
    return hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Strips the last path segment (parent directory) so a specific
// exhibition/intervention page (e.g. .../artesvisuales/mundo-pepo/) yields
// the folder that actually lists all of them (.../artesvisuales/). Falls
// back to null for anything unparseable rather than guessing.
export function deriveListingUrl(sourceUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl.startsWith("http") ? sourceUrl : `https://${sourceUrl}`);
  } catch {
    return null;
  }

  const segments = parsed.pathname.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) {
    // Already at the root - nothing to strip.
    return `${parsed.origin}/`;
  }

  segments.pop();
  return `${parsed.origin}/${segments.join("/")}${segments.length > 0 ? "/" : ""}`;
}

export function findMatchingVenue(
  candidate: VenueCandidate,
  existingVenues: ExistingVenue[],
): ExistingVenue | null {
  const candidateName = normalizeName(candidate.name);
  const candidateDomain = extractDomain(candidate.websiteOrSocial) ?? extractDomain(candidate.sourceUrl);

  return (
    existingVenues.find((venue) => {
      if (normalizeName(venue.name) === candidateName) return true;
      if (candidateDomain && venue.source_domain && venue.source_domain === candidateDomain) {
        return true;
      }
      return false;
    }) ?? null
  );
}

export function isDuplicate(candidate: VenueCandidate, existingVenues: ExistingVenue[]): boolean {
  return findMatchingVenue(candidate, existingVenues) !== null;
}

function candidatesMatch(a: VenueCandidate, b: VenueCandidate): boolean {
  if (normalizeName(a.name) === normalizeName(b.name)) return true;
  const domainA = extractDomain(a.websiteOrSocial) ?? extractDomain(a.sourceUrl);
  const domainB = extractDomain(b.websiteOrSocial) ?? extractDomain(b.sourceUrl);
  return Boolean(domainA && domainB && domainA === domainB);
}

function sourceRank(candidate: VenueCandidate): number {
  return candidate.sourceType === "oficial" ? 2 : candidate.sourceType === "difusion" ? 1 : 0;
}

// A single discover() call can report the same institution more than once
// - once per exhibition it's hosting, sometimes under a slightly different
// name (a real run found "Colección MAC..." and "Colección MAC... (Quinta
// Normal)" as separate candidates sharing one domain). existingVenues-based
// matching alone doesn't catch this, since it only compares against rows
// that existed *before* this run. Consolidate the batch against itself
// first, keeping whichever candidate has the more trustworthy source
// (oficial over difusion) and a non-null sourceUrl when ranks tie.
export function consolidateCandidates(candidates: VenueCandidate[]): VenueCandidate[] {
  const consolidated: VenueCandidate[] = [];

  for (const candidate of candidates) {
    const matchIndex = consolidated.findIndex((existing) => candidatesMatch(existing, candidate));

    if (matchIndex === -1) {
      consolidated.push(candidate);
      continue;
    }

    const existing = consolidated[matchIndex];
    const existingRank = sourceRank(existing);
    const candidateRank = sourceRank(candidate);

    if (candidateRank > existingRank || (candidateRank === existingRank && !existing.sourceUrl && candidate.sourceUrl)) {
      consolidated[matchIndex] = candidate;
    }
  }

  return consolidated;
}
