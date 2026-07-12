// Shared between event-crawler/run.ts (known-venue revisits) and
// venue-discovery/run.ts (search-based discovery) — both need to drop
// candidates with no usable date and dedupe against what's already stored.

export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

// Compares by parsed instant, not raw string — Postgres normalizes
// timestamptz to UTC on storage, so a candidate re-evaluated later can
// come back from the model with a different (but equivalent) ISO offset
// than what's already stored. Comparing text would treat that as "new"
// and re-insert the same event under a different curation_status.
export function eventKey(title: string, openingDatetime: string | null): string {
  const time = openingDatetime ? new Date(openingDatetime).getTime() : Number.NaN;
  return `${normalizeTitle(title)}|${Number.isNaN(time) ? "invalid" : time}`;
}

// events.opening_datetime is NOT NULL, and docs/overview.md is explicit
// that an event whose opening has already passed by scrape/discovery time
// should never be added. Checked in code, not left to the model.
export function isUpcomingDated(candidate: { title: string; openingDatetime: string | null }): boolean {
  if (!candidate.openingDatetime || candidate.title.trim().length === 0) return false;
  const openingTime = new Date(candidate.openingDatetime).getTime();
  return !Number.isNaN(openingTime) && openingTime >= Date.now();
}
