import { test } from "node:test";
import assert from "node:assert/strict";
import { extractOpeningDatetime, type OpeningTimeConfig } from "./opening-time.js";

const ARTEINFORMADO_CONFIG: OpeningTimeConfig = {
  pattern:
    /Inauguraci[oó]n\s*:?\s*(?<day>\d{1,2})\s+(?<month>[a-zé]{3})\.?\s+de\s+(?<year>\d{4})\s*\/\s*(?<hour>\d{1,2})(?::(?<minute>\d{2}))?\s*a\s*\d{1,2}\s*h/i,
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
