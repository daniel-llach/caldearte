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
  assert.equal(result!.timeConfirmed, true);
  assert.equal(readBackInSantiago(result!.iso), "19:00", "reads back as 19:00 Chile time, not a hardcoded UTC offset");
});

test("extractOpeningDatetime defaults the minute to 00 when the source omits it", () => {
  const html = "Inauguración : 3 ago de 2026 / 19 a 21 h.";
  const result = extractOpeningDatetime(html, ARTEINFORMADO_CONFIG);
  assert.ok(result);
  assert.equal(readBackInSantiago(result!.iso), "19:00");
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
  assert.equal(readBackInSantiago(result!.iso), "19:00");
});

// Real markup, confirmed 2026-07-19 against
// .../agenda/f/cuerpos-velados-santiago-figueroa-245451 — "h" glued
// directly to the minute, no space, no range.
test("extractOpeningDatetime parses HH:MMh with no space before the h", () => {
  const html = '<span class="text-uppercase">Inauguración</span>:<br/> 14 jul de 2026 / 19:30h<br/>';
  const result = extractOpeningDatetime(html, ARTEINFORMADO_CONFIG);
  assert.ok(result);
  assert.equal(readBackInSantiago(result!.iso), "19:30");
});

// Real markup, confirmed 2026-07-19 against .../agenda/f/sin-tesis-245342
// — a genuine editorial gap on arteinformado.com's own page (date given,
// no time at all). Real bug (found 2026-07-20): this used to return null
// outright, so the confirmed date was silently dropped and the event never
// showed under "Inauguraciones" even though the venue explicitly confirmed
// one. Now yields a real result with timeConfirmed: false — the date is
// still shown under Inauguraciones, just without an hour badge on the
// card (see apps/web's EventCardBase).
test("extractOpeningDatetime yields a date-only result (timeConfirmed: false) when the source gives a date but no time at all", () => {
  const html = '<span class="text-uppercase">Inauguración</span>:<br/> 14 jul de 2026<br/>';
  const result = extractOpeningDatetime(html, ARTEINFORMADO_CONFIG);
  assert.ok(result);
  assert.equal(result!.timeConfirmed, false);
  // Midnight Santiago time, deterministic — never actually displayed to a
  // visitor (EventCardBase only reads timeConfirmed), just a valid instant.
  assert.equal(readBackInSantiago(result!.iso), "00:00");
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

const UCHILE_CONFIG: OpeningTimeConfig = {
  pattern:
    /esperamos\s+este\s+\S+\s+(?<day>\d{1,2})\s+de\s+(?<month>[a-zé]{3})[a-zé]*\s+a\s+las\s+(?<hour>\d{1,2})[.:](?<minute>\d{2})\s*h?/i,
};

// Real markup, confirmed 2026-07-20 against
// .../agenda/241838/exhibicion-alzar-curva-la-mirada-del-artista-francisco-belarmino
// — no "Inauguración:" line at all, phrased as an invitation, full month
// name (not the 3-letter abbreviation), and — the reason this needed a new
// OpeningTimeConfig capability, not just a new regex — NO YEAR anywhere on
// the page (checked meta tags too). Verified against a fixed referenceDate
// so the inferred year is deterministic in the test.
test("extractOpeningDatetime infers the year when the source never publishes one (uchile.cl)", () => {
  const html = "Los esperamos este miercoles 01 de julio a las 18.00h. en Galería Micromedios, Bloque B, Segundo Piso";
  const referenceDate = new Date("2026-07-19T12:00:00Z");
  const result = extractOpeningDatetime(html, UCHILE_CONFIG, referenceDate);
  assert.ok(result);
  assert.equal(result!.timeConfirmed, true);
  assert.equal(result!.iso.slice(0, 4), "2026", "infers the reference date's own year for a near-term date");
  assert.equal(readBackInSantiago(result!.iso), "18:00");
});

test("extractOpeningDatetime's year inference rolls forward to next year for a date far enough in the past", () => {
  const html = "Los esperamos este jueves 15 de enero a las 19:00h en el hall central";
  // Referenced from December — mid-January is ~90 days in the past relative
  // to this reference date, past the 60-day tolerance, so it must mean next
  // January, not the one that already happened.
  const referenceDate = new Date("2026-12-10T12:00:00Z");
  const result = extractOpeningDatetime(html, UCHILE_CONFIG, referenceDate);
  assert.ok(result);
  assert.equal(result!.iso.slice(0, 4), "2027");
});

test("extractOpeningDatetime's year inference keeps the current year for a date within tolerance of the past", () => {
  const html = "Los esperamos este jueves 1 de julio a las 19:00h en el hall central";
  // Only ~19 days in the past relative to referenceDate — well within the
  // 60-day tolerance, so it's still "this year," not next year.
  const referenceDate = new Date("2026-07-20T12:00:00Z");
  const result = extractOpeningDatetime(html, UCHILE_CONFIG, referenceDate);
  assert.ok(result);
  assert.equal(result!.iso.slice(0, 4), "2026");
});
