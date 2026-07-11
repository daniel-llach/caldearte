import type { VenueCandidate } from "./discover.js";

export interface ExistingVenue {
  name: string;
  source_domain: string | null;
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

export function isDuplicate(candidate: VenueCandidate, existingVenues: ExistingVenue[]): boolean {
  const candidateName = normalizeName(candidate.name);
  const candidateDomain = extractDomain(candidate.websiteOrSocial);

  return existingVenues.some((venue) => {
    if (normalizeName(venue.name) === candidateName) return true;
    if (candidateDomain && venue.source_domain && venue.source_domain === candidateDomain) {
      return true;
    }
    return false;
  });
}
