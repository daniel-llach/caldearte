import { test } from "node:test";
import assert from "node:assert/strict";
import { extractOpeningDatetime, type OpeningTimeConfig } from "./opening-time.js";

const ARTEINFORMADO_CONFIG: OpeningTimeConfig = {
  pattern:
    /Inauguraci[oó]n\s*:?\s*(?<day>\d{1,2})\s+(?<month>[a-zé]{3})\.?\s+de\s+(?<year>\d{4})(?:\s*\/\s*(?<hour>\d{1,2})(?::(?<minute>\d{2}))?(?:\s*h(?:rs?)?\.?)?(?:\s*a\s*\d{1,2}\s*h(?:rs?)?\.?)?)?/i,
};

function readBackInSantiago(iso: string): string {
  const parts = new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "";
  return `${hour}:${minute}`;
}

test("extractOpeningDatetime parses the real arteinformado.com markup (span/br between label and date)", () => {
  // Real markup, confirmed 2026-07-19 against arteinformado.com/agenda/f/dejar-atras-245428.
  const html =
    '<span class="text-uppercase">Cuándo</span>:<br/> 15 jul de 2026 - 22 ago de 2026\n<br/><br/>\n' +
    '<span class="text-uppercase">Inauguración</span>:<br/> 15 jul de 2026 / 19 a 21 h.\n<br/><br/>\n' +
    '<span class="text-uppercase">Precio</span>:<br/> Entrada gratuita';

  const result = extractOpeningDatetime(html, ARTEINFORMADO_CONFIG);
  assert.ok(result, "should find a match");
  assert.equal(readBackInSantiago(result!), "19:00", "reads back as 19:00 Chile time, not a hardcoded UTC offset");
});

test("extractOpeningDatetime defaults the minute to 00 when the source omits it", () => {
  const html = "Inauguración : 3 ago de 2026 / 19 a 21 h.";
  const result = extractOpeningDatetime(html, ARTEINFORMADO_CONFIG);
  assert.ok(result);
  assert.equal(readBackInSantiago(result!), "19:00");
});

// Real markup, confirmed 2026-07-19: the "19 a 21 h." range format on
// "Dejar Atrás" turned out to be the outlier — 17 of 20 real detail pages
// sampled across both arteinformado.com listing pages use this plain
// "HH:MM" format instead (e.g. .../agenda/f/existen-otros-mundos-pero-estan-en-este-243857).
// The first version of this regex only matched the range format and
// silently produced null for all of these.
test("extractOpeningDatetime parses the common plain HH:MM format (no range, no trailing h)", () => {
  const html = '<span class="text-uppercase">Inauguración</span>:<br/> 24 abr de 2026 / 19:00<br />';
  const result = extractOpeningDatetime(html, ARTEINFORMADO_CONFIG);
  assert.ok(result);
  assert.equal(readBackInSantiago(result!), "19:00");
});

// Real markup, confirmed 2026-07-19 against
// .../agenda/f/cuerpos-velados-santiago-figueroa-245451 — "h" glued
// directly to the minute, no space, no range.
test("extractOpeningDatetime parses HH:MMh with no space before the h", () => {
  const html = '<span class="text-uppercase">Inauguración</span>:<br/> 14 jul de 2026 / 19:30h<br/>';
  const result = extractOpeningDatetime(html, ARTEINFORMADO_CONFIG);
  assert.ok(result);
  assert.equal(readBackInSantiago(result!), "19:30");
});

// Real markup, confirmed 2026-07-19 against .../agenda/f/sin-tesis-245342
// — a genuine editorial gap on arteinformado.com's own page (date given,
// no time at all). Correctly yields null rather than fabricating an hour;
// the event still counts as an "expo actual", just not as an
// "inauguración", since we genuinely don't know when it opened.
test("extractOpeningDatetime returns null when the source gives a date but no time at all", () => {
  const html = '<span class="text-uppercase">Inauguración</span>:<br/> 14 jul de 2026<br/>';
  assert.equal(extractOpeningDatetime(html, ARTEINFORMADO_CONFIG), null);
});

test("extractOpeningDatetime returns null when the pattern doesn't match", () => {
  const html = "Cuándo : 15 jul de 2026 - 22 ago de 2026 (sin inauguración confirmada)";
  assert.equal(extractOpeningDatetime(html, ARTEINFORMADO_CONFIG), null);
});

test("extractOpeningDatetime returns null for an unrecognized month abbreviation", () => {
  const config: OpeningTimeConfig = {
    pattern: /Inauguraci[oó]n\s*:?\s*(?<day>\d{1,2})\s+(?<month>[a-z]{3})\s+de\s+(?<year>\d{4})\s*\/\s*(?<hour>\d{1,2})\s*h/i,
  };
  assert.equal(extractOpeningDatetime("Inauguración: 15 xyz de 2026 / 19 h", config), null);
});
