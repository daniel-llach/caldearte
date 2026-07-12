export interface ExistingVenue {
  id: string;
  name: string;
  source_domain: string | null;
  listing_url?: string | null;
}

// Narrower than any specific candidate type — decouples venue matching from
// exactly what a "candidate" looks like. A venue is identified by its own
// name/site, regardless of which fields an event-discovery candidate
// happens to carry alongside it.
export interface VenueIdentity {
  name: string;
  websiteOrSocial: string | null;
  sourceUrl: string | null;
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
  candidate: VenueIdentity,
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

export function isDuplicate(candidate: VenueIdentity, existingVenues: ExistingVenue[]): boolean {
  return findMatchingVenue(candidate, existingVenues) !== null;
}
