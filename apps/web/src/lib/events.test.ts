import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterActiveInRange,
  filterFamilyMode,
  filterByCity,
  splitInauguracionesYExpos,
  countByCity,
  cityNamesFromEvents,
  findNextEvent,
  sumCounts,
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
