import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterActiveInRange,
  filterFamilyMode,
  filterByCity,
  splitInauguracionesYExpos,
  countByCity,
  thumbnailsByCity,
  cityNamesFromEvents,
  findNextEvent,
  sumCounts,
  groupEventsByAnchorMonth,
  listArchiveMonths,
  eventsForMonth,
  searchEvents,
  filterByPlaceName,
  truncateDescription,
  type EventRecord,
} from "./events";

function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "1",
    title: "Muestra",
    artist: "Artista",
    description: null,
    freeformLocation: "Galería X, Santiago",
    placeName: null,
    regionName: null,
    imageUrl: null,
    openingDatetime: null,
    runStartDate: "2026-07-05",
    runEndDate: "2026-07-20",
    sensitivityTags: [],
    sourceUrl: null,
    openingTimeConfirmed: true,
    ...overrides,
  };
}

const TODAY = "2026-07-11"; // a Saturday
// The Mon-Sun week containing TODAY: 2026-07-06 .. 2026-07-12.
const WEEK_START = "2026-07-06";
const WEEK_END = "2026-07-12";

test("filterActiveInRange (Día mode: start === end === today) keeps only events whose run covers that single day", () => {
  const notStarted = event({ runStartDate: "2026-07-15", runEndDate: "2026-07-20" });
  const ended = event({ runStartDate: "2026-06-01", runEndDate: "2026-07-10" });
  const active = event({ runStartDate: "2026-07-01", runEndDate: "2026-07-20" });
  assert.deepEqual(filterActiveInRange([notStarted, ended, active], TODAY, TODAY), [active]);
});

test("filterActiveInRange (Semana mode) keeps events overlapping the Mon-Sun window, including ones ending/starting exactly on its edges", () => {
  const endsOnMonday = event({ id: "a", runStartDate: "2026-06-20", runEndDate: WEEK_START });
  const startsOnSunday = event({ id: "b", runStartDate: WEEK_END, runEndDate: "2026-08-01" });
  const entirelyBefore = event({ id: "c", runStartDate: "2026-06-01", runEndDate: "2026-07-05" });
  const entirelyAfter = event({ id: "d", runStartDate: "2026-07-13", runEndDate: "2026-07-20" });

  const result = filterActiveInRange([endsOnMonday, startsOnSunday, entirelyBefore, entirelyAfter], WEEK_START, WEEK_END);
  assert.deepEqual(result.map((e) => e.id).sort(), ["a", "b"]);
});

test("filterFamilyMode excludes sensitivity-tagged events only when on", () => {
  const sensitive = event({ id: "s", sensitivityTags: ["desnudo_erotismo"] });
  const clean = event({ id: "c" });
  assert.deepEqual(filterFamilyMode([sensitive, clean], true), [clean]);
  assert.deepEqual(filterFamilyMode([sensitive, clean], false), [sensitive, clean]);
});

test("filterByCity derives city from freeform_location when there's no regionName", () => {
  const santiago = event({ id: "a", freeformLocation: "Galería X, Santiago" });
  const valpo = event({ id: "b", freeformLocation: "Sala El Farol, Valparaíso" });
  assert.deepEqual(filterByCity([santiago, valpo], "santiago"), [santiago]);
});

test("filterByCity prefers regionName over a freeform_location that would otherwise mismatch", () => {
  // A backend-resolved region_id always wins, even if the freeform text
  // alone would've derived a different (or no) city.
  const backendResolved = event({ id: "a", freeformLocation: "Frase libre sin ciudad reconocible", regionName: "Valparaíso" });
  assert.deepEqual(filterByCity([backendResolved], "valparaiso"), [backendResolved]);
});

test("splitInauguracionesYExpos: an opening within the window appears in BOTH sections (Día mode)", () => {
  const opening = event({ id: "opening", openingDatetime: "2026-07-11T22:00:00+00:00" });
  const ongoing = event({ id: "ongoing", runStartDate: "2026-06-01", runEndDate: "2026-07-20" });
  const openedYesterday = event({ id: "opened-yesterday", openingDatetime: "2026-07-10T22:00:00+00:00", runEndDate: "2026-07-20" });

  const { inauguraciones, exposActuales } = splitInauguracionesYExpos([opening, ongoing, openedYesterday], TODAY, TODAY);
  assert.deepEqual(inauguraciones.map((e) => e.id), ["opening"]);
  assert.deepEqual(exposActuales.map((e) => e.id).sort(), ["ongoing", "opened-yesterday", "opening"]);
  // The core overlap guarantee: every inauguración is also in exposActuales.
  const exposIds = new Set(exposActuales.map((e) => e.id));
  assert.ok(inauguraciones.every((e) => exposIds.has(e.id)));
});

test("splitInauguracionesYExpos: an opening anywhere within the Mon-Sun window appears in BOTH sections (Semana mode)", () => {
  // Opens on the Wednesday of the week, well before "today" (the Saturday).
  const openedEarlierThisWeek = event({ id: "opened-wed", openingDatetime: "2026-07-08T22:00:00+00:00", runEndDate: "2026-07-20" });
  const noConfirmedOpening = event({ id: "no-opening", runStartDate: "2026-06-01", runEndDate: "2026-07-20" });
  const openedLastWeek = event({ id: "opened-last-week", openingDatetime: "2026-06-29T22:00:00+00:00", runEndDate: "2026-07-20" });

  const { inauguraciones, exposActuales } = splitInauguracionesYExpos(
    [openedEarlierThisWeek, noConfirmedOpening, openedLastWeek],
    WEEK_START,
    WEEK_END,
  );
  assert.deepEqual(inauguraciones.map((e) => e.id), ["opened-wed"]);
  assert.deepEqual(exposActuales.map((e) => e.id).sort(), ["no-opening", "opened-last-week", "opened-wed"]);
  const exposIds = new Set(exposActuales.map((e) => e.id));
  assert.ok(inauguraciones.every((e) => exposIds.has(e.id)), "inauguraciones must be a subset of exposActuales");
});

test("countByCity tallies per city, dropping 'otro', for ANY comuna a real event resolves to — not just a fixed list", () => {
  const events = [
    event({ id: "a", freeformLocation: "Galería X, Santiago", openingDatetime: "2026-07-11T22:00:00+00:00" }),
    event({ id: "b", freeformLocation: "Sala Y, Santiago" }),
    event({ id: "c", freeformLocation: "Sala Z, Valparaíso" }),
    // Real production gap, fixed 2026-07-17: a comuna not in the old
    // hardcoded KNOWN_CITIES list used to silently fall into "otro" even
    // though it's a real, curator-validated comuna — now counted properly.
    event({ id: "d", freeformLocation: "Galeria NAC, Las Condes" }),
    event({ id: "e", freeformLocation: "" }), // genuinely unmatchable -> "otro"
  ];
  const counts = countByCity(events, TODAY, TODAY);
  // Overlap-counted, matching splitInauguracionesYExpos: event "a" opens
  // today, so it counts in BOTH inauguraciones and exposActuales for Santiago.
  assert.deepEqual(counts.santiago, { inauguraciones: 1, exposActuales: 2 });
  assert.deepEqual(counts.valparaiso, { inauguraciones: 0, exposActuales: 1 });
  assert.deepEqual(counts["las-condes"], { inauguraciones: 0, exposActuales: 1 });
  assert.equal(counts.otro, undefined);
});

test("thumbnailsByCity groups by comuna, newest anchor date first, capped at maxPerCity, dropping 'otro'", () => {
  const events = [
    event({ id: "a", freeformLocation: "Galería X, Santiago", openingDatetime: "2026-07-01T22:00:00+00:00" }),
    event({ id: "b", freeformLocation: "Sala Y, Santiago", openingDatetime: "2026-07-10T22:00:00+00:00" }),
    event({ id: "c", freeformLocation: "Sala Z, Santiago", openingDatetime: "2026-07-05T22:00:00+00:00" }),
    event({ id: "d", freeformLocation: "Sala W, Valparaíso" }),
    event({ id: "e", freeformLocation: "" }), // "otro" — never surfaced
  ];
  const thumbnails = thumbnailsByCity(events, 2);
  // Newest anchor first ("b" opened 2026-07-10, before "c" 2026-07-05), capped at 2 — "a" (oldest) drops off.
  assert.deepEqual(thumbnails.santiago.map((e) => e.id), ["b", "c"]);
  assert.deepEqual(thumbnails.valparaiso.map((e) => e.id), ["d"]);
  assert.equal(thumbnails.otro, undefined);
});

test("thumbnailsByCity defaults to 4 per city", () => {
  const events = Array.from({ length: 6 }, (_, i) => event({ id: `e${i}`, freeformLocation: "Galería X, Santiago" }));
  assert.equal(thumbnailsByCity(events).santiago.length, 4);
});

test("cityNamesFromEvents builds id -> real display name from regionName (preferred) or the freeform_location trailing segment", () => {
  const events = [
    event({ id: "a", freeformLocation: "Galería X, Santiago", regionName: "Santiago" }),
    event({ id: "b", freeformLocation: "Galeria NAC, Las Condes" }), // no regionName -> falls back to trailing segment
    event({ id: "c", freeformLocation: "" }), // "otro" — never included
  ];
  const names = cityNamesFromEvents(events);
  assert.equal(names.santiago, "Santiago");
  assert.equal(names["las-condes"], "Las Condes");
  assert.equal(names.otro, undefined);
});

test("findNextEvent finds the earliest current-or-upcoming anchor date strictly after the window end", () => {
  const soon = event({ id: "soon", runStartDate: "2026-07-14", runEndDate: "2026-07-14", openingDatetime: "2026-07-14T22:00:00+00:00" });
  const later = event({ id: "later", runStartDate: "2026-08-01", runEndDate: "2026-08-01", openingDatetime: "2026-08-01T22:00:00+00:00" });
  assert.equal(findNextEvent([later, soon], TODAY, TODAY)?.id, "soon");
});

test("findNextEvent excludes an event already inside the current window — 'next' means after the window ends, not after today", () => {
  // Anchored within the Mon-Sun week itself (WEEK_START..WEEK_END) — this
  // event would already have been shown by filterActiveInRange, so it must
  // NOT be findNextEvent's answer too.
  const insideWeek = event({ id: "inside-week", runStartDate: "2026-07-09", runEndDate: "2026-07-09", openingDatetime: "2026-07-09T22:00:00+00:00" });
  const afterWeek = event({ id: "after-week", runStartDate: "2026-07-15", runEndDate: "2026-07-15", openingDatetime: "2026-07-15T22:00:00+00:00" });
  assert.equal(findNextEvent([insideWeek, afterWeek], TODAY, WEEK_END)?.id, "after-week");
});

test("findNextEvent returns null when there's nothing upcoming", () => {
  assert.equal(findNextEvent([], TODAY, TODAY), null);
});

test("sumCounts adds up inauguraciones/exposActuales across multiple CityCounts — used for región- and Chile-level totals", () => {
  assert.deepEqual(
    sumCounts([
      { inauguraciones: 1, exposActuales: 2 },
      { inauguraciones: 3, exposActuales: 0 },
    ]),
    { inauguraciones: 4, exposActuales: 2 },
  );
});

test("sumCounts of an empty array is all zeros", () => {
  assert.deepEqual(sumCounts([]), { inauguraciones: 0, exposActuales: 0 });
});

test("groupEventsByAnchorMonth: a multi-month run appears only under its opening month", () => {
  const springApril = event({ id: "a", openingDatetime: "2026-04-24T22:00:00+00:00", runStartDate: "2026-04-25", runEndDate: "2026-08-23" });
  const julyOnly = event({ id: "b", openingDatetime: "2026-07-10T22:00:00+00:00", runStartDate: "2026-07-11", runEndDate: "2026-07-11" });
  const groups = groupEventsByAnchorMonth([springApril, julyOnly]);
  assert.deepEqual(groups.get("2026-04")?.map((e) => e.id), ["a"]);
  assert.deepEqual(groups.get("2026-07")?.map((e) => e.id), ["b"]);
  assert.equal(groups.get("2026-05"), undefined, "not repeated into a month it merely ran through");
  assert.equal(groups.get("2026-08"), undefined);
});

test("listArchiveMonths: excludes the current and future months, sorts most-recent-first, only months with data", () => {
  const june = event({ id: "a", openingDatetime: "2026-06-10T22:00:00+00:00", runStartDate: "2026-06-10", runEndDate: "2026-06-10" });
  const april = event({ id: "b", openingDatetime: "2026-04-10T22:00:00+00:00", runStartDate: "2026-04-10", runEndDate: "2026-04-10" });
  const currentMonth = event({ id: "c", openingDatetime: "2026-07-05T22:00:00+00:00", runStartDate: "2026-07-05", runEndDate: "2026-07-05" });
  const futureMonth = event({ id: "d", openingDatetime: "2026-09-01T22:00:00+00:00", runStartDate: "2026-09-01", runEndDate: "2026-09-01" });
  const months = listArchiveMonths([june, april, currentMonth, futureMonth], TODAY);
  assert.deepEqual(months, [
    { year: 2026, month: 6 },
    { year: 2026, month: 4 },
  ]);
});

test("eventsForMonth: scopes to exactly that year/month, chronologically ascending", () => {
  const late = event({ id: "late", openingDatetime: "2026-06-25T22:00:00+00:00", runStartDate: "2026-06-25", runEndDate: "2026-06-25" });
  const early = event({ id: "early", openingDatetime: "2026-06-02T22:00:00+00:00", runStartDate: "2026-06-02", runEndDate: "2026-06-02" });
  const otherMonth = event({ id: "other", openingDatetime: "2026-07-02T22:00:00+00:00", runStartDate: "2026-07-02", runEndDate: "2026-07-02" });
  assert.deepEqual(eventsForMonth([late, early, otherMonth], 2026, 6).map((e) => e.id), ["early", "late"]);
});

test("searchEvents matches title, artist, or placeName, accent-insensitive", () => {
  const byTitle = event({ id: "a", title: "Exhibición Alicia" });
  const byArtist = event({ id: "b", artist: "María José" });
  const byPlace = event({ id: "c", placeName: "Galería Croxatto" });
  const noMatch = event({ id: "d", title: "Otra cosa", artist: "Nadie", placeName: "Sala Z" });
  assert.deepEqual(searchEvents([byTitle, byArtist, byPlace, noMatch], "alicia").map((e) => e.id), ["a"]);
  assert.deepEqual(searchEvents([byTitle, byArtist, byPlace, noMatch], "maria").map((e) => e.id), ["b"]);
  assert.deepEqual(searchEvents([byTitle, byArtist, byPlace, noMatch], "croxatto").map((e) => e.id), ["c"]);
  assert.deepEqual(searchEvents([byTitle, byArtist, byPlace, noMatch], "").map((e) => e.id), ["a", "b", "c", "d"]);
});

test("filterByPlaceName matches placeName, accent-insensitive", () => {
  const match = event({ id: "a", placeName: "Isabel Croxatto Galería" });
  const noMatch = event({ id: "b", placeName: "Otra Sala" });
  const nullPlace = event({ id: "c", placeName: null });
  assert.deepEqual(filterByPlaceName([match, noMatch, nullPlace], "croxatto").map((e) => e.id), ["a"]);
});

test("truncateDescription leaves a short description untouched, null stays null", () => {
  assert.equal(truncateDescription("Una muestra breve."), "Una muestra breve.");
  assert.equal(truncateDescription(null), null);
});

test("truncateDescription cuts a long description to maxLength and appends an ellipsis", () => {
  const long = "a".repeat(300);
  const result = truncateDescription(long, 220);
  assert.equal(result?.length, 221); // 220 chars + "…"
  assert.ok(result?.endsWith("…"));
  assert.equal(result?.slice(0, 220), "a".repeat(220));
});
