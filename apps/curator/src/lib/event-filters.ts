// Shared between event-crawler/run.ts (known-venue revisits) and
// event-discovery/run.ts (search-based discovery) — both need to drop
// candidates with no usable date and dedupe against what's already stored.

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Accent/quote-insensitive: the same event routinely surfaces with
// slightly different punctuation across sources and re-runs ("Ejercicios
// de enlaces" vs "Exposición 'Ejercicios de enlaces'" was a real observed
// duplicate) — plain trim+lowercase missed it.
export function normalizeTitle(title: string): string {
  return stripAccents(title.toLowerCase())
    .replace(/["'«»“”]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

// The Event Crawler's flow still requires a confirmed opening: a candidate
// the model can't pin to a date isn't stored, and one whose opening already
// passed by scrape time is never added. Checked in code, not left to the
// model. (Event Discovery uses a different, month-level rule — see
// event-discovery/discover.ts's isCurrentOrUpcoming.)
export function isUpcomingDated(candidate: { title: string; openingDatetime: string | null }): boolean {
  if (!candidate.openingDatetime || candidate.title.trim().length === 0) return false;
  const openingTime = new Date(candidate.openingDatetime).getTime();
  return !Number.isNaN(openingTime) && openingTime >= Date.now();
}
