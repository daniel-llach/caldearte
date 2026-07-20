import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMaviActivities } from "./mavi-headless.js";

// Shape captured from a real probe against api.agenda.uc.cl (2026-07-20),
// trimmed to the fields parseMaviActivities actually reads.
const REAL_SHAPE_SAMPLE = {
  data: [
    {
      title: 'Exposición "Kume Mongen" en Sala MAS MAVI UC',
      slug: "exposicion-kume-mongen-en-sala-mas-mavi-uc",
      content: "Desde el 30 de abril de 2025 y hasta inicios del 2027, la Sala MAS...",
      mainImage: { url: "https://agendauc-prod.s3.amazonaws.com/Kume_Mongen_Agenda_UC_2_0f16b12613.jpg" },
      place: { name: "Museo de Artes Visuales MAVI UC" },
      // Real bug this source triggered in production: these are the
      // museum's regular visiting hours, not an inauguración — confirm
      // parseMaviActivities never surfaces them at all.
      dates: [{ id: 265228, start: "2026-01-02T13:00:00.000Z", end: "2026-01-02T21:00:00.000Z" }],
      nextDate: { id: 265399, start: "2026-07-21T14:00:00.000Z", end: "2026-07-21T22:00:00.000Z" },
    },
  ],
};

test("parseMaviActivities extracts title, content, image, and builds the real detail URL from the slug", () => {
  const [activity] = parseMaviActivities(REAL_SHAPE_SAMPLE);
  assert.equal(activity.title, 'Exposición "Kume Mongen" en Sala MAS MAVI UC');
  assert.equal(activity.content, "Desde el 30 de abril de 2025 y hasta inicios del 2027, la Sala MAS...");
  assert.equal(activity.detailUrl, "https://www.uc.cl/agenda/actividad/exposicion-kume-mongen-en-sala-mas-mavi-uc");
  assert.equal(activity.imageUrl, "https://agendauc-prod.s3.amazonaws.com/Kume_Mongen_Agenda_UC_2_0f16b12613.jpg");
  assert.equal(activity.placeName, "Museo de Artes Visuales MAVI UC");
});

test("parseMaviActivities never surfaces dates/nextDate (visiting hours, not an inauguración) as a separate field", () => {
  const [activity] = parseMaviActivities(REAL_SHAPE_SAMPLE);
  assert.deepEqual(Object.keys(activity).sort(), ["content", "detailUrl", "imageUrl", "placeName", "title"]);
});

test("parseMaviActivities handles a missing mainImage/place gracefully", () => {
  const json = { data: [{ title: "Sin imagen", slug: "sin-imagen", content: "..." }] };
  const [activity] = parseMaviActivities(json);
  assert.equal(activity.imageUrl, null);
  assert.equal(activity.placeName, null);
});

test("parseMaviActivities handles an empty listing", () => {
  assert.deepEqual(parseMaviActivities({ data: [] }), []);
});
