import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterActiveToday,
  filterFamilyMode,
  filterByCity,
  splitInauguracionesYExpos,
  countByCity,
  findNextEvent,
  type EventRecord,
} from "./events";

function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "1",
    title: "Muestra",
    artist: "Artista",
    description: null,
    freeformLocation: "Galería X, Santiago",
    imageUrl: null,
    openingDatetime: null,
    runStartDate: "2026-07-05",
    runEndDate: "2026-07-20",
    sensitivityTags: [],
    sourceUrl: null,
    ...overrides,
  };
}

const TODAY = "2026-07-11";

test("filterActiveToday keeps only events whose run covers today", () => {
  const notStarted = event({ runStartDate: "2026-07-15", runEndDate: "2026-07-20" });
  const ended = event({ runStartDate: "2026-06-01", runEndDate: "2026-07-10" });
  const active = event({ runStartDate: "2026-07-01", runEndDate: "2026-07-20" });
  assert.deepEqual(filterActiveToday([notStarted, ended, active], TODAY), [active]);
});

test("filterFamilyMode excludes sensitivity-tagged events only when on", () => {
  const sensitive = event({ id: "s", sensitivityTags: ["desnudo_erotismo"] });
  const clean = event({ id: "c" });
  assert.deepEqual(filterFamilyMode([sensitive, clean], true), [clean]);
  assert.deepEqual(filterFamilyMode([sensitive, clean], false), [sensitive, clean]);
});

test("filterByCity derives city from freeform_location", () => {
  const santiago = event({ id: "a", freeformLocation: "Galería X, Santiago" });
  const valpo = event({ id: "b", freeformLocation: "Sala El Farol, Valparaíso" });
  assert.deepEqual(filterByCity([santiago, valpo], "santiago"), [santiago]);
});

test("splitInauguracionesYExpos: opening today -> inauguración, else -> expo actual", () => {
  const opening = event({ id: "opening", openingDatetime: "2026-07-11T22:00:00+00:00" });
  const ongoing = event({ id: "ongoing", runStartDate: "2026-06-01", runEndDate: "2026-07-20" });
  const openedYesterday = event({ id: "opened-yesterday", openingDatetime: "2026-07-10T22:00:00+00:00", runEndDate: "2026-07-20" });

  const { inauguraciones, exposActuales } = splitInauguracionesYExpos([opening, ongoing, openedYesterday], TODAY);
  assert.deepEqual(inauguraciones.map((e) => e.id), ["opening"]);
  assert.deepEqual(
    exposActuales.map((e) => e.id).sort(),
    ["ongoing", "opened-yesterday"],
  );
});

test("countByCity tallies inauguraciones/expos per known city, dropping 'otro'", () => {
  const events = [
    event({ id: "a", freeformLocation: "Galería X, Santiago", openingDatetime: "2026-07-11T22:00:00+00:00" }),
    event({ id: "b", freeformLocation: "Sala Y, Santiago" }),
    event({ id: "c", freeformLocation: "Sala Z, Valparaíso" }),
    event({ id: "d", freeformLocation: "Algo, Rancagua" }), // unmatched -> "otro"
  ];
  const counts = countByCity(events, TODAY);
  assert.deepEqual(counts.santiago, { inauguraciones: 1, exposActuales: 1 });
  assert.deepEqual(counts.valparaiso, { inauguraciones: 0, exposActuales: 1 });
  assert.equal(counts.otro, undefined);
});

test("findNextEvent finds the earliest current-or-upcoming anchor date", () => {
  const soon = event({ id: "soon", runStartDate: "2026-07-14", runEndDate: "2026-07-14", openingDatetime: "2026-07-14T22:00:00+00:00" });
  const later = event({ id: "later", runStartDate: "2026-08-01", runEndDate: "2026-08-01", openingDatetime: "2026-08-01T22:00:00+00:00" });
  assert.equal(findNextEvent([later, soon], TODAY)?.id, "soon");
});

test("findNextEvent returns null when there's nothing upcoming", () => {
  assert.equal(findNextEvent([], TODAY), null);
});
